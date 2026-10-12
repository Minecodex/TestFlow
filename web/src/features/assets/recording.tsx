import { useEffect, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { write } from "../../shared/api/client";
import { useWrite } from "../../shared/api/hooks";
import { useMessages } from "../../i18n";
import { Action, Dialog, Failure, Notice } from "../../shared/ui";
import type { Asset, Resource } from "../../shared/api/types";
export function Recording({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (asset: Resource<Asset>) => void;
}) {
  const t = useMessages();
  const [active, setActive] = useState(false);
  const [error, setError] = useState<unknown>();
  const recorder = useRef<MediaRecorder | undefined>(undefined);
  const media = useRef<MediaStream | undefined>(undefined);
  const chunks = useRef<Blob[]>([]);
  const captured = useRef<Blob | undefined>(undefined);
  const unmounted = useRef(false);
  const upload = useWrite((blob: Blob) => {
    const form = new FormData();
    form.append("files", blob, "recording.webm");
    return write<{
      items: {
        resource: Resource<Asset> | null;
        error?: { message: string };
      }[];
    }>("/media/upload?source=recording", form);
  });
  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    media.current?.getTracks().forEach((track) => track.stop());
    setActive(false);
  };
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      media.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  const start = async () => {
    try {
      media.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      if (unmounted.current) {
        media.current.getTracks().forEach((track) => track.stop());
        return;
      }
      const current = new MediaRecorder(media.current);
      recorder.current = current;
      chunks.current = [];
      current.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      current.onstop = () => {
        media.current?.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunks.current, { type: current.mimeType });
        captured.current = blob;
        if (blob.size)
          upload.mutate(blob, {
            onSuccess: (result) => {
              const first = result.items[0];
              if (first?.resource && !unmounted.current) {
                onSaved(first.resource);
                onClose();
              } else if (!unmounted.current) setError(first?.error?.message);
            },
          });
      };
      current.start(200);
      setActive(true);
    } catch (e) {
      setError(e);
      media.current?.getTracks().forEach((track) => track.stop());
    }
  };
  return (
    <Dialog
      title={t.assets.record}
      onClose={() => {
        stop();
        onClose();
      }}
      footer={
        <>
          <Action
            onPress={() => {
              stop();
              onClose();
            }}
            isDisabled={upload.isPending}
          >
            {t.common.close}
          </Action>
          {active ? (
            <Action primary action="stop-record" onPress={stop}>
              <Square />
              {t.assets.stopRecord}
            </Action>
          ) : captured.current && upload.isError ? (
            <Action
              primary
              isPending={upload.isPending}
              onPress={() =>
                upload.mutate(captured.current!, {
                  onSuccess: (result) => {
                    const asset = result.items[0]?.resource;
                    if (asset) {
                      onSaved(asset);
                      onClose();
                    } else setError(result.items[0]?.error?.message);
                  },
                })
              }
            >
              {t.common.retry}
            </Action>
          ) : (
            <Action
              primary
              action="start-record"
              isPending={upload.isPending}
              onPress={() => {
                void start();
              }}
            >
              <Mic />
              {t.assets.startRecord}
            </Action>
          )}
        </>
      }
    >
      <div className="testflow-stack">
        <Failure error={error || upload.error} />
        <Notice>{active ? t.assets.recording : t.assets.recordNote}</Notice>
      </div>
    </Dialog>
  );
}
