"""Package an immutable UI failure fixture; it never enters the default installation."""
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
output = Path('/tmp/testflow-ui-audit/ui-failure.zip')
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(root / '.data/module-packages/test-fixture-1.0.2.zip') as source:
    manifest = json.loads(source.read('manifest.json'))
    manifest.update(id='test-ui-failure', name='TEST UI component failure', version='1.0.0')
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as target:
        for name in source.namelist():
            content = source.read(name)
            if name == 'manifest.json': content = json.dumps(manifest).encode()
            elif name == manifest['ui']: content = (root / 'tests/fixtures/ui-failure.mjs').read_bytes()
            target.writestr(name, content)
print(output)
