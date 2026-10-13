"""Inject browser recovery failures only into an owned disposable acceptance namespace."""
import argparse
import json
import os
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--namespace', required=True)
parser.add_argument('action', choices=['expire-sessions', 'pause-database', 'resume-database'])
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
if not args.namespace.startswith('testflow-e2e-'): raise SystemExit('Only disposable e2e namespaces are allowed')
access = json.loads((root / '.data/kubernetes' / args.namespace / 'access.json').read_text())
cli, env = kube_connection(access, args.namespace)
def kube(*command, stdin=None):
    return subprocess.run(cli+list(command), input=stdin, env=env, text=True, check=True, capture_output=True).stdout
namespace = json.loads(kube('get', 'namespace', args.namespace, '-o', 'json'))
if namespace['metadata'].get('labels', {}).get('testflow-acceptance') != 'true': raise SystemExit('Namespace is not owned by acceptance')
if args.action == 'expire-sessions':
    pod = json.loads(kube('get', 'pods', '-l', 'app=testflow-server', '-o', 'json'))['items'][0]['metadata']['name']
    source = '''import asyncio
from datetime import timedelta
from sqlalchemy import update
from testflow.core.config import Settings
from testflow.infrastructure.database import Database
from testflow.infrastructure.models import Session, now
async def main():
 d=Database(Settings())
 async with d.sessions() as s,s.begin():
  await s.execute(update(Session).values(expires=now()-timedelta(seconds=1)))
 await d.close()
asyncio.run(main())
'''
    kube('exec', '-i', pod, '--', '/app/.venv/bin/python', '-', stdin=source)
else:
    replicas = '0' if args.action == 'pause-database' else '1'
    kube('scale', 'statefulset/testflow-postgres', '--replicas='+replicas)
    if replicas == '1': kube('rollout', 'status', 'statefulset/testflow-postgres', '--timeout=90s')
    else: kube('wait', '--for=delete', 'pod/testflow-postgres-0', '--timeout=90s')
print(args.namespace, args.action, 'complete')
