import asyncio
import base64
import time
from copy import deepcopy

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError

from testflow.execution.transport.channels import group, group_ended, group_ready
from testflow.execution.transport.module import ModuleInvocation
from testflow.execution.media import persist_field
from testflow.infrastructure.events import emit
from testflow.infrastructure.retry import database_retry
from testflow.infrastructure.models import Event, Execution, uid, now


class DAGRun:
    def __init__(self, app, record: Execution):
        self.app, self.record = app, record
        self.graph = record.snapshot["pipeline"]["graph"]
        self.nodes = {n["id"]: n for n in self.graph["nodes"]}
        self.groups = {k: group(n["output_schema"]) for k, n in self.nodes.items()}
        if record.snapshot.get("live"):
            for node_id, node in self.nodes.items():
                if node["kind"] == "start":
                    for field in self.groups[node_id].values(): field.origin = "live_input"
        self.done = asyncio.Event()
        self.terminal_lock = asyncio.Lock()
        self.store_lock = asyncio.Lock()
        self.active: dict[str, ModuleInvocation] = {}
        self.workers = {}
        self.node_records = {k: {"id": k, "name": n["name"], "kind": n["kind"], "state": "pending", "span_id": uid(), "input": {}, "output": {}} for k, n in self.nodes.items()}
        self.clock = time.monotonic()

    async def event(self, kind, data=None, node=None):
        return await emit(self.app, self.record.id, kind, data, node, self.record.task_id)

    @database_retry
    async def store_nodes(self):
        async with self.store_lock, self.app.state.database.sessions() as db, db.begin():
            row = await db.get(Execution, self.record.id)
            row.nodes = deepcopy(self.node_records)

    async def terminal(self, state, winner=None, error=None):
        async with self.terminal_lock:
            accepted = await self.accept_terminal(state, winner, error, now(), (time.monotonic() - self.clock) * 1000)
            if accepted:
                self.record.state = state
                self.done.set()
            return accepted

    @database_retry
    async def accept_terminal(self, state, winner, error, ended, duration):
        async with self.app.state.database.sessions() as db, db.begin():
            row = await db.scalar(select(Execution).where(Execution.id == self.record.id).with_for_update())
            if row.state not in {"queued", "running"}:
                return row.state == state and row.duration_ms == duration and row.winner == winner
            row.state, row.winner, row.error = state, winner, error
            row.ended, row.duration_ms, row.cleanup = ended, duration, "stopping"
            if winner: row.output = {k: v.snapshot() for k, v in self.groups[winner].items()}
            db.add(Event(execution_id=row.id, task_id=row.task_id, kind="execution." + state, data={"winner": winner, "error": error, "duration_ms": duration}))
        return True

    @database_retry
    async def begin(self, started):
        async with self.app.state.database.sessions() as db, db.begin():
            row = await db.scalar(select(Execution).where(Execution.id == self.record.id).with_for_update())
            if row.state != "queued": return row.state == "running" and row.started == started
            row.state, row.started = "running", started
        return True

    async def run(self):
        if not await self.begin(now()): return
        await self.event("execution.started", {"trace_id": self.record.trace_id})
        self.workers = {nid: asyncio.create_task(self.run_node(n), name="node:" + nid) for nid, n in self.nodes.items()}
        await self.done.wait()
        await self.cleanup()

    async def run_node(self, node):
        nid, kind = node["id"], node["kind"]
        record = self.node_records[nid]
        output = self.groups[nid]
        start = None
        try:
            incoming = [e["source"] for e in self.graph["edges"] if e["target"] == nid]
            if kind == "start": inputs = {}
            elif kind == "assembly":
                inputs = {m["target"]: self.groups[m["source"]][m["field"]] for m in node["mappings"]}
                await group_ready(inputs)
            else:
                inputs = self.groups[incoming[0]]
                await group_ready(inputs)
            if self.done.is_set(): return
            if kind == "module":
                context = {"batch_id": self.record.batch_id, "execution_id": self.record.id, "node_id": nid, "pipeline_version_id": self.record.snapshot["pipeline"]["revision_id"],
                           "trace_id": self.record.trace_id, "span_id": record["span_id"], "parent_span_id": self.record.trace_id, "invocation_id": uid()}
                record["state"] = "preparing"
                await self.store_nodes()
                async with asyncio.timeout(self.graph["preparation_timeout"]):
                    runtime = await self.app.state.pods.acquire(node, context, self.graph["preparation_timeout"])
                if self.done.is_set(): return
                invocation = ModuleInvocation(self.app.state.pods, runtime, node, context, lambda kind, data: self.event(kind, data, nid))
                self.active[nid] = invocation
                record.update(runtime_id=runtime.id, image_id=runtime.image_id, invocation_id=context["invocation_id"])
                await self.event("module.ready", {"runtime_id": runtime.id, "image_id": runtime.image_id}, nid)
            start = time.monotonic()
            record.update(state="running", started_ms=(start - self.clock) * 1000, input={k: v.snapshot() for k, v in inputs.items()})
            await self.event("node.started", {"span_id": record["span_id"], "input": record["input"]}, nid)
            await self.store_nodes()
            async with asyncio.timeout(node["timeout"]):
                if kind == "start": await self.start_node(output)
                elif kind == "module": await self.active[nid].run(inputs, output)
                elif kind in {"assembly", "end"}:
                    await asyncio.gather(*(self.forward(inputs[name], field) for name, field in output.items()))
                elif kind == "conversion":
                    await asyncio.gather(*(self.convert(inputs[name], field) for name, field in output.items()))
            await asyncio.gather(*(persist_field(self.app, f, self.record.id, capture_text=kind == "start" and self.record.snapshot.get("live", False)) for f in output.values()))
            record.update(input={k: v.snapshot() for k, v in inputs.items()})
            record.update(state="succeeded", duration_ms=(time.monotonic() - start) * 1000, output={k: v.snapshot() for k, v in output.items()})
            await self.event("node.completed", {"output": record["output"], "duration_ms": record["duration_ms"]}, nid)
            if kind == "end": await self.terminal("succeeded", winner=nid)
        except asyncio.CancelledError:
            record["state"] = "canceled" if start else "not_started"
            await self.event("node.canceled", {"reason": "Execution terminal or module cancellation"}, nid)
            if not self.done.is_set():
                await self.terminal("failed", error={"code": "module_canceled", "node_id": nid, "message": "Module canceled before an execution terminal was accepted"})
        except Exception as error:
            code = ("preparation_timeout" if start is None and kind == "module" else "node_timeout") if isinstance(error, TimeoutError) else "runtime_lost" if "runtime_lost" in str(error) else "node_error"
            detail = {"code": code, "message": str(error)[:800] or "Node timeout", "node_id": nid}
            record.update(state="failed", error=detail, output={k: v.snapshot() for k, v in output.items()})
            if start: record["duration_ms"] = (time.monotonic() - start) * 1000
            await self.event("node.error", detail, nid)
            await self.terminal("failed", error=detail)
        finally:
            await self.store_nodes()

    async def start_node(self, output):
        if self.record.snapshot.get("live"):
            await group_ended(output)
            return
        for name, field in output.items():
            value = self.record.snapshot["inputs"][name]
            if field.spec["stream"]:
                if field.spec["type"] == "Text":
                    data = value["value"]; chunks = [data[i:i + 128] for i in range(0, len(data), 128)]
                    for seq, chunk in enumerate(chunks):
                        await field.put("chunk", {"data": chunk, "format": field.spec["format"], "seq": seq})
                else:
                    data = (self.app.state.settings.data_dir.resolve() / value["asset"]["data"]["blob"]).read_bytes()
                    chunks = [data[i:i + 32768] for i in range(0, len(data), 32768)]
                    for seq, chunk in enumerate(chunks):
                        await field.put("chunk", {"data": base64.b64encode(chunk).decode(), "encoding": "base64", "format": field.spec["format"], "seq": seq})
                if "asset" in value:
                    field.media_reference = {"asset_id": value["asset"]["id"], "asset_version": value["asset"]["selected_version"]}
                await field.put("eos", {"seq": len(chunks)})
            else:
                actual = value["value"] if "value" in value else {"asset_id": value["asset"]["id"], "asset_version": value["asset"]["selected_version"]}
                await field.put("value", {"value": actual})

    async def forward(self, source, target):
        if target.spec["stream"]:
            async for chunk in source.read(): await target.put("chunk", chunk)
            await persist_field(self.app, source, self.record.id)
            target.media_reference = source.media_reference
            await target.put("eos", {"seq": len(source.chunks)})
        else:
            await source.ended(); await target.put("value", {"value": source.value})

    async def convert(self, source, target):
        if source.spec["stream"] == target.spec["stream"]:
            await self.forward(source, target)
            return
        if target.spec["stream"]:
            await source.ended()
            value = source.value
            if target.spec["type"] == "Text":
                await target.put("chunk", {"seq": 0, "data": value, "format": target.spec["format"]})
            else:
                from testflow.infrastructure.revisions import get_resource
                async with self.app.state.database.sessions() as db:
                    asset = await get_resource(db, "assets", value["asset_id"], value["asset_version"])
                data = (self.app.state.settings.data_dir.resolve() / asset["data"]["blob"]).read_bytes()
                await target.put("chunk", {"seq": 0, "data": base64.b64encode(data).decode(), "encoding": "base64", "format": target.spec["format"]})
            await target.put("eos", {"seq": 1})
        else:
            await source.ended()
            if target.spec["type"] == "Text": value = "".join(c["data"] for c in source.chunks)
            else:
                value = await persist_field(self.app, source, self.record.id)
            await target.put("value", {"value": value})

    @database_retry
    async def capture_input(self):
        start = next(n for n in self.nodes.values() if n["kind"] == "start")
        fields = self.groups[start["id"]]
        if self.record.snapshot.get("live"):
            for field in fields.values():
                try: await persist_field(self.app, field, self.record.id, capture_text=True, allow_partial=True)
                except (DBAPIError, ConnectionError): raise
                except Exception:
                    await self.event("input.capture_error", {"field": field.spec["name"], "truncated": not field.eos}, start["id"])
        actual = {k: f.snapshot() for k, f in fields.items()}
        async with self.app.state.database.sessions() as db, db.begin():
            row = await db.get(Execution, self.record.id)
            row.actual_inputs = actual
        await self.event("input.capture", actual, start["id"])

    async def cleanup(self):
        deadline = self.graph["cleanup_timeout"]
        timed_out = False
        try:
            async with asyncio.timeout(deadline):
                evidence = await asyncio.gather(*(i.cancel() for i in self.active.values()), return_exceptions=True)
                await self.event("cleanup.cancel_requests", {"results": [e if isinstance(e, dict) else {"error": "cancel_failed"} for e in evidence]})
                waits = [i.stopped.wait() for i in self.active.values() if i.invocation_id]
                if waits: await asyncio.gather(*waits)
        except TimeoutError:
            timed_out = True
            evidence = await asyncio.gather(*(self.app.state.pods.terminate(i.runtime) for i in self.active.values() if not i.stopped.is_set()))
            await self.event("cleanup.timed_out", {"deadline": deadline, "pod_evidence": evidence})
        for task in self.workers.values():
            if not task.done(): task.cancel()
        await asyncio.gather(*self.workers.values(), return_exceptions=True)
        for record in self.node_records.values():
            if record["state"] == "pending": record.update(state="not_started", reason="Execution already terminal")
        await self.store_nodes()
        await self.capture_input()
        await self.finish_cleanup("timed_out" if timed_out else "stopped")
        await self.event("cleanup.completed", {"state": "timed_out" if timed_out else "stopped"})

    @database_retry
    async def finish_cleanup(self, state):
        async with self.app.state.database.sessions() as db, db.begin():
            row = await db.get(Execution, self.record.id)
            row.cleanup = state
