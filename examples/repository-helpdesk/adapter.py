"""The image hosts the protocol; business functions are loaded only from the Git mount."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from uuid import uuid4

ROOT = Path("/workspace/repository")
SOURCE = ROOT / "examples/scenarios/tiny-helpdesk/processors.py"
KNOWLEDGE = ROOT / "examples/scenarios/tiny-helpdesk/project/knowledge.json"
if not SOURCE.is_file() or not KNOWLEDGE.is_file():
    raise RuntimeError("Mount the pinned TestFlow repository at /workspace/repository")
spec = importlib.util.spec_from_file_location("testflow_example_business", SOURCE)
business = importlib.util.module_from_spec(spec)
spec.loader.exec_module(business)
SOURCE_DIGEST = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
IDENTIFIERS = {"repo-asr": "tiny-asr", "repo-ocr": "tiny-ocr", "repo-kimi": "kimi-answer", "repo-tts": "tiny-tts"}


async def execute(identifier, body, send):
    context = body["context"]
    function = business.retrieve if identifier == "repo-bm25" else business.execute
    await send("trace", trace_id=context["trace_id"], span_id=str(uuid4()), parent_span_id=context["span_id"],
               name="repository_code_import", path=str(SOURCE), sha256=SOURCE_DIGEST,
               function_source=function.__code__.co_filename, mount_readonly=bool(os.statvfs(ROOT).f_flag & os.ST_RDONLY),
               function="retrieve" if identifier == "repo-bm25" else "execute")
    if identifier == "repo-bm25":
        # This adapter translates the platform field group and locates the repository's data.
        # Ranking itself is the function imported from that repository, not an image copy.
        query = body["inputs"]["query"]["value"]
        documents = json.loads(KNOWLEDGE.read_text())
        hits = business.retrieve(query, documents, body["parameters"]["top_k"])
        await send("trace", trace_id=context["trace_id"], span_id=str(uuid4()), parent_span_id=context["span_id"],
                   name="bm25_retrieval", documents=len(documents), hits=[d["id"] for d in hits])
        await send("output.value", field="query", value=query)
        await send("output.value", field="context", value={"engine": "builtin_bm25", "documents": hits})
    else:
        await business.execute(IDENTIFIERS[identifier], body, send)
