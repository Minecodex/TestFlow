"""Select inexpensive PR checks from the complete Git diff."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess


def classify(paths):
    selected = dict.fromkeys(('backend', 'web', 'demo', 'tooling'), False)
    for path in paths:
        if path.lower().endswith('.md'):
            continue
        if path.startswith('.github/') or path.startswith('scripts/ci_'):
            return dict.fromkeys(selected, True)
        if path in {'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'}:
            selected.update(web=True, demo=True)
        elif path.startswith(('web/', 'packages/')):
            selected['web'] = True
        elif path.startswith(('server/', 'contracts/')):
            selected.update(backend=True, tooling=True)
            if path.startswith('contracts/'):
                selected['web'] = True
        elif path.startswith(('scripts/', 'deploy/', 'tests/test_')):
            selected['tooling'] = True
        elif path == 'docs/demo.html' or path.startswith('tests/'):
            selected['demo'] = True
        elif path.startswith('examples/'):
            selected.update(backend=True, demo=True, tooling=True)
        elif path.startswith('docs/') or path in {'.gitignore', 'LICENSE'}:
            continue
        else:
            return dict.fromkeys(selected, True)
    return selected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.base):
        parser.error('The base must be a complete Git commit SHA')
    paths = subprocess.check_output(['git', 'diff', '--no-renames', '--name-only', '-z', args.base, 'HEAD']).decode().split('\0')
    selected = classify([path for path in paths if path])
    if destination := os.environ.get('GITHUB_OUTPUT'):
        with Path(destination).open('a') as output:
            for name, value in selected.items():
                output.write(f'{name}={str(value).lower()}\n')
    print(json.dumps(selected))


if __name__ == '__main__':
    main()
