import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMessages } from "../../i18n";
import { operationKey, write } from "../../shared/api/client";
import { useWrite } from "../../shared/api/hooks";
import type {
  Pipeline,
  Resource,
  WorkflowDocument,
  WorkflowImport,
  WorkflowPreview,
} from "../../shared/api/types";
import {
  Action,
  Badge,
  Choice,
  Dialog,
  Failure,
  Notice,
  Text,
} from "../../shared/ui";
import { FileInput } from "../../shared/ui/file-input";

const draftKey = "testflow.workflow-import-draft.v1";
type ImportDraft = {
  document?: WorkflowDocument;
  filename: string;
  name: string;
  bindings: WorkflowImport["bindings"];
  fileError: boolean;
  key?: string;
};
function restoreImport(): ImportDraft {
  const empty = { filename: "", name: "", bindings: {}, fileError: false };
  try {
    const value = JSON.parse(localStorage.getItem(draftKey) || "null");
    if (
      value?.document?.format === "testflow.workflow.v1" &&
      typeof value.filename === "string" &&
      typeof value.name === "string" &&
      value.bindings &&
      typeof value.bindings === "object"
    )
      return value;
  } catch {
    /* An invalid local draft cannot replace a selected file. */
  }
  return empty;
}

/** Keep the file and bindings when the dialog closes; only successful import clears the draft. */
export function ImportWorkflow({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (resource: Resource<Pipeline>) => void;
}) {
  const t = useMessages();
  const [initial] = useState(restoreImport);
  const [document, setDocument] = useState(initial.document);
  const [filename, setFilename] = useState(initial.filename);
  const [name, setName] = useState(initial.name);
  const [bindings, setBindings] = useState(initial.bindings);
  const [fileError, setFileError] = useState(initial.fileError);
  const reading = useRef(0);
  const body = useMemo(
    () =>
      document
        ? { document, bindings, name: name.trim() || undefined }
        : undefined,
    [document, bindings, name],
  );
  const fingerprint = JSON.stringify(body);
  const initialFingerprint = useMemo(
    () =>
      initial.document
        ? JSON.stringify({
            document: initial.document,
            bindings: initial.bindings,
            name: initial.name.trim() || undefined,
          })
        : undefined,
    [initial],
  );
  const key = useMemo(
    () =>
      initialFingerprint === fingerprint &&
      typeof initial.key === "string" &&
      initial.key.length <= 128
        ? initial.key
        : operationKey(),
    [fingerprint, initialFingerprint, initial],
  );
  useEffect(() => {
    try {
      if (document)
        localStorage.setItem(
          draftKey,
          JSON.stringify({
            document,
            filename,
            name,
            bindings,
            fileError,
            key,
          }),
        );
      else localStorage.removeItem(draftKey);
    } catch {
      /* In-memory drafts continue to work when browser storage is full or unavailable. */
    }
  }, [document, filename, name, bindings, fileError, key]);
  const preview = useQuery({
    queryKey: ["workflow-preview", body],
    queryFn: () => write<WorkflowPreview>("/pipelines/import/preview", body),
    enabled: open && !!body,
    retry: false,
    staleTime: 0,
  });
  const importing = useWrite(() =>
    write<Resource<Pipeline>>("/pipelines/import", body, "POST", key),
  );
  useEffect(
    () => () => {
      reading.current++;
    },
    [],
  );
  async function read(file?: File) {
    const generation = ++reading.current;
    setDocument(undefined);
    setBindings({});
    setFilename(file?.name || "");
    setFileError(false);
    importing.reset();
    if (!file) return;
    try {
      if (file.size > 4 * 1024 * 1024) throw Error("size");
      const value = JSON.parse(await file.text());
      if (
        value?.format !== "testflow.workflow.v1" ||
        typeof value?.pipeline?.name !== "string"
      )
        throw Error("format");
      if (reading.current !== generation) return;
      setName(value.pipeline.name);
      setDocument(value);
    } catch {
      if (reading.current === generation) setFileError(true);
    }
  }
  if (!open) return null;
  const kinds = {
    module: t.pipelines.workflowModule,
    repository: t.pipelines.workflowRepository,
    credential: t.pipelines.workflowCredential,
  };
  return (
    <Dialog
      title={t.pipelines.importWorkflow}
      onClose={() => {
        if (!importing.isPending) onClose();
      }}
      footer={
        <>
          <Action isDisabled={importing.isPending} onPress={onClose}>
            {t.common.cancel}
          </Action>
          <Action
            action="preview-import-flow"
            isDisabled={!body || importing.isPending}
            isPending={preview.isFetching}
            onPress={() => void preview.refetch()}
          >
            {t.common.refresh}
          </Action>
          <Action
            primary
            action="confirm-import-flow"
            isDisabled={
              !preview.data?.valid ||
              preview.isFetching ||
              !!preview.error ||
              !name.trim()
            }
            isPending={importing.isPending}
            onPress={() =>
              importing.mutate(undefined, {
                onSuccess: (resource) => {
                  try {
                    localStorage.removeItem(draftKey);
                  } catch {
                    /* Import has already succeeded. */
                  }
                  setDocument(undefined);
                  setFilename("");
                  setBindings({});
                  setName("");
                  onImported(resource);
                },
              })
            }
          >
            {t.pipelines.importWorkflow}
          </Action>
        </>
      }
    >
      <div className="testflow-stack">
        <Notice>{t.pipelines.workflowHint}</Notice>
        <FileInput
          label={t.pipelines.workflowFile}
          accept=".json,application/json"
          disabled={importing.isPending}
          onChange={(files) => void read(files[0])}
        />
        {filename && <span className="testflow-small">{filename}</span>}
        {fileError && <Notice error>{t.pipelines.workflowInvalidFile}</Notice>}
        {document && (
          <Text
            label={t.common.name}
            value={name}
            onChange={setName}
            disabled={importing.isPending}
          />
        )}
        <Failure error={preview.error || importing.error} />
        {preview.isFetching && <span role="status">{t.common.loading}</span>}
        {preview.data && (
          <>
            <h3>{t.pipelines.workflowDependencies}</h3>
            {preview.data.requirements.map((requirement) => {
              const label = `${kinds[requirement.kind]} · ${requirement.name}`;
              const selected = requirement.selected;
              return (
                <div
                  className="testflow-panel testflow-panel-pad testflow-stack"
                  key={requirement.key}
                >
                  <div className="testflow-row testflow-between">
                    <strong>{label}</strong>
                    <Badge
                      state={
                        requirement.state === "resolved" ? "ready" : "pending"
                      }
                    >
                      {requirement.state === "resolved"
                        ? t.pipelines.workflowResolved
                        : t.pipelines.workflowSelect}
                    </Badge>
                  </div>
                  <code className="testflow-transfer-identity">
                    {requirement.identity}
                  </code>
                  {requirement.options.length > 0 ? (
                    <Choice
                      label={label}
                      disabled={importing.isPending}
                      value={
                        selected
                          ? JSON.stringify({
                              id: selected.id,
                              version: selected.version,
                            })
                          : undefined
                      }
                      options={requirement.options.map((option) => ({
                        id: JSON.stringify({
                          id: option.id,
                          version: option.version,
                        }),
                        name:
                          option.name +
                          (option.version ? ` · v${option.version}` : ""),
                      }))}
                      onChange={(value) => {
                        setBindings((previous) => ({
                          ...previous,
                          [requirement.key]: JSON.parse(value),
                        }));
                        importing.reset();
                      }}
                    />
                  ) : (
                    <Notice>{t.pipelines.workflowMissing}</Notice>
                  )}
                </div>
              );
            })}
            {preview.data.errors.map((error, index) => (
              <Notice error key={index}>
                {String(error.message || error.code || "")}
              </Notice>
            ))}
            {preview.data.valid && <Notice>{t.pipelines.workflowReady}</Notice>}
          </>
        )}
      </div>
    </Dialog>
  );
}
