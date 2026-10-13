"""Remove only owned disposable Kubernetes test resources; preserve local evidence."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import signal
import subprocess
import time
from kubernetes_support import kube_connection

parser = argparse.ArgumentParser()
parser.add_argument('--namespace', required=True)
args = parser.parse_args()
if not args.namespace.startswith(('testflow-e2e-', 'testflow-restore-')): raise SystemExit('Only disposable test namespaces may be removed')
root = Path(__file__).resolve().parents[1]
access = json.loads((root / '.data/kubernetes' / args.namespace / 'access.json').read_text())
cli, env = kube_connection(access)
lookup = subprocess.run(cli+['get', 'namespace', args.namespace, '-o', 'json', '--ignore-not-found'], env=env, text=True, capture_output=True, check=True).stdout
if lookup:
    ns = json.loads(lookup)
    if ns['metadata'].get('labels', {}).get('testflow-acceptance') != 'true': raise SystemExit('Namespace is not owned by acceptance')
processes = subprocess.run(['ps', '-axo', 'pid=,command='], text=True, capture_output=True, check=True).stdout
signaled = []
for line in processes.splitlines():
    tokens = line.split()
    if len(tokens)<3:continue
    supervisor=any(t=='scripts/port-forward.py' or t.endswith('/scripts/port-forward.py') for t in tokens)
    if supervisor:
        owned='--namespace' in tokens and tokens[tokens.index('--namespace')+1]==args.namespace
    else:
        binary=Path(tokens[1]).name
        context='--context='+access['context']
        config='--kubeconfig='+access['kubeconfig']
        owned=(binary=='kubectl' and 'port-forward' in tokens and '-n' in tokens
            and tokens[tokens.index('-n')+1]==args.namespace and context in tokens and config in tokens)
    if not owned:continue
    try:
        os.kill(int(tokens[0]), signal.SIGTERM)
        signaled.append(int(tokens[0]))
    except ProcessLookupError: pass
if lookup:
    subprocess.run(cli+['delete','namespace',args.namespace,'--wait=true','--timeout=120s'], env=env, check=True, capture_output=True, text=True)
remaining = subprocess.run(cli+['get','namespace',args.namespace,'-o','json','--ignore-not-found'], env=env, check=True, capture_output=True, text=True).stdout
if remaining: raise SystemExit('Namespace is still present; cleanup is not complete')
deadline = time.monotonic() + 90
while True:
    volumes = json.loads(subprocess.run(cli + ['get', 'pv', '-o', 'json'], env=env,
                                       check=True, capture_output=True, text=True).stdout)['items']
    if not any(item['spec'].get('claimRef', {}).get('namespace') == args.namespace for item in volumes):
        break
    if time.monotonic() >= deadline:
        raise SystemExit('Temporary persistent volumes are still present')
    time.sleep(1)
evidence = root / '.data/acceptance' / args.namespace / 'cleanup.json'
evidence.parent.mkdir(parents=True,exist_ok=True)
evidence.write_text(json.dumps({'namespace':args.namespace,'context':access['context'],
    'namespace_absent':True,'persistent_volumes_absent':True,'port_forward_processes_signaled':signaled,
    'local_evidence_preserved':True,'completed_at':datetime.now(timezone.utc).isoformat()},indent=2)+'\n')
print(args.namespace, 'resources reclaimed; local evidence preserved')
