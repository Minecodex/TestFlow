"""Quiesce the single backend and save a consistent DB/PVC backup without secret output."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from datetime import UTC, datetime
from kubernetes_support import add_cluster_arguments, namespace_target

ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--namespace',required=True);add_cluster_arguments(p);p.add_argument('--output',type=Path);args=p.parse_args()
if args.namespace != 'testflow' and not args.namespace.startswith('testflow-'):raise SystemExit('Use an explicit TestFlow namespace')
target=namespace_target(args.namespace,args);env=target.environment
cli=target.command(args.namespace)
def run(*cmd,**options):return subprocess.run(cli+list(cmd),env=env,check=True,capture_output=True,**options)
output=args.output or ROOT/'.data/backups'/f'{args.namespace}-{datetime.now(UTC):%Y%m%dT%H%M%SZ}';output.mkdir(parents=True,exist_ok=False);output.chmod(0o700)
active=run('exec','testflow-postgres-0','--','psql','-U','testflow','-d','testflow','-Atc',"SELECT (SELECT count(*) FROM executions WHERE state IN ('queued','running') OR cleanup='stopping') + (SELECT count(*) FROM operations WHERE state IN ('queued','running'))").stdout.decode().strip()
if active!='0':raise SystemExit('Wait for active executions and operations before backup')
server_pods=json.loads(run('get','pods','-l','app=testflow-server','-o','json').stdout)['items']
backend_node=server_pods[0]['spec']['nodeName'] if server_pods else None
server=json.loads(run('get','deployment','testflow-server','-o','json').stdout)
replicas=server['spec']['replicas']
run('scale','deployment/testflow-server','--replicas=0')
try:
    run('wait','--for=delete','pod','-l','app=testflow-server','--timeout=50s')
    # Reuse the migration image for filesystem access on the same PVC.
    manifest={'apiVersion':'v1','kind':'Pod','metadata':{'name':'testflow-backup'},'spec':{'restartPolicy':'Never','automountServiceAccountToken':False,'securityContext':{'runAsUser':10001,'runAsNonRoot':True,'fsGroup':10001},'containers':[{'name':'backup','image':server['spec']['template']['spec']['containers'][0]['image'],'imagePullPolicy':'IfNotPresent','command':['sleep','300'],'volumeMounts':[{'name':'data','mountPath':'/data','readOnly':True}]}],'volumes':[{'name':'data','persistentVolumeClaim':{'claimName':'testflow-data','readOnly':True}}]}}
    if backend_node:manifest['spec']['nodeName']=backend_node
    run('apply','-f','-',input=json.dumps(manifest).encode())
    run('wait','--for=condition=Ready','pod/testflow-backup','--timeout=50s')
    for filename,command in [('database.dump',['exec','testflow-postgres-0','--','pg_dump','--username=testflow','--dbname=testflow','--format=custom']),('data.tar',['exec','testflow-backup','--','tar','-cf','-','-C','/data','.'])]:
        with (output/filename).open('wb') as destination:
            subprocess.run(cli+command,env=env,check=True,stdout=destination,stderr=subprocess.PIPE)
        (output/filename).chmod(0o600)
    # Encryption key must accompany a backup; store the existing Secret only in the private archive.
    secrets=run('get','secret','testflow-secrets','testflow-postgres-secret','-o','json').stdout
    (output/'secrets.json').write_bytes(secrets);(output/'secrets.json').chmod(0o600)
    (output/'metadata.json').write_text(json.dumps({'namespace':args.namespace,**target.access_fields(),'created':datetime.now(UTC).isoformat(),'replicas':replicas,'schema':'alembic head','image':server['spec']['template']['spec']['containers'][0]['image']},indent=2))
    access=ROOT/'.data/kubernetes'/args.namespace/'access.json'
    if access.exists():(output/'access.json').write_bytes(access.read_bytes());(output/'access.json').chmod(0o600)
    print('Private backup saved:',output)
finally:
    try:run('delete','pod','testflow-backup','--ignore-not-found','--wait=false')
    finally:run('scale','deployment/testflow-server','--replicas='+str(replicas))
