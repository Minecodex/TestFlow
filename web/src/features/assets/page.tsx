import { FileInput } from "../../shared/ui/file-input";
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Mic, Plus, Upload } from "lucide-react";
import { HistoryIcon } from "../../shared/icons";
import { useMessages } from "../../i18n";
import { ApiError, write } from "../../shared/api/client";
import { useResource, useResources, useWrite } from "../../shared/api/hooks";
import type { Asset, Resource } from "../../shared/api/types";
import {
  Action,
  Badge,
  Check,
  Choice,
  DataTable,
  Dialog,
  Empty,
  Failure,
  Head,
  Json,
  Notice,
  Pagination,
  Panel,
  Text,
} from "../../shared/ui";
import { Hide, Versions } from "../../shared/ui/resources";
import { AssetMedia } from "./media";
import { Recording } from "./recording";
import { DraftConflict } from "../../shared/ui/draft-conflict";
import { useVersionedDraft } from "../../shared/ui/versioned-draft";
function Detail({
  asset,
  onClose,
}: {
  asset: Resource<Asset>;
  onClose: () => void;
}) {
  const t = useMessages();
  const draft = useVersionedDraft("testflow.asset-draft."+asset.id,asset.version,asset.data);
  const { data, setData } = draft;
  const patch = (v: Partial<Asset>) => setData({ ...data, ...v });
  const save = useWrite(() =>
    write(
      `/assets/${asset.id}`,
      { expected_version: draft.baseVersion, data },
      "PUT",
    ),
  );
  const conflict = asset.version > draft.baseVersion || (save.error instanceof ApiError && save.error.status===409);
  return (
    <Dialog
      drawer
      title={asset.name}
      onClose={()=>{if(!save.isPending) onClose();}}
      footer={
        <>
          <Hide kind="assets" resource={asset} />
          <Action
            primary
            isPending={save.isPending}
            isDisabled={conflict}
            onPress={() => save.mutate(undefined, { onSuccess: ()=>{draft.clear();onClose();} })}
          >
            {t.common.save}
          </Action>
        </>
      }
    >
      <div className="testflow-stack">
        {conflict && <DraftConflict kind="assets" id={asset.id} draft={data} onContinue={latest=>{draft.setBaseVersion(latest.version);save.reset();}} />}
        <Badge>
          {data.type} · {data.format}
        </Badge>
        <AssetMedia asset={asset} />
        <Text
          label={t.common.name}
          value={data.name}
          onChange={(name) => patch({ name })}
        />
        <Text
          label={t.assets.category}
          value={data.category || ""}
          onChange={(category) => patch({ category })}
        />
        <Text
          label={t.assets.tags}
          value={(data.tags || []).join(", ")}
          onChange={(tags) =>
            patch({
              tags: tags
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            })
          }
        />
        <Text
          label={t.assets.reference}
          value={
            typeof data.reference === "string"
              ? data.reference
              : JSON.stringify(data.reference || "")
          }
          multiline
          onChange={(reference) => patch({ reference })}
        />
        <Check
          value={!!data.reference_confirmed}
          onChange={(reference_confirmed) => patch({ reference_confirmed })}
        >
          {t.assets.confirm}
        </Check>
        <Failure error={save.error} />
        <Json
          value={{
            sha256: data.sha256,
            metadata: data.metadata,
            size: data.size,
            source: data.source,
          }}
        />
      </div>
    </Dialog>
  );
}
export function AssetsPage() {
  const t = useMessages();
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const page = Number(params.get("page") || 1);
  const query = useResources<Asset>(
    "assets",
    `page=${page}&search=${encodeURIComponent(params.get("q") || "")}${params.get("type") ? "&type=" + params.get("type") : ""}`,
  );
  const selected = useResource<Asset>("assets", id);
  const type = params.get("type") || "__all";
  const setType = (value: string) => {
    const next = new URLSearchParams(params);
    next.delete("page");
    if (value === "__all") next.delete("type");
    else next.set("type", value);
    setParams(next);
  };
  const [overlay, setOverlay] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [content, setContent] = useState("");
  const [name, setName] = useState("");
  const [versions, setVersions] = useState<Resource<Asset>>();
  const upload = useWrite(() => {
    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    return write<{
      items: {
        filename: string;
        resource: Resource<Asset> | null;
        error?: { message: string };
      }[];
    }>("/media/upload", form);
  });
  const text = useWrite(() =>
    write("/assets", {
      name,
      type: "Text",
      text: content,
      format: "UTF-8",
      source: "text",
    }),
  );
  const items = query.data?.items || [];
  return (
    <>
      <Head
        title={t.assets.title}
        description={t.assets.description}
        eyebrow="MATERIALS / 04"
        actions={
          <>
            <Action action="record-asset" onPress={() => setOverlay("record")}>
              <Mic />
              {t.assets.record}
            </Action>
            <Action action="new-text-asset" onPress={() => setOverlay("text")}>
              <Plus />
              {t.assets.text}
            </Action>
            <Action
              primary
              action="import-asset"
              onPress={() => setOverlay("upload")}
            >
              <Upload />
              {t.assets.import}
            </Action>
          </>
        }
      />
      <div className="testflow-toolbar testflow-asset-filters">
        <div className="testflow-row">
        <Text
          label={t.common.search}
          placeholder={t.assets.search}
          value={params.get("q") || ""}
          onChange={(q) => {
            const next=new URLSearchParams(params); next.delete("page");
            if(q) next.set("q",q); else next.delete("q"); setParams(next);
          }}
        />
        <Choice
          label={t.common.fieldType}
          value={type}
          onChange={setType}
          options={[
            { id: "__all", name: t.assets.allAssets },
            ...["Text", "Image", "Audio"].map((id) => ({ id, name: id })),
          ]}
        />
        <span className="testflow-small testflow-muted">{query.data?.total || 0} {t.assets.assetUnit}</span>
        </div>
        <Badge>{t.assets.confirmedShort} {items.filter(a=>a.data.reference_confirmed).length} / {t.assets.unconfirmedShort} {items.filter(a=>!a.data.reference_confirmed).length}{(query.data?.total || 0) > items.length ? " · "+t.assets.currentPage : ""}</Badge>
      </div>
      <Failure error={query.error} />
      <Panel>
        {items.length ? (
          <DataTable
            label={t.assets.title}
            className="testflow-assets-table"
            headers={[
              t.assets.assetColumn,
              t.assets.preview,
              t.assets.standardState,
              t.assets.categoryTags,
              "",
            ]}
            rows={items.map((a) => ({
              id: a.id,
              cells: [
                <div>
                  <div className="testflow-row testflow-asset-identity">
                  <Action variant="ghost" className="testflow-link testflow-cell-title" action="asset-detail" onPress={()=>navigate("/assets/"+a.id)}>{a.name}</Action>
                  <Action size="sm" variant="ghost" isIconOnly className="testflow-asset-version" aria-label={t.common.versions} onPress={() => setVersions(a)}><HistoryIcon /></Action>
                  </div>
                  <div className="testflow-row-subtitle testflow-muted">{a.data.type} · {a.data.format}{a.data.metadata?.description ? " · "+String(a.data.metadata.description) : ""}</div>
                </div>,
                <AssetMedia asset={a} compact />,
                <div>
                  <p className="testflow-small testflow-material-summary">{a.data.text || (typeof a.data.reference === "string" ? a.data.reference : a.data.reference ? JSON.stringify(a.data.reference) : "") || t.assets.noReference}</p>
                  <div className="testflow-reference-state"><Badge state={a.data.reference_confirmed ? "ready" : "pending"}>
                  {a.data.reference_confirmed
                    ? t.assets.referenceConfirmed
                    : t.assets.referenceUnconfirmed}
                  </Badge>
                  </div>
                </div>,
                <div className="testflow-small testflow-muted">
                  <p className="testflow-asset-category">{a.data.category || "—"}</p>
                  <span className="testflow-chips">{(a.data.tags || []).map(tag=><span className="testflow-tag" key={tag}>{tag}</span>)}</span>
                </div>,
                <div className="testflow-row-actions">
                  <Action
                    size="sm"
                    variant="ghost"
                    action="asset-detail"
                    aria-label={t.common.details}
                    onPress={() => navigate("/assets/" + a.id)}
                  >
                    {t.common.edit}
                  </Action>
                  <Hide kind="assets" resource={a} iconOnly />
                </div>,
              ],
            }))}
          />
        ) : (
          !query.isPending && <Empty text={t.common.empty} />
        )}
        <Pagination
          page={page}
          total={query.data?.total || 0}
          onChange={(p) =>
            setParams({ ...Object.fromEntries(params), page: String(p) })
          }
        />
      </Panel>
      {selected.data && (
        <Detail
          key={selected.data.id}
          asset={selected.data}
          onClose={() => navigate("/assets")}
        />
      )}
      <Failure error={selected.error} />
      {versions && (
        <Versions
          kind="assets"
          resource={versions}
          onClose={() => setVersions(undefined)}
        />
      )}{" "}
      {overlay === "record" && (
        <Recording
          onClose={() => setOverlay("")}
          onSaved={(a) => navigate("/assets/" + a.id)}
        />
      )}{" "}
      {overlay === "text" && (
        <Dialog
          title={t.assets.text}
          onClose={() => setOverlay("")}
          footer={
            <>
              <Action onPress={() => setOverlay("")}>{t.common.cancel}</Action>
              <Action
                primary
                isPending={text.isPending}
                isDisabled={!name || !content}
                onPress={() =>
                  text.mutate(undefined, {
                    onSuccess: () => {
                      setOverlay("");
                      setContent("");
                      setName("");
                    },
                  })
                }
              >
                {t.common.save}
              </Action>
            </>
          }
        >
          <div className="testflow-stack">
            <Text label={t.common.name} value={name} onChange={setName} />
            <Text
              label={t.assets.content}
              value={content}
              onChange={setContent}
              multiline
            />
            <Failure error={text.error} />
          </div>
        </Dialog>
      )}{" "}
      {overlay === "upload" && (
        <Dialog
          title={t.assets.import}
          onClose={() => {
            if (!upload.isPending) setOverlay("");
          }}
          footer={
            <>
              <Action
                isDisabled={upload.isPending}
                onPress={() => setOverlay("")}
              >
                {t.common.close}
              </Action>
              <Action
                primary
                isDisabled={!files.length}
                isPending={upload.isPending}
                onPress={() => upload.mutate(undefined)}
              >
                {t.assets.import}
              </Action>
            </>
          }
        >
          <div className="testflow-stack">
            <FileInput
              label={t.assets.chooseFiles}
              multiple
              accept=".txt,.md,.json,.png,.jpg,.jpeg,.webp,.gif,.wav,.mp3,.m4a,.webm,.ogg,.flac"
              onChange={setFiles}
            />
            <Notice>{files.map((f) => f.name).join(", ")}</Notice>
            <Notice>{t.assets.recordNote}</Notice>
            <Failure error={upload.error} />
            {upload.data?.items.map((r, i) => (
              <div key={i} className="testflow-row">
                <strong>{r.filename}</strong>
                {r.error ? (
                  <Failure error={r.error.message} />
                ) : (
                  <Badge state="ready">✓</Badge>
                )}
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
