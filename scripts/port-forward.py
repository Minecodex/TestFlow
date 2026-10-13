"""Keep a localhost-only preview alive across test Deployment rollouts."""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import time
from kubernetes_support import add_cluster_arguments, namespace_target

ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--namespace',required=True);p.add_argument('--port',type=int,default=18800);add_cluster_arguments(p);args=p.parse_args()
if args.namespace != 'testflow' and not args.namespace.startswith('testflow-'):raise SystemExit('Use an explicit TestFlow namespace')
target=namespace_target(args.namespace,args)
env=target.environment
command=target.command(args.namespace)+['port-forward','--address=127.0.0.1','service/testflow-web',f'{args.port}:8080']
child=None;stopped=False
log=ROOT/'.data/kubernetes'/args.namespace/'port-forward.log';log.parent.mkdir(parents=True,exist_ok=True)
def stop(*_):
    global stopped
    stopped=True
    if child and child.poll() is None:
        try:os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError:pass
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
print(f'Local preview: http://127.0.0.1:{args.port}',flush=True)
with log.open('a') as output:
    while not stopped:
        child=subprocess.Popen(command,env=env,stdout=output,stderr=subprocess.STDOUT,start_new_session=True)
        child.wait()
        if not stopped:time.sleep(.5)
