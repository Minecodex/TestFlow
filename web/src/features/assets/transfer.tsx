import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useMessages } from "../../i18n";
import { api, exportFile, operationKey, write } from "../../shared/api/client";
import { useResourceOptions, useWrite } from "../../shared/api/hooks";
import type {
  Asset,
  AssetImportResult,
  AssetPreview,
} from "../../shared/api/types";
import {
  Action,
  Badge,
  Check,
  Dialog,
  Empty,
  Failure,
  Notice,
  Text,
} from "../../shared/ui";
import { FileInput } from "../../shared/ui/file-input";

function form(file: File) {
  const value = new FormData();
  value.append("file", file);
  return value;
}

/** Remains mounted on the page so closing the dialog retains the selected File. */
export function AssetTransfer({
  mode,
  onClose,
}: {
  mode: "" | "import" | "export";
  onClose: () => void;
}) {
  const t = useMessages();
  const navigate = useNavigate();
  const [file, setFile] = useState<File>();
  const [key, setKey] = useState(operationKey);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const assets = useResourceOptions<Asset>("assets");
  const preview = useQuery({
    queryKey: ["asset-package-preview", key],
    enabled: mode === "import" && !!file,
    queryFn: ({ signal }) =>
      api<AssetPreview>("/assets/import/preview", {
        method: "POST",
        body: form(file!),
        signal,
      }),
    retry: false,
  });
  const save = useWrite(() =>
    write<AssetImportResult>("/assets/import", form(file!), "POST", key),
  );
  const choices = assets.data?.items || [];
  const visible = choices.filter((a) =>
    a.name.toLowerCase().includes(search.toLowerCase()),
  );
  const exported = choices.filter((a) => selected[a.id]);
  const output = useWrite(() =>
    exportFile(
      "/assets/export",
      {
        assets: exported.map((a) => ({ id: a.id, version: a.version })),
      },
      "testflow-assets.zip",
    ),
  );
  const pending = save.isPending || output.isPending;
  if (!mode) return null;
  return (
    <Dialog
      title={
        mode === "import" ? t.assets.importPackage : t.assets.exportPackage
      }
      onClose={() => {
        if (!pending) onClose();
      }}
      footer={
        <>
          <Action isDisabled={pending} onPress={onClose}>
            {t.common.close}
          </Action>
          {mode === "import" ? (
            <Action
              primary
              action="submit-asset-package"
              isPending={save.isPending}
              isDisabled={
                !preview.data?.valid ||
                preview.isFetching ||
                !!preview.error ||
                !!save.data
              }
              onPress={() => save.mutate(undefined)}
            >
              {t.assets.importPackage}
            </Action>
          ) : (
            <Action
              primary
              action="submit-asset-export"
              isPending={output.isPending}
              isDisabled={
                !exported.length ||
                exported.length > 1000 ||
                !!assets.error ||
                assets.isPending
              }
              onPress={() => output.mutate(undefined)}
            >
              {t.assets.exportPackage}
            </Action>
          )}
        </>
      }
    >
      <div className="testflow-stack">
        <Notice>{t.assets.packageNote}</Notice>
        {mode === "import" ? (
          <>
            <FileInput
              label={t.assets.choosePackage}
              accept=".zip"
              disabled={pending}
              onChange={(files) => {
                setFile(files[0]);
                setKey(operationKey());
                save.reset();
              }}
            />
            {file && <Notice>{file.name}</Notice>}
            <Failure error={preview.error || save.error} />
            {file && (
              <Action
                size="sm"
                isPending={preview.isFetching}
                isDisabled={pending}
                onPress={() => {
                  void preview.refetch();
                }}
              >
                {t.common.refresh}
              </Action>
            )}
            {(save.data?.items || preview.data?.items || []).map((item) => (
              <div
                key={item.key}
                className="testflow-row testflow-between testflow-outline"
              >
                <div>
                  <strong>{item.name}</strong>
                  <div className="testflow-small testflow-muted">
                    {item.type}
                  </div>
                </div>
                <div className="testflow-row">
                  <Badge state={item.state === "reuse" ? "ready" : "pending"}>
                    {save.data
                      ? item.state === "reuse"
                        ? t.assets.reused
                        : t.assets.imported
                      : item.state === "reuse"
                        ? t.assets.willReuse
                        : t.assets.willCreate}
                  </Badge>
                  {save.data && item.resource && (
                    <Action
                      size="sm"
                      onPress={() => {
                        onClose();
                        navigate("/assets/" + item.resource!.id);
                      }}
                    >
                      {t.common.details}
                    </Action>
                  )}
                </div>
              </div>
            ))}
            {save.data && (
              <Notice>
                {t.assets.importSummary}: {save.data.created} /{" "}
                {t.assets.reused}: {save.data.reused}
              </Notice>
            )}
          </>
        ) : (
          <>
            <Text
              label={t.assets.filterExport}
              value={search}
              onChange={setSearch}
              disabled={pending}
            />
            <div className="testflow-row">
              <Action
                isDisabled={pending}
                onPress={() =>
                  setSelected({
                    ...selected,
                    ...Object.fromEntries(visible.map((a) => [a.id, true])),
                  })
                }
              >
                {t.assets.selectAll}
              </Action>
              <Action isDisabled={pending} onPress={() => setSelected({})}>
                {t.assets.clearSelection}
              </Action>
              <Badge>
                {exported.length} / {choices.length}
              </Badge>
            </div>
            <Failure error={assets.error || output.error} />
            {!visible.length && !assets.isPending && (
              <Empty text={t.common.empty} />
            )}
            <div className="testflow-transfer-list">
              {visible.map((a) => (
                <Check
                  key={a.id}
                  value={!!selected[a.id]}
                  disabled={pending}
                  onChange={(value) =>
                    setSelected({ ...selected, [a.id]: value })
                  }
                >
                  {a.name} · {t.common.types[a.data.type]} · v{a.version}
                </Check>
              ))}
            </div>
            {output.isSuccess && <Notice>{t.assets.exported}</Notice>}
          </>
        )}
      </div>
    </Dialog>
  );
}
