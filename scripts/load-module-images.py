"""Load explicitly built example images into Docker Desktop Kubernetes."""
import argparse
import json
from pathlib import Path
from kubernetes_support import KubernetesTarget, add_cluster_arguments, load_local_images

parser = argparse.ArgumentParser()
parser.add_argument("--index", type=Path, required=True)
add_cluster_arguments(parser)
args = parser.parse_args()
index = json.loads(args.index.read_text())
modules = index["modules"] if isinstance(index, dict) else index
images = [item["image"] for item in modules]
if not images or not all(isinstance(image, str) and image and not any(c.isspace() for c in image) for image in images):
    raise SystemExit("Index must contain explicit image references")
load_local_images(KubernetesTarget.from_args(args), images)
