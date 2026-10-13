import { useEffect, useRef, useState } from "react";
import { useMessages } from "../../i18n";
import type { Schema } from "../../shared/api/types";
import { Action, Failure, Notice, Panel, Text } from "../../shared/ui";
import { FileInput } from "../../shared/ui/file-input";

type Capture = {
  context: AudioContext;
  media: MediaStream;
  node: AudioWorkletNode;
  source: MediaStreamAudioSourceNode;
};
function wavHeader() {
  const buffer = new ArrayBuffer(44),
    view = new DataView(buffer);
  const word = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++)
      view.setUint8(offset + i, value.charCodeAt(i));
  };
  word(0, "RIFF");
  view.setUint32(4, 0xffffffff, true);
  word(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  word(36, "data");
  view.setUint32(40, 0xffffffff, true);
  return new Uint8Array(buffer);
}
function encoded(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function LiveInput({
  executionId,
  schema,
}: {
  executionId: string;
  schema: Schema;
}) {
  const t = useMessages();
  const mounted = useRef(true);
  const finishedFields = useRef(new Set<string>());
  const socket = useRef<WebSocket | null>(null),
    sequences = useRef<Record<string, number>>({}),
    captures = useRef<Record<string, Capture>>({});
  const [connected, setConnected] = useState(false),
    [error, setError] = useState<unknown>(),
    [finished, setFinished] = useState<Record<string, boolean>>({}),
    [text, setText] = useState<Record<string, string>>({}),
    [recording, setRecording] = useState<Record<string, boolean>>({});
  const releaseCapture = (name: string) => {
    const capture = captures.current[name];
    if (!capture) return;
    capture.node.port.onmessage = null;
    capture.node.disconnect();
    capture.source.disconnect();
    capture.media.getTracks().forEach((track) => track.stop());
    void capture.context.close();
    delete captures.current[name];
  };
  useEffect(() => {
    mounted.current = true;
    let current: WebSocket | undefined;
    const timer = window.setTimeout(() => {
      current = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/v1/executions/${executionId}/input`,
      );
      socket.current = current;
      current.onopen = () => setConnected(true);
      current.onerror = () => setError(t.executions.liveDisconnected);
      current.onclose = () => {
        for (const name of Object.keys(captures.current)) releaseCapture(name);
        if (mounted.current) {
          setConnected(false);
          setRecording({});
          if (
            !schema.fields.every((field) =>
              finishedFields.current.has(field.name),
            )
          )
            setError(t.executions.liveDisconnected);
        }
      };
    }, 0);
    return () => {
      mounted.current = false;
      clearTimeout(timer);
      current?.close();
      for (const name of Object.keys(captures.current)) releaseCapture(name);
    };
  }, [executionId]);
  const send = (name: string, data: string, media = false) => {
    const field = schema.fields.find((f) => f.name === name)!;
    if (socket.current?.readyState !== WebSocket.OPEN)
      throw new Error(t.executions.liveDisconnected);
    socket.current.send(
      JSON.stringify({
        type: "input.chunk",
        field: name,
        seq: sequences.current[name] || 0,
        format: field.format,
        data,
        ...(media ? { encoding: "base64" } : {}),
      }),
    );
    sequences.current[name] = (sequences.current[name] || 0) + 1;
  };
  const eos = (name: string) => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      setError(t.executions.liveDisconnected);
      return;
    }
    socket.current.send(
      JSON.stringify({
        type: "input.eos",
        field: name,
        seq: sequences.current[name] || 0,
      }),
    );
    finishedFields.current.add(name);
    setFinished((v) => ({ ...v, [name]: true }));
  };
  const stop = (name: string) => {
    releaseCapture(name);
    setRecording((v) => ({ ...v, [name]: false }));
    eos(name);
  };
  const record = async (name: string) => {
    let media: MediaStream | undefined, context: AudioContext | undefined;
    try {
      media = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1 },
      });
      if (!mounted.current) {
        media.getTracks().forEach((track) => track.stop());
        return;
      }
      context = new AudioContext({ sampleRate: 16000 });
      await context.resume();
      if (context.sampleRate !== 16000)
        throw new Error(t.executions.sampleRate);
      await context.audioWorklet.addModule("/pcm-capture.worklet.js");
      if (!mounted.current) {
        media.getTracks().forEach((track) => track.stop());
        void context.close();
        return;
      }
      const node = new AudioWorkletNode(context, "testflow-pcm-capture"),
        source = context.createMediaStreamSource(media);
      send(name, encoded(wavHeader()), true);
      node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        try {
          send(name, encoded(new Uint8Array(event.data)), true);
        } catch (e) {
          setError(e);
          releaseCapture(name);
          setRecording((value) => ({ ...value, [name]: false }));
        }
      };
      source.connect(node);
      node.connect(context.destination);
      captures.current[name] = { context, media, node, source };
      setRecording((v) => ({ ...v, [name]: true }));
    } catch (e) {
      media?.getTracks().forEach((track) => track.stop());
      void context?.close();
      setError(e);
    }
  };
  const file = async (name: string, selected: File) => {
    try {
      const bytes = new Uint8Array(await selected.arrayBuffer());
      for (let offset = 0; offset < bytes.length; offset += 32768)
        send(name, encoded(bytes.slice(offset, offset + 32768)), true);
      eos(name);
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Panel title={t.executions.liveInput}>
      <div className="testflow-stack">
        <Notice>
          {connected ? t.executions.liveReady : t.common.connecting}
        </Notice>
        <Failure error={error} />
        {schema.fields.map((field) => (
          <div className="testflow-outline" key={field.name}>
            <h3>
              {field.name} · {t.common.types[field.type]}
            </h3>
            {field.type === "Text" ? (
              <>
                <Text
                  label={t.executions.chunk}
                  multiline
                  value={text[field.name] || ""}
                  onChange={(value) =>
                    setText((v) => ({ ...v, [field.name]: value }))
                  }
                />
                <Action
                  isDisabled={!connected || finished[field.name]}
                  onPress={() => {
                    try {
                      send(field.name, text[field.name] || "");
                      setText((v) => ({ ...v, [field.name]: "" }));
                    } catch (e) {
                      setError(e);
                    }
                  }}
                >
                  {t.executions.sendChunk}
                </Action>
                <Action
                  primary
                  isDisabled={!connected || finished[field.name]}
                  onPress={() => eos(field.name)}
                >
                  {t.executions.finishInput}
                </Action>
              </>
            ) : field.type === "Audio" ? (
              <Action
                primary
                isDisabled={!connected || finished[field.name]}
                onPress={() =>
                  recording[field.name]
                    ? stop(field.name)
                    : void record(field.name)
                }
              >
                {recording[field.name]
                  ? t.assets.stopRecord
                  : t.assets.startRecord}
              </Action>
            ) : (
              <FileInput
                label={t.assets.import}
                accept="image/*"
                disabled={!connected || finished[field.name]}
                onChange={(files) => {
                  if (files[0]) void file(field.name, files[0]);
                }}
              />
            )}
            {finished[field.name] && (
              <Notice>{t.executions.inputFinished}</Notice>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}
