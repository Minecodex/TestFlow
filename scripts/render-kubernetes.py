"""Generate a private installation manifest using the files bundled in the image."""
import argparse
from pathlib import Path
import sys

import yaml

from kubernetes_installation import create_installation, load_base_resources

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--namespace', required=True)
parser.add_argument('--port', type=int, default=18765)
parser.add_argument('--server-image', default='kakj/testflow-server:v0.0.1-beta')
parser.add_argument('--web-image', default='kakj/testflow-web:v0.0.1-beta')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
try:
    installation = create_installation(load_base_resources(root / 'deploy/k8s/base'),
                                       args.namespace, args.server_image, args.web_image, args.port)
except ValueError as error:
    parser.error(str(error))
yaml.safe_dump(installation.manifest(), sys.stdout, sort_keys=False)
