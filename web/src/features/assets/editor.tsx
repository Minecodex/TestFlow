import { useMessages } from "../../i18n";
import { ApiError, write } from "../../shared/api/client";
import { useWrite } from "../../shared/api/hooks";
import type { Asset, Resource } from "../../shared/api/types";
import { Action, Badge, Check, Dialog, Failure, Json, Notice, Text } from "../../shared/ui";
import { TagsInput } from "../../shared/ui/tags-input";
import { DeleteResource } from "../../shared/ui/resources";
import { DraftConflict } from "../../shared/ui/draft-conflict";
import { useVersionedDraft } from "../../shared/ui/versioned-draft";
import { AssetMedia } from "./player";
export function AssetEditor({
  asset,
  onClose,
}: {
  asset: Resource<Asset>;
  onClose: () => void;
}) {
  const t = useMessages();
  const draft = useVersionedDraft(
    "testflow.asset-draft." + asset.id,
    asset.version,
    asset.data,
  );
  const { data, setData } = draft;
  const patch = (v: Partial<Asset>) => setData({ ...data, ...v });
  const save = useWrite(() =>
    write(
      `/assets/${asset.id}`,
      { expected_version: draft.baseVersion, data },
      "PUT",
    ),
  );
  const conflict =
    asset.version > draft.baseVersion ||
    (save.error instanceof ApiError && save.error.status === 409);
  return (
    <Dialog
      drawer
      title={asset.name}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      footer={
        <>
          <DeleteResource kind="assets" resource={asset} />
          <Action
            primary
            isPending={save.isPending}
            isDisabled={conflict}
            onPress={() =>
              save.mutate(undefined, {
                onSuccess: () => {
                  draft.clear();
                  onClose();
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
        {conflict && (
          <DraftConflict
            kind="assets"
            id={asset.id}
            draft={data}
            onContinue={(latest) => {
              draft.setBaseVersion(latest.version);
              save.reset();
            }}
          />
        )}
        <Badge>
          {t.common.types[data.type]} · {data.format}
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
        <TagsInput value={data.tags || []} onChange={tags => patch({ tags })} />
        {data.type === "Text" && <Text label={t.assets.content} value={data.text || ""} multiline onChange={text => patch({ text })} />}
        <Notice>{t.assets.sharedEditHint}</Notice>
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
