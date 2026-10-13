"""Post-rollout read-after-write and original-audio transfer checks using real FFmpeg."""
import argparse
import asyncio
import io
import json
from pathlib import Path
import sys
import zipfile

from support import wait_api

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "examples/repository-helpdesk"))
from install import Installer


async def run(namespace):
    if not namespace.startswith("testflow-e2e-"):
        raise ValueError("Use a disposable acceptance namespace")
    workspace = Installer(namespace)
    output = ROOT / ".data/acceptance" / namespace
    evidence = {"namespace": namespace, "checks": [], "passed": False}
    try:
        await wait_api(workspace.http)
        for _ in range(20):
            await workspace.call("POST", "/auth/login", {"username": workspace.access["username"], "password": workspace.access["password"]})
            assert (await workspace.call("GET", "/auth/session"))["username"] == "admin"
        evidence["checks"].append("twenty_login_responses_immediately_followed_by_valid_session_reads")
        for i in range(5):
            asset = await workspace.call("POST", "/assets", {"name": "Transaction probe " + str(i), "type": "Text", "text": "commit then read"})
            assert (await workspace.call("GET", "/assets/" + asset["id"]))["data"]["text"] == "commit then read"
            await workspace.call("POST", "/assets/" + asset["id"] + "/hide")
        evidence["checks"].append("five_created_assets_immediately_read_after_success_response")
        source = (ROOT / "examples/repository-helpdesk/inputs/question.wav").read_bytes()
        uploaded = await workspace.call("POST", "/media/upload?source=synthetic-original-e2e", files={"files": ("Original audio transfer probe.wav", source, "audio/wav")})
        assert not uploaded["items"][0]["error"]
        asset = uploaded["items"][0]["resource"]
        exported = await workspace.http.post("/assets/export", json={"assets": [{"id": asset["id"], "version": 1}]})
        exported.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(exported.content)) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            entry = manifest["assets"][0]
            assert entry["original"] and archive.read(entry["original"]["path"]) == source
            assert "sample_rate" not in entry["metadata"]
        original = await workspace.http.get(f"/media/{asset['id']}?version=1&original=true")
        assert original.status_code == 200 and original.content == source
        evidence["checks"].append("actual_ffmpeg_upload_export_preserves_exact_original_audio")
        preview = await workspace.call("POST", "/assets/import/preview", files={"file": ("original.assets.zip", exported.content)})
        assert preview["items"][0]["state"] == "reuse"
        imported = await workspace.call("POST", "/assets/import", files={"file": ("original.assets.zip", exported.content)})
        assert imported["reused"] == 1 and imported["items"][0]["resource"]["id"] == asset["id"]
        evidence["checks"].append("actual_ffmpeg_package_original_decode_and_reimport_reuses_identity")
        partial = await workspace.http.get(f"/media/{asset['id']}?version=1&original=true", headers={"Range": "bytes=0-63"})
        assert partial.status_code == 206 and partial.content == source[:64]
        await workspace.call("POST", "/assets/" + asset["id"] + "/hide")
        assert (await workspace.http.get(f"/media/{asset['id']}?version=1&original=true")).status_code == 200
        evidence["checks"].append("original_audio_range_and_hidden_historical_reads_remain_available")
        (output / "original.assets.zip").write_bytes(exported.content)
        evidence["passed"] = True
    except Exception as error:
        evidence["error"] = {"type": type(error).__name__, "message": str(error)[:1500]}
        raise
    finally:
        output.mkdir(parents=True, exist_ok=True)
        (output / "transaction-and-media.json").write_text(json.dumps(evidence, indent=2) + "\n")
        await workspace.http.aclose()
    print(json.dumps({"passed": evidence["passed"], "checks": len(evidence["checks"])}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--namespace", required=True)
    asyncio.run(run(parser.parse_args().namespace))
