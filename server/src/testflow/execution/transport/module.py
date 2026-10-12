import asyncio
import json

import httpx
from websockets.asyncio.client import connect

from testflow.execution.transport.channels import group_ended
from testflow.infrastructure.redaction import redact


class ModuleInvocation:
    def __init__(self, manager, runtime, node, context, emit):
        self.manager, self.runtime, self.node, self.context, self.emit = manager, runtime, node, context, emit
        self.invocation_id = None
        self.stopped = asyncio.Event()
        self.cancel_evidence = None
        self.spans = {context["span_id"]}

    async def run(self, inputs, outputs):
        identity = {**self.context, "invocation_id": self.context["invocation_id"]}
        static = {name: {"stream": True, "format": field.spec["format"]} if field.spec["stream"] else {"value": field.value} for name, field in inputs.items()}
        async with httpx.AsyncClient(trust_env=False, timeout=10) as http:
            response = await http.post(self.runtime.address + "/module/v1/executions", json={"invocation_id": identity["invocation_id"], "context": identity, "parameters": self.node["parameters"], "inputs": static})
            response.raise_for_status()
            if response.json().get("invocation_id") != identity["invocation_id"]: raise RuntimeError("Invocation identity mismatch")
            self.invocation_id = identity["invocation_id"]
        await self.emit("module.request", {"invocation_id": self.invocation_id, "runtime_id": self.runtime.id, "image_id": self.runtime.image_id})
        endpoint = self.runtime.address.replace("http://", "ws://", 1) + f"/module/v1/executions/{self.invocation_id}/stream"
        async with connect(endpoint, proxy=None, max_size=8 * 1024 * 1024, ping_interval=20) as socket:
            async def supply(name, field):
                if field.spec["stream"]:
                    async for chunk in field.read():
                        await socket.send(json.dumps({"type": "input.chunk", "field": name, **chunk}))
                    await socket.send(json.dumps({"type": "input.eos", "field": name, "seq": len(field.chunks)}))
            senders = [asyncio.create_task(supply(name, field)) for name, field in inputs.items()]
            monitor = asyncio.create_task(self.manager.watch(self.runtime))
            lost = asyncio.create_task(self.manager.lost[self.runtime.id].wait())
            receiver = asyncio.create_task(self.receive(socket, outputs))
            try:
                pending = set(senders + [receiver, lost])
                while receiver in pending:
                    done, _ = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                    if lost in done: raise RuntimeError("runtime_lost: shared Pod was terminated; module memory unavailable")
                    for task in done:
                        if task is not lost: task.result()
                        pending.remove(task)
                await asyncio.gather(*senders)
                await group_ended(outputs)
            finally:
                for task in senders + [lost, receiver, monitor]:
                    if not task.done(): task.cancel()
                await asyncio.gather(*senders, lost, receiver, monitor, return_exceptions=True)

    async def receive(self, socket, outputs):
        async for raw in socket:
            secret_values = self.manager.app.state.secret_values.get(self.context["execution_id"], set()) | {self.manager.decrypted(self.runtime.token)}
            event = redact(json.loads(raw), secret_values)
            if event.get("invocation_id") != self.invocation_id: raise RuntimeError("Wrong invocation in stream")
            kind = event.get("type", "")
            await self.emit("module.event", event)
            if kind.startswith("output."):
                field = outputs.get(event.get("field"))
                if not field: raise RuntimeError("Output field is not in declared ordered group")
                if kind == "output.value" and field.spec["type"] in {"Audio", "Image"}:
                    from testflow.features.modules.resources import validate_output_reference
                    await validate_output_reference(self.manager.app, self.context["execution_id"], field.spec, event["value"])
                await field.put(kind.split(".")[1], event)
                await self.emit(kind, {"field": event["field"], **field.snapshot()} if field.spec["stream"] and kind.endswith("eos") else event)
            elif kind == "trace":
                if not self.node["module_snapshot"]["data"]["manifest"]["exposes_trace"]:
                    raise RuntimeError("Module emitted undeclared internal Trace")
                if event.get("trace_id") != self.context["trace_id"] or event.get("parent_span_id") not in self.spans:
                    raise RuntimeError("Internal Trace context mismatch")
                if not event.get("span_id") or event["span_id"] in self.spans: raise RuntimeError("Invalid internal Span identity")
                self.spans.add(event["span_id"])
                await self.emit("trace.internal", event)
            elif kind == "execution.completed":
                if not all(f.complete.is_set() and (not f.spec["stream"] or f.eos) for f in outputs.values()):
                    raise RuntimeError("Module completed before required fields and normal EOS")
                self.stopped.set(); return
            elif kind == "execution.canceled":
                self.cancel_evidence = event; self.stopped.set()
                raise asyncio.CancelledError()
            elif kind == "execution.error":
                self.stopped.set(); raise RuntimeError(event.get("message", "Module execution error"))
            else: raise RuntimeError("Unknown module stream event")
        if not self.stopped.is_set(): raise RuntimeError("Module stream closed without explicit terminal event")

    async def cancel(self):
        if not self.invocation_id or self.stopped.is_set(): return {"already_stopped": self.stopped.is_set()}
        async with httpx.AsyncClient(trust_env=False, timeout=5) as http:
            response = await http.post(self.runtime.address + f"/module/v1/executions/{self.invocation_id}/cancel")
            response.raise_for_status()
            request = response.json()
            response = await http.get(self.runtime.address + f"/module/v1/executions/{self.invocation_id}")
            response.raise_for_status()
            actual = response.json()
            if actual.get("state") in {"canceled", "completed", "failed"}: self.stopped.set()
        return {"cancel_response": request, "actual_status": actual}
