"""Restore into an empty, explicitly named TestFlow installation only."""
import argparse
import base64
import json
import os
from pathlib import Path
import subprocess
from kubernetes_support import add_cluster_arguments, namespace_target

ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--namespace',required=True);p.add_argument('--backup',required=True,type=Path);add_cluster_arguments(p);args=p.parse_args()
if not args.namespace.startswith('testflow-'):raise SystemExit('Restore requires an explicit TestFlow namespace')
target=namespace_target(args.namespace,args);env=target.environment
cli=target.command(args.namespace)
def run(*cmd,**options):return subprocess.run(cli+list(cmd),env=env,check=True,capture_output=True,**options)
count=run('exec','testflow-postgres-0','--','psql','-U','testflow','-d','testflow','-Atc','SELECT (SELECT count(*) FROM resources) + (SELECT count(*) FROM executions)').stdout.decode().strip()
if count!='0':raise SystemExit('Destination contains business data; it is preserved')
server=json.loads(run('get','deployment','testflow-server','-o','json').stdout);replicas=server['spec']['replicas']
run('scale','deployment/testflow-server','--replicas=0')
try:
    run('wait','--for=delete','pod','-l','app=testflow-server','--timeout=50s')
    secrets=json.loads((args.backup/'secrets.json').read_text())
    for item in secrets['items']:item['metadata']={'name':item['metadata']['name'],'namespace':args.namespace}
    run('apply','-f','-',input=json.dumps(secrets).encode())
    postgres=next(item for item in secrets['items'] if item['metadata']['name']=='testflow-postgres-secret')
    password=base64.b64decode(postgres['data']['password']).decode()
    sql="ALTER ROLE testflow WITH PASSWORD '"+password.replace("'","''")+"';"
    run('exec','-i','testflow-postgres-0','--','psql','-U','testflow','-d','testflow',input=sql.encode())
    with (args.backup/'database.dump').open('rb') as source:
        subprocess.run(cli+['exec','-i','testflow-postgres-0','--','pg_restore','--clean','--if-exists','--username=testflow','--dbname=testflow'],env=env,check=True,stdin=source,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    manifest={'apiVersion':'v1','kind':'Pod','metadata':{'name':'testflow-restore'},'spec':{'restartPolicy':'Never','automountServiceAccountToken':False,'securityContext':{'runAsNonRoot':True,'runAsUser':10001,'fsGroup':10001},'containers':[{'name':'restore','image':server['spec']['template']['spec']['containers'][0]['image'],'imagePullPolicy':'IfNotPresent','command':['sleep','300'],'volumeMounts':[{'name':'data','mountPath':'/data'}]}],'volumes':[{'name':'data','persistentVolumeClaim':{'claimName':'testflow-data'}}]}}
    run('apply','-f','-',input=json.dumps(manifest).encode());run('wait','--for=condition=Ready','pod/testflow-restore','--timeout=50s')
    with (args.backup/'data.tar').open('rb') as source:
        restored=subprocess.run(cli+['exec','-i','testflow-restore','--','python','-c',(ROOT/'scripts/restore-files.py').read_text()],env=env,stdin=source,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        if restored.returncode:raise RuntimeError('File restore failed: '+restored.stderr.decode()[-1000:])
    source_access=args.backup/'access.json'
    destination=ROOT/'.data/kubernetes'/args.namespace/'access.json'
    if source_access.exists() and destination.exists():
        source=json.loads(source_access.read_text());target=json.loads(destination.read_text())
        target.update(password=source['password'],encryption_key=source['encryption_key'])
        destination.write_text(json.dumps(target,indent=2));destination.chmod(0o600)
        password_file=destination.parent/'admin-initial-password'
        password_file.write_text(source['password']+'\n');password_file.chmod(0o600)
    print('Restored database, PVC and encrypted vault into the empty destination.')
finally:
    try:run('delete','pod','testflow-restore','--ignore-not-found','--wait=false')
    finally:run('scale','deployment/testflow-server','--replicas='+str(replicas))
