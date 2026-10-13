"""Download public example artifacts at one immutable GitHub revision and verify checksums."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from urllib.parse import quote
from urllib.request import urlopen


def get(url):
    with urlopen(url, timeout=45) as response:
        value = response.read(4 * 1024 * 1024 + 1)
        if len(value) > 4 * 1024 * 1024:
            raise ValueError("Example artifact exceeds 4 MiB")
        return value


def download(destination, *, ref="feature/v0.0.1-beta", base_url=None):
    if base_url is None:
        # Resolve a mutable branch once; index, ZIPs and workflows then share the same Git commit.
        data = json.loads(get("https://api.github.com/repos/Minecodex/TestFlow/commits/" + quote(ref, safe="")))
        artifact_commit = data["sha"]
        base_url = "https://raw.githubusercontent.com/Minecodex/TestFlow/" + artifact_commit + "/examples/repository-helpdesk/"
        source = {"kind": "github", "artifact_commit": artifact_commit, "base_url": base_url}
    else:
        # Acceptance uses this only for unpublished working-tree artifacts.
        source = {"kind": "unpublished_http_fixture", "base_url": base_url}
    base_url = base_url.rstrip("/") + "/"
    index_bytes = get(base_url + "downloads/index.json")
    index = json.loads(index_bytes)
    if index.get("format") != "testflow.example.v1":
        raise ValueError("Unsupported example artifact index")
    files = []
    prefixes = {"modules": ("downloads", "modules"), "workflows": ("workflows",), "assets": ("downloads", "assets"), "datasets": ("datasets",)}
    for group, digest_key in [("modules", "package_digest"), ("workflows", "sha256"), ("assets", "sha256"), ("datasets", "sha256")]:
        for item in index.get(group, []):
            path = PurePosixPath(item["file"])
            prefix = prefixes[group]
            if path.is_absolute() or ".." in path.parts or "\\" in item["file"] or path.parts[:-1] != prefix:
                raise ValueError("Unsafe artifact path")
            content = get(base_url + quote(str(path), safe="/"))
            checksum = hashlib.sha256(content).hexdigest()
            if checksum != item[digest_key]:
                raise ValueError("Example artifact checksum mismatch: " + str(path))
            files.append((path, content))
    # No partially checked artifact set is returned after a failed download.
    for path, content in files:
        output = destination / str(path)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(content)
    (destination / "downloads/index.json").write_bytes(index_bytes)
    (destination / "download-source.json").write_text(json.dumps(source, indent=2) + "\n")
    return index, source


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ref", default="feature/v0.0.1-beta")
    parser.add_argument("--output", type=Path, default=Path(".data/downloaded-repository-example"))
    args = parser.parse_args()
    index, source = download(args.output, ref=args.ref)
    print(json.dumps({group: len(index.get(group, [])) for group in ["modules", "workflows", "assets", "datasets"]} | source))
