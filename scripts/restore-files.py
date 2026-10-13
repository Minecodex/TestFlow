"""Restore a private data archive while preserving the PVC root's ownership."""
import os
import sys
import tarfile
from pathlib import Path

directories = []
with tarfile.open(fileobj=sys.stdin.buffer, mode='r|*') as archive:
    for member in archive:
        if member.name in {'.', './'}:
            continue
        safe = tarfile.data_filter(member, '/data')
        if safe is None:
            continue
        archive.extract(safe, '/data', set_attrs=False, filter='data')
        path = Path('/data') / safe.name
        if safe.isdir():
            directories.append((path, member.mode & 0o755, safe.mtime))
        elif safe.isfile():
            os.chmod(path, safe.mode)
            os.utime(path, (safe.mtime, safe.mtime))
for path, mode, mtime in reversed(directories):
    os.chmod(path, mode)
    os.utime(path, (mtime, mtime))
