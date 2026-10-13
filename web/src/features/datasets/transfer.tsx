import { useQuery } from "@tanstack/react-query";
import { useMessages } from "../../i18n";
import { exportFile, getJson, write } from "../../shared/api/client";
import { useWrite } from "../../shared/api/hooks";
import type {
  Dataset,
  DatasetDocument,
  DatasetImport,
  DatasetPreview,
  Resource,
} from "../../shared/api/types";
import {
  Action,
  Badge,
  Chips,
  Choice,
  Dialog,
  Failure,
  Notice,
  Text,
  download,
} from "../../shared/ui";
import { FileInput } from "../../shared/ui/file-input";
import { usePortableImport } from "../../shared/ui/portable-import";

export function DatasetExport({ resource }: { resource: Resource<Dataset> }) {
  const t = useMessages();
  const output = useWrite(async () => {
    const document = await getJson<DatasetDocument>(
      `/datasets/${resource.id}/export`,
    );
    download(resource.name + ".dataset.json", document);
  });
  const identifiers = [...new Set((resource.data.cases || []).flatMap(c => [...Object.values(c.inputs).map(b => b.asset_id).filter(Boolean)]))];
  const materials = useWrite(async () => {
    const revisions = await Promise.all(identifiers.map(id => getJson<Resource<unknown>>("/assets/" + id)));
    return exportFile("/assets/export", {assets: revisions.map(asset => ({id: asset.id, version: asset.version}))}, resource.name + ".assets.zip");
  });
  return (
    <>
      <Action
        action="export-dataset"
        isPending={output.isPending}
        onPress={() => output.mutate(undefined)}
      >
        {t.datasets.export}
      </Action>
      <Action
        action="export-dataset-assets"
        isPending={materials.isPending}
        isDisabled={!identifiers.length}
        onPress={() => materials.mutate(undefined)}
      >
        {t.datasets.exportAssets}
      </Action>
      <Failure error={output.error || materials.error} />
    </>
  );
}

export function ImportDataset({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (resource: Resource<Dataset>) => void;
}) {
  const t = useMessages();
  const draft = usePortableImport<
    DatasetDocument,
    NonNullable<DatasetImport["bindings"]>
  >("testflow.dataset-import-draft.v1", "testflow.dataset.v1", (doc) => {
    if (
      !Array.isArray(doc.dataset?.cases) ||
      ![doc.dataset?.input_schema].every(
        (schema) =>
          Array.isArray(schema?.fields) &&
          schema.fields.every(
            (field) =>
              typeof field?.name === "string" &&
              typeof field.type === "string" &&
              typeof field.format === "string",
          ),
      )
    )
      throw Error("shape");
    return doc.dataset.name;
  });
  const preview = useQuery({
    queryKey: ["dataset-import-preview", draft.body],
    queryFn: () =>
      write<DatasetPreview>("/datasets/import/preview", draft.body),
    enabled: open && !!draft.body,
    retry: false,
  });
  const save = useWrite(() =>
    write<Resource<Dataset>>("/datasets/import", draft.body, "POST", draft.key),
  );
  if (!open) return null;
  return (
    <Dialog
      title={t.datasets.import}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      footer={
        <>
          <Action isDisabled={save.isPending} onPress={onClose}>
            {t.common.cancel}
          </Action>
          <Action
            isDisabled={!draft.body || save.isPending}
            isPending={preview.isFetching}
            onPress={() => {
              void preview.refetch();
            }}
          >
            {t.common.refresh}
          </Action>
          <Action
            primary
            action="submit-dataset-import"
            isPending={save.isPending}
            isDisabled={
              !preview.data?.valid ||
              preview.isFetching ||
              !!preview.error ||
              !draft.name.trim()
            }
            onPress={() =>
              save.mutate(undefined, {
                onSuccess: (resource) => {
                  draft.clear();
                  onImported(resource);
                },
              })
            }
          >
            {t.datasets.import}
          </Action>
        </>
      }
    >
      <div className="testflow-stack">
        <Notice>{t.datasets.importNote}</Notice>
        <FileInput
          label={t.datasets.chooseFile}
          accept=".json,application/json"
          disabled={save.isPending}
          onChange={(files) => {
            save.reset();
            void draft.read(files[0]);
          }}
        />
        {draft.filename && (
          <span className="testflow-small">{draft.filename}</span>
        )}
        {draft.fileError && <Notice error>{t.datasets.invalidFile}</Notice>}
        {draft.document && (
          <>
            <Text
              label={t.common.name}
              value={draft.name}
              onChange={draft.setName}
              disabled={save.isPending}
            />
            <h3>{t.common.inputSchema}</h3>
            <Chips schema={draft.document.dataset.input_schema} />
            <Badge>
              {draft.document.dataset.cases?.length || 0} {t.datasets.cases}
            </Badge>
          </>
        )}
        <Failure error={preview.error || save.error} />
        {preview.isFetching && <span role="status">{t.common.loading}</span>}
        {preview.data?.requirements.map((requirement) => (
          <div
            key={requirement.key}
            className="testflow-panel testflow-panel-pad testflow-stack"
          >
            <div className="testflow-row testflow-between">
              <strong>{requirement.name}</strong>
              <Badge
                state={requirement.state === "resolved" ? "ready" : "pending"}
              >
                {requirement.state === "resolved"
                  ? t.datasets.resolved
                  : t.datasets.missing}
              </Badge>
            </div>
            <code className="testflow-transfer-identity">
              {requirement.type} · {requirement.revision_digest}
            </code>
            {requirement.candidates.length ? (
              <Choice
                label={`${t.datasets.asset} · ${requirement.name}`}
                disabled={save.isPending}
                value={
                  requirement.selected
                    ? JSON.stringify(requirement.selected)
                    : undefined
                }
                options={requirement.candidates.map((candidate) => ({
                  id: JSON.stringify({
                    id: candidate.id,
                    version: candidate.version,
                  }),
                  name: `${candidate.name} · v${candidate.version}`,
                }))}
                onChange={(value) => {
                  draft.setBindings((previous) => ({
                    ...previous,
                    [requirement.key]: JSON.parse(value),
                  }));
                  save.reset();
                }}
              />
            ) : (
              <Notice>{t.datasets.importAssetsFirst}</Notice>
            )}
          </div>
        ))}
        {preview.data?.errors.map((error, index) => (
          <Notice error key={index}>
            {String(error.message || error.code || "")}
          </Notice>
        ))}
        {preview.data?.valid && <Notice>{t.datasets.ready}</Notice>}
      </div>
    </Dialog>
  );
}
