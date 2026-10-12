import { useEffect, useId, useRef, useState } from "react";
import { Pause, Play, Type } from "lucide-react";
import type { Asset, PortField, Resource } from "../../shared/api/types";
import { useResource } from "../../shared/api/hooks";
import { Action, Badge, Failure, Json } from "../../shared/ui";
import { useMessages } from "../../i18n";
import { PlayIcon } from "../../shared/icons";
export function AssetMedia({ asset, compact = false, framed = false }: { asset: Resource<Asset>; compact?: boolean; framed?: boolean }) {
  const t = useMessages();
  const audio = useRef<HTMLAudioElement>(null);
  const playerId = useId();
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<Error>();
  const url = `/api/v1/media/${asset.id}?version=${asset.selected_version}`;
  useEffect(() => {
    const stop = (e: Event) => {
      if ((e as CustomEvent).detail !== playerId) audio.current?.pause();
    };
    window.addEventListener("testflow:audio-play", stop);
    const player = audio.current;
    return () => {
      window.removeEventListener("testflow:audio-play", stop);
      if (player) {
        player.pause();
        player.removeAttribute("src");
        player.load();
      }
    };
  }, [asset.id, playerId]);
  if (asset.data.type === "Audio")
    return (
      <div className={compact ? "testflow-audio-mini" : framed ? "testflow-material-preview" : undefined}>
      {framed && !compact && <div className="testflow-row testflow-between testflow-material-title"><span>{asset.name}</span><Badge state="pending">Audio</Badge></div>}
      <audio
        ref={audio}
        className={compact ? "testflow-audio-hidden" : "testflow-audio"}
        controls={!compact}
        preload="metadata"
        src={url}
        onPlay={() => {
          setPlaying(true);
          window.dispatchEvent(
            new CustomEvent("testflow:audio-play", { detail: playerId }),
          );
        }}
        onPause={()=>setPlaying(false)}
        onEnded={()=>setPlaying(false)}
        onError={()=>setError(new Error(t.assets.playbackFailure))}
      />
      {compact && <>
        <Action isIconOnly variant="ghost" size="sm" className="testflow-play-button" action="play-audio"
          aria-label={`${playing ? t.assets.stop : t.assets.play} ${asset.name}`}
          onPress={()=>{if (playing) {audio.current?.pause(); if(audio.current) audio.current.currentTime=0;}
            else {setError(undefined); void audio.current?.play().catch(e=>setError(e));}}}>
          {playing ? <Pause /> : <PlayIcon />}
        </Action>
        <span className="testflow-wave" aria-hidden="true">{Array.from({length:17},(_,i)=><i key={i} style={{height:4+Math.sin(i*1.72)**2*17}} />)}</span>
        <span className="testflow-tiny testflow-muted testflow-mono">{Number(asset.data.metadata?.duration || 0).toFixed(1)}s</span>
      </>}
      <Failure error={error} />
      {framed && !compact && typeof asset.data.metadata?.description === "string" && <div className="testflow-small testflow-muted">{asset.data.metadata.description}</div>}
      </div>
    );
  if (asset.data.type === "Image")
    return <img className={compact ? "testflow-asset-thumb" : "testflow-asset-image"} src={url} alt={asset.name} />;
  if (compact) return <span className="testflow-chip testflow-type-Text"><Type /> UTF-8</span>;
  return <pre className="testflow-json">{asset.data.text}</pre>;
}
export function ValueMedia({
  value,
  field,
  framed = false,
  showStatus = true,
}: {
  value: unknown;
  field: PortField;
  framed?: boolean;
  showStatus?: boolean;
}) {
  const t = useMessages();
  if (field.type === "JSON") return <Json value={value} />;
  if (typeof value === "string")
    return <p className="testflow-output-content">{value}</p>;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    const media =
      ["Audio", "Image"].includes(field.type) && v.asset_id ? (
        <ReferencedMedia
          id={String(v.asset_id)}
          version={String(v.asset_version)}
          framed={framed}
        />
      ) : null;
    if (field.stream && v.stream)
      return (
        <div className="testflow-stack">
          {showStatus && <div><Badge state={v.eos ? "succeeded" : "failed"}>
            {v.eos ? t.assets.streamComplete : t.assets.streamIncomplete}
          </Badge></div>}
          {media ||
            (field.type === "Text" && v.text != null ? (
              <p className="testflow-output-content">{String(v.text)}</p>
            ) : (
              <Json value={value} />
            ))}
        </div>
      );
    if (media) return media;
  }
  return <Json value={value} />;
}

function ReferencedMedia({ id, version, framed }: { id: string; version: string; framed?: boolean }) {
  const asset = useResource<Asset>("assets", id, version);
  if (asset.error) return <Failure error={asset.error} />;
  return asset.data ? <AssetMedia asset={asset.data} framed={framed} /> : <code>{id}</code>;
}
