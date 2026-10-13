import asyncio
import secrets
import base64
import json
from urllib.parse import urlsplit

import httpx
from cryptography.fernet import Fernet
from kubernetes_asyncio import client, config
from kubernetes_asyncio.client.exceptions import ApiException
from sqlalchemy import select

from testflow.infrastructure.models import Runtime, uid
from testflow.infrastructure.revisions import digest


class PodManager:
    def __init__(self, app):
        self.app = app
        self.settings = app.state.settings
        self.api_client = None
        self.api = None
        self.locks: dict[str, asyncio.Lock] = {}
        self.lost: dict[str, asyncio.Event] = {}

    async def connect(self):
        if self.api: return
        if self.settings.kube_context:
            await config.load_kube_config(context=self.settings.kube_context)
        else:
            try: config.load_incluster_config()
            except config.ConfigException: await config.load_kube_config()
        self.api_client = client.ApiClient()
        self.api = client.CoreV1Api(self.api_client)

    async def close(self):
        if self.api_client: await self.api_client.close()

    def encrypted(self, token):
        return Fernet(self.settings.encryption_key.get_secret_value().encode()).encrypt(token.encode()).decode()

    def decrypted(self, token):
        return Fernet(self.settings.encryption_key.get_secret_value().encode()).decrypt(token.encode()).decode()

    async def acquire(self, node: dict, context: dict, preparation_timeout: float):
        runtime, module = node["runtime"], node["module_snapshot"]
        image = runtime["image"]
        if "@sha256:" not in image and not self.settings.allow_local_images:
            raise RuntimeError("Production module images must use a sha256 digest")
        if image.endswith(":latest") or ("@sha256:" not in image and ":" not in image):
            raise RuntimeError("Use a digest or an immutable development image tag")
        key = digest([context["batch_id"], context["pipeline_version_id"], context["node_id"], runtime,
                      context["execution_id"] if runtime["reuse_scope"] == "execution_node" else None])
        lock = self.locks.setdefault(key, asyncio.Lock())
        async with lock:
            async with self.app.state.database.sessions() as db:
                existing = await db.scalar(select(Runtime).where(Runtime.key == key, Runtime.state == "ready").order_by(Runtime.created.desc()))
                if existing and not self.lost.setdefault(existing.id, asyncio.Event()).is_set():
                    await self.connect()
                    try:
                        pod = await self.api.read_namespaced_pod(existing.pod_name, self.settings.namespace)
                        statuses = pod.status.container_statuses or []
                        if pod.status.phase == "Running" and statuses and statuses[0].ready and not statuses[0].restart_count and statuses[0].image_id == existing.image_id:
                            return existing
                    except ApiException as e:
                        if e.status != 404: raise
                    self.lost[existing.id].set()
                    await self.terminate(existing)
            await self.connect()
            identifier, token = uid(), secrets.token_urlsafe(48)
            name = "testflow-module-" + identifier[:12]
            row = Runtime(id=identifier, key=key, batch_id=context["batch_id"], pod_name=name, snapshot={"module": module, "runtime": runtime, "context": context}, token=self.encrypted(token))
            async with self.app.state.database.sessions() as db, db.begin(): db.add(row)
            self.lost[identifier] = asyncio.Event()
            mounts = [{"name": "tmp", "mountPath": "/tmp"}]
            volumes = [{"name": "tmp", "emptyDir": {}}]
            code = node.get("repository_snapshot")
            if code:
                volumes.append({"name": "code", "persistentVolumeClaim": {"claimName": self.settings.data_claim, "readOnly": True}})
                mounts.append({"name": "code", "mountPath": runtime["code_mount"]["mount_path"], "subPath": code["data"]["code_path"], "readOnly": True})
            spec = {"serviceAccountName": self.settings.module_service_account, "automountServiceAccountToken": False,
                    "restartPolicy": "Never", "terminationGracePeriodSeconds": 10,
                    "securityContext": {"runAsNonRoot": True, "runAsUser": 10001, "fsGroup": 10001},
                    "containers": [{"name": "module", "image": image, "imagePullPolicy": "IfNotPresent" if self.settings.allow_local_images else "Always",
                                    "ports": [{"containerPort": runtime["port"]}],
                                    "env": [{"name": "TESTFLOW_MODULE_PORT", "value": str(runtime["port"])}, {"name": "TESTFLOW_PLATFORM_URL", "value": self.settings.backend_url},
                                            {"name": "TESTFLOW_RUNTIME_ID", "value": identifier}, {"name": "TESTFLOW_RUNTIME_TOKEN", "value": token}],
                                    "resources": {"requests": {"cpu": runtime["cpu"], "memory": runtime["memory"]}, "limits": {"cpu": runtime["cpu"], "memory": runtime["memory"]}},
                                    "volumeMounts": mounts, "securityContext": {"allowPrivilegeEscalation": False, "capabilities": {"drop": ["ALL"]}, "readOnlyRootFilesystem": True},
                                    "readinessProbe": {"httpGet": {"path": "/module/v1/health", "port": runtime["port"]}, "periodSeconds": 1}}], "volumes": volumes}
            if self.settings.backend_node: spec["nodeName"] = self.settings.backend_node
            if self.settings.image_pull_secret: spec["imagePullSecrets"] = [{"name": self.settings.image_pull_secret}]
            body = {"apiVersion": "v1", "kind": "Pod", "metadata": {"name": name, "labels": {"app.kubernetes.io/part-of": "testflow", "testflow-runtime": identifier, "testflow-batch": context["batch_id"]}}, "spec": spec}
            try:
                pull_secret = None
                if runtime.get("registry_credential_id"):
                    from testflow.features.auth import credential_value
                    async with self.app.state.database.sessions() as db:
                        secret_value = await credential_value(db, self.settings, runtime["registry_credential_id"])
                    try:
                        credentials = json.loads(secret_value)
                        server, username, password = (credentials[k] for k in ("server", "username", "password"))
                        auth = base64.b64encode((username + ":" + password).encode()).decode()
                        configuration = json.dumps({"auths": {server: {"username": username, "password": password, "auth": auth}}})
                    except (KeyError, TypeError, ValueError): raise RuntimeError("Registry credential must contain server, username and password")
                    pull_secret = "testflow-pull-" + identifier[:12]
                    await self.api.create_namespaced_secret(self.settings.namespace, {"apiVersion": "v1", "kind": "Secret", "metadata": {"name": pull_secret},
                        "type": "kubernetes.io/dockerconfigjson", "data": {".dockerconfigjson": base64.b64encode(configuration.encode()).decode()}})
                    spec.setdefault("imagePullSecrets", []).append({"name": pull_secret})
                await self.api.create_namespaced_pod(self.settings.namespace, body)
                async with asyncio.timeout(preparation_timeout):
                    while True:
                        pod = await self.api.read_namespaced_pod(name, self.settings.namespace)
                        if pod.status.phase in {"Failed", "Succeeded"}: raise RuntimeError("Module exited during preparation")
                        statuses = pod.status.container_statuses or []
                        if pod.status.pod_ip and statuses and statuses[0].ready:
                            address = f"http://{pod.status.pod_ip}:{runtime['port']}"
                            async with httpx.AsyncClient(trust_env=False, timeout=5) as http:
                                health = await http.get(address + "/module/v1/health"); health.raise_for_status()
                                response = await http.get(address + "/module/v1/contract"); response.raise_for_status()
                            actual = response.json()
                            expected = {"protocol": "testflow.module.v1", "id": module["data"]["manifest"]["id"], "version": module["data"]["manifest"]["version"], "inputs": module["data"]["inputs"], "outputs": module["data"]["outputs"], "parameters": module["data"]["parameters"]}
                            if actual != expected: raise RuntimeError("Actual module contract does not match imported ZIP")
                            image_id = statuses[0].image_id
                            if node.get("validated_image_id") and node["validated_image_id"] != image_id:
                                raise RuntimeError("Image identity changed; import and validate a new module version")
                            async with self.app.state.database.sessions() as db, db.begin():
                                current = await db.get(Runtime, identifier)
                                current.state, current.address, current.image_id = "ready", address, image_id
                            row.state, row.address, row.image_id = "ready", address, image_id
                            return row
                        await asyncio.sleep(.5)
            except BaseException:
                await self.terminate(row)
                raise

    async def watch(self, row: Runtime):
        while not self.lost[row.id].is_set():
            try:
                pod = await self.api.read_namespaced_pod(row.pod_name, self.settings.namespace)
                statuses = pod.status.container_statuses or []
                gone = pod.status.phase in {"Failed", "Succeeded"} or bool(statuses and (statuses[0].restart_count or statuses[0].state.terminated))
            except ApiException as error:
                if error.status != 404:
                    await asyncio.sleep(1); continue
                gone = True
            except Exception:
                await asyncio.sleep(1); continue
            if gone:
                self.lost[row.id].set()
                async with self.app.state.database.sessions() as db, db.begin():
                    current = await db.get(Runtime, row.id)
                    if current and current.state == "ready": current.state = "lost"
                break
            await asyncio.sleep(1)

    async def terminate(self, row: Runtime) -> dict:
        self.lost.setdefault(row.id, asyncio.Event()).set()
        evidence = {"runtime_id": row.id, "pod": row.pod_name, "delete_requested": False, "object_gone": False, "container_stop_confirmed": False}
        try:
            await self.connect()
            await self.api.delete_namespaced_pod(row.pod_name, self.settings.namespace, grace_period_seconds=0)
            evidence["delete_requested"] = True
            try:
                await self.api.read_namespaced_pod(row.pod_name, self.settings.namespace)
            except ApiException as e:
                if e.status == 404: evidence["object_gone"] = True
        except ApiException as e:
            if e.status == 404: evidence["object_gone"] = True
            else: evidence["error"] = "pod_delete_failed"
        except Exception:
            evidence["error"] = "cluster_unavailable"
        if row.snapshot["runtime"].get("registry_credential_id"):
            try: await self.api.delete_namespaced_secret("testflow-pull-" + row.id[:12], self.settings.namespace)
            except Exception: evidence["credential_cleanup"] = "pending"
        async with self.app.state.database.sessions() as db, db.begin():
            current = await db.get(Runtime, row.id)
            if current: current.state = "deleted" if evidence["object_gone"] else "deleting"
        return evidence

    async def release_batch(self, batch_id):
        async with self.app.state.database.sessions() as db:
            rows = (await db.scalars(select(Runtime).where(Runtime.batch_id == batch_id, Runtime.state.in_(["ready", "preparing", "deleting", "lost"])))).all()
        return await asyncio.gather(*(self.terminate(r) for r in rows))

    async def validate(self, payload):
        context = {"batch_id": uid(), "execution_id": uid(), "node_id": "validation", "pipeline_version_id": "validation"}
        node = {"runtime": payload["runtime"], "module_snapshot": payload["module"], "repository_snapshot": payload.get("repository")}
        row = await self.acquire(node, context, 60)
        evidence = {"runtime_id": row.id, "image_id": row.image_id, "contract_verified": True}
        evidence["cleanup"] = await self.terminate(row)
        return evidence
