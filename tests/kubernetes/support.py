"""Wait for the localhost port-forward and backend after a completed rollout, without repeating writes."""
import asyncio
import httpx
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from kubernetes_support import KubernetesTarget, kube_connection, load_local_images, remove_local_images

async def wait_api(http):
    async with asyncio.timeout(30):
        while True:
            try:
                response = await http.get('/auth/session', timeout=3)
                if response.status_code in {200, 401}: return
            except httpx.HTTPError: pass
            await asyncio.sleep(.25)
