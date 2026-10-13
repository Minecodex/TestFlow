import json
from pathlib import Path
from testflow.main import create_app
root=Path(__file__).resolve().parents[1]
(root/'contracts/openapi.json').write_text(json.dumps(create_app().openapi(),ensure_ascii=False,indent=2)+'\n')
