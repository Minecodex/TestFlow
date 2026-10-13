"""Verify the two deployable images with read-only filesystems and real proxying."""
import json
import subprocess
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def docker(*args):
    return subprocess.check_output(["docker", *args], text=True).strip()


def response(url):
    with urlopen(url, timeout=3) as result:
        return result.status, result.headers, result.read()


def main():
    suffix = uuid.uuid4().hex[:10]
    network, volume = f"testflow-smoke-{suffix}", f"testflow-data-{suffix}"
    server, web = f"testflow-server-{suffix}", f"testflow-web-{suffix}"
    try:
        docker("network", "create", network)
        docker("volume", "create", volume)
        # Kubernetes fsGroup makes the PVC writable; reproduce that ownership here.
        docker("run", "--rm", "--user", "0", "-v", f"{volume}:/data",
               "--entrypoint", "chown", "testflow-server:dev", "10001:10001", "/data")
        docker("run", "-d", "--name", server, "--network", network,
               "--network-alias", "testflow-server", "--read-only", "--cap-drop", "ALL",
               "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:uid=10001,gid=10001",
               "-v", f"{volume}:/data", "testflow-server:dev")
        docker("run", "-d", "--name", web, "--network", network,
               "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
               "--tmpfs", "/tmp:uid=101,gid=101", "-p", "127.0.0.1::8080", "testflow-web:dev")
        port = docker("port", web, "8080/tcp").rsplit(":", 1)[1]
        origin = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            try:
                status, _, body = response(origin + "/api/v1/system/status")
                if status == 200:
                    break
            except (URLError, HTTPError, TimeoutError, ConnectionError):
                pass
            time.sleep(0.25)
        else:
            for name in (server, web):
                subprocess.run(["docker", "logs", "--tail", "80", name], check=False)
            raise RuntimeError("Containers did not become available")
        assert json.loads(body)["architecture"] == "monolith"
        assert json.loads(response(origin + "/healthz")[2]) == {"status": "ok"}
        for route in ("/", "/repositories", "/modules", "/assets?q=test", "/assets/fixture", "/datasets", "/pipelines", "/evaluation-profiles", "/test-tasks", "/executions", "/missing-foundation-page"):
            assert b'<div id="root"></div>' in response(origin + route)[2], route
        assert response(origin + "/index.html")[1]["Cache-Control"] == "no-store"
        try:
            response(origin + "/static/missing.js")
            raise AssertionError("Missing static asset must return 404")
        except HTTPError as error:
            assert error.code == 404
        health = docker("exec", server, "python", "-c",
                        "from urllib.request import urlopen; print(urlopen('http://127.0.0.1:8000/health/ready').read().decode())")
        assert json.loads(health) == {"status": "ready"}
        assert docker("exec", server, "id", "-u") == "10001"
        assert docker("exec", web, "id", "-u") == "101"
        assert docker("exec", server, "test", "-d", "/data/module-packages") == ""
        print("PASS: images, non-root/read-only runtime, writable data, readiness, API proxy, SPA reload, cache and asset 404")
    finally:
        for name in (web, server):
            subprocess.run(["docker", "rm", "-f", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["docker", "volume", "rm", volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(["docker", "network", "rm", network], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
