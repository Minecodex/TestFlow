import { useState } from "react";
import { useMessages } from "../../i18n";
import { Dialog, Failure } from "../../shared/ui";

export function ImagePreview({ src, name, compact = false }: {src: string; name: string; compact?: boolean}) {
  const t = useMessages();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  return <>
    <button type="button" className="testflow-media-open testflow-image-open" aria-label={`${t.assets.viewImage} ${name}`} onClick={() => setOpen(true)}>
      <img className={compact ? "testflow-asset-thumb" : "testflow-asset-image"} src={src} alt={name} onError={() => setFailed(true)} />
    </button>
    {failed && <Failure error={t.assets.imageFailure} />}
    {open && <Dialog wide className="testflow-image-viewer" title={name} onClose={() => setOpen(false)}>
      <img className="testflow-image-large" src={src} alt={name} />
    </Dialog>}
  </>;
}
