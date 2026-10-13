import asyncio
import json
import os
import shutil
import tarfile
import tempfile
from pathlib import Path

from testflow.features.auth import credential_value
from testflow.infrastructure.revisions import get_resource, save_resource
from testflow.infrastructure.models import now


async def command(*args, cwd=None, env=None, stdout=None):
    process = await asyncio.create_subprocess_exec(*args, cwd=cwd, env=env, stdout=stdout or asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        async with asyncio.timeout(120):
            output, _ = await process.communicate()
    except BaseException:
        process.kill(); await process.wait()
        raise
    if process.returncode:
        # Git stderr may include credential-bearing redirect URLs; never persist it.
        raise RuntimeError("Git command failed; check repository access and branch")
    return output.decode().strip() if output else ""


async def sync_repository(app, payload):
    repo = payload["resource"]
    settings = app.state.settings
    root = settings.data_dir.resolve() / "repositories" / repo["id"]
    root.mkdir(parents=True, exist_ok=True)
    mirror = root / "mirror.git"
    async with app.state.database.sessions() as db:
        secret = await credential_value(db, settings, repo["data"].get("credential_id"))
    with tempfile.TemporaryDirectory(prefix="testflow-git-") as authdir:
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        if secret:
            try: credentials = json.loads(secret)
            except json.JSONDecodeError: credentials = {"private_key": secret} if secret.startswith("-----BEGIN") else {"username": "oauth2", "password": secret}
            if credentials.get("private_key"):
                key = Path(authdir) / "key"; key.write_text(credentials["private_key"]); key.chmod(0o600)
                known = credentials.get("known_hosts")
                options = ""
                if known:
                    hosts = Path(authdir) / "known_hosts"; hosts.write_text(known); hosts.chmod(0o600)
                    options = f" -o UserKnownHostsFile={hosts}"
                env["GIT_SSH_COMMAND"] = f"ssh -i {key} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes" + options
            else:
                if not credentials.get("username") or not credentials.get("password"):
                    raise RuntimeError("Git HTTP credential requires a token or username/password JSON")
                datafile = Path(authdir) / "credentials.json"; datafile.write_text(json.dumps(credentials)); datafile.chmod(0o600)
                helper = Path(authdir) / "askpass"
                helper.write_text("#!/usr/bin/env python3\nimport json,os,sys\nv=json.load(open(os.environ['TESTFLOW_GIT_SECRET_FILE']))\nprint(v['username' if 'username' in sys.argv[1].lower() else 'password'])\n")
                helper.chmod(0o700)
                env.update(GIT_ASKPASS=str(helper), TESTFLOW_GIT_SECRET_FILE=str(datafile))
        if not mirror.exists(): await command("git", "init", "--bare", str(mirror), env=env)
        await command("git", "-c", "credential.helper=", "fetch", "--force", repo["data"]["url"], repo["data"]["branch"], cwd=mirror, env=env)
        commit = await command("git", "rev-parse", "FETCH_HEAD^{commit}", cwd=mirror, env=env)
        code = root / commit
        if not code.exists():
            with tempfile.TemporaryDirectory(dir=root, prefix="archive-") as staging:
                archive = Path(staging) / "code.tar"
                with archive.open("wb") as output:
                    await command("git", "archive", commit, cwd=mirror, env=env, stdout=output)
                destination = Path(staging) / "code"; destination.mkdir()
                with tarfile.open(archive) as source: source.extractall(destination, filter="data")
                for path in destination.rglob("*"):
                    if not path.is_symlink(): path.chmod(0o555 if path.is_dir() or path.stat().st_mode & 0o111 else 0o444)
                destination.rename(code)
    relative = str(code.relative_to(settings.data_dir.resolve()))
    async with app.state.database.sessions() as db, db.begin():
        current = await get_resource(db, "repositories", repo["id"], lock=True)
        if current["version"] != repo["version"]:
            return {"commit": commit, "code_path": relative, "superseded": True, "message": "New repository configuration preserved"}
        data = {**repo["data"], "commit": commit, "commits": list(dict.fromkeys([commit, *repo["data"].get("commits", [])])), "code_path": relative, "sync_state": "ready", "synced_at": now().isoformat()}
        result = await save_resource(db, "repositories", data, repo["id"], repo["version"])
        return {"resource_id": repo["id"], "version": result["version"], "commit": commit, "code_path": relative}
