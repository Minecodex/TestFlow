"""One append-only source with independent cursors for every downstream reader.

Advanced bounded buffering and slow-consumer policy remain outside v1 (Q56).
"""
import asyncio
import base64
import binascii
from copy import deepcopy


class FieldChannel:
    def __init__(self, spec):
        self.spec = spec
        self.value = None
        self.media_reference = None
        self.origin = "stream_output"
        self.persist_lock = asyncio.Lock()
        self.chunks = []
        self.eos = False
        self.error = None
        self.available = asyncio.Event()
        self.complete = asyncio.Event()
        self.changed = asyncio.Condition()

    async def put(self, kind, payload):
        async with self.changed:
            if self.complete.is_set(): raise ValueError("Data after field completion")
            if kind == "value":
                if self.spec["stream"]: raise ValueError("Streaming fields require chunks and EOS")
                if self.spec["type"] == "Text" and not isinstance(payload.get("value"), str):
                    raise ValueError("Text values must be strings")
                if self.spec["type"] in {"Audio", "Image"} and (not isinstance(payload.get("value"), dict) or not payload["value"].get("asset_id") or not payload["value"].get("asset_version")):
                    raise ValueError("Media values require immutable asset references")
                self.value = deepcopy(payload["value"])
                self.available.set(); self.complete.set()
            elif kind == "chunk":
                if not self.spec["stream"]: raise ValueError("Static fields cannot receive chunks")
                if payload.get("seq") != len(self.chunks): raise ValueError("Non-contiguous stream sequence")
                if payload.get("format") != self.spec["format"]: raise ValueError("Stream format mismatch")
                if self.spec["type"] == "Text" and not isinstance(payload.get("data"), str): raise ValueError("Text chunks must be incremental strings")
                if self.spec["type"] != "Text" and payload.get("encoding") != "base64": raise ValueError("Media chunks require base64 encoding")
                if self.spec["type"] != "Text":
                    try: base64.b64decode(payload.get("data", ""), validate=True)
                    except (ValueError, TypeError, binascii.Error): raise ValueError("Invalid base64 media chunk")
                self.chunks.append(deepcopy(payload)); self.available.set()
            elif kind == "eos":
                if not self.spec["stream"] or payload.get("seq") != len(self.chunks): raise ValueError("EOS must follow all stream chunks")
                self.eos = True; self.available.set(); self.complete.set()
            else: raise ValueError("Unknown field event")
            self.changed.notify_all()

    async def abort(self, error):
        async with self.changed:
            self.error = error; self.available.set(); self.complete.set(); self.changed.notify_all()

    async def ready(self):
        await self.available.wait()
        if self.error: raise RuntimeError(self.error)

    async def ended(self):
        await self.complete.wait()
        if self.error: raise RuntimeError(self.error)
        if self.spec["stream"] and not self.eos: raise RuntimeError("Stream truncated without normal EOS")

    async def read(self):
        cursor = 0
        while True:
            async with self.changed:
                await self.changed.wait_for(lambda: cursor < len(self.chunks) or self.complete.is_set())
                chunks = self.chunks[cursor:]; cursor += len(chunks)
                done, error = self.complete.is_set(), self.error
            for c in chunks: yield c
            if done:
                if error: raise RuntimeError(error)
                if not self.eos: raise RuntimeError("Stream truncated")
                return

    def snapshot(self):
        if not self.spec["stream"]: return deepcopy(self.value)
        return {**(self.media_reference or {}), "stream": True, "format": self.spec["format"], "chunks": deepcopy(self.chunks), "eos": self.eos, "truncated": not self.eos,
                "text": "".join(c["data"] for c in self.chunks) if self.spec["type"] == "Text" else None}


def group(schema):
    return {f["name"]: FieldChannel(f) for f in schema["fields"]}


async def group_ready(values):
    await asyncio.gather(*(v.ready() for v in values.values()))


async def group_ended(values):
    await asyncio.gather(*(v.ended() for v in values.values()))
