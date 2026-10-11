"""Disposable, non-private files for the browser import checks."""
from pathlib import Path
import math
import struct
import sys
import wave
import zipfile

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/testflow-ui-audit')
root.mkdir(parents=True, exist_ok=True)
(root / 'input.txt').write_text('E2E imported text', encoding='utf-8')
(root / 'input.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="300" height="160" fill="#dcebcf"/><text x="40" y="80">E2E fixture</text></svg>', encoding='utf-8')
(root / 'invalid.wav').write_text('Not an audio file', encoding='utf-8')
with wave.open(str(root / 'input.wav'), 'wb') as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(16000)
    audio.writeframes(b''.join(struct.pack('<h', int(1000 * math.sin(i * math.pi / 20))) for i in range(4000)))
with zipfile.ZipFile(root / 'module.zip', 'w') as package:
    package.writestr('README.md', 'Metadata-only UI fixture; the prototype does not unpack this ZIP.')
print(root)
