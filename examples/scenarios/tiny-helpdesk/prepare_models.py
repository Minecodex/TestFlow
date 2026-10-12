"""Keep the acoustic model and a small real pronunciation dictionary; discard the large LM."""
import hashlib
import json
from pathlib import Path
from pocketsphinx import get_model_path

root = Path(get_model_path()) / "en-us"
words = set("what is the refund policy how many days can i return an item shipping delivery support contact".split())
dictionary = root / "cmudict-en-us.dict"
lines = [line for line in dictionary.read_text().splitlines() if line.split()[0].split("(")[0] in words]
dictionary.write_text("\n".join(lines) + "\n")
for path in root.glob("*.lm.bin"):
    path.unlink()
Path("/app/helpdesk.gram").write_text(
    "#JSGF V1.0; grammar helpdesk; public <query> = "
    "what is the refund policy | how many days can i return an item | "
    "what is the shipping policy | what is the delivery policy | how can i contact support;\n"
)
inventory = {}
for name, folder in {"asr": root, "ocr": Path("/usr/share/tesseract-ocr/5/tessdata"), "tts": Path("/usr/lib/aarch64-linux-gnu/espeak-ng-data")}.items():
    if name == "tts" and not folder.exists():
        folder = Path("/usr/lib/x86_64-linux-gnu/espeak-ng-data")
    files = [p for p in folder.rglob("*") if p.is_file()]
    if name == "ocr":
        files = [p for p in files if p.name == "eng.traineddata"]
    inventory[name] = {"bytes": sum(p.stat().st_size for p in files), "files": len(files),
                       "sha256": hashlib.sha256(b"".join(p.read_bytes() for p in sorted(files))).hexdigest()}
Path("/app/models.json").write_text(json.dumps(inventory, indent=2) + "\n")
