import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Module, Resource } from "../../shared/api/types";
import { ApiError, write } from "../../shared/api/client";
import { useWrite } from "../../shared/api/hooks";
import { Action, Failure, Notice } from "../../shared/ui";
import { DraftConflict } from "../../shared/ui/draft-conflict";
import { useVersionedDraft } from "../../shared/ui/versioned-draft";
import { useMessages } from "../../i18n";
import { moduleRuntime } from "./config";
import { RuntimeEditor } from "./runtime";
import { ModuleValidation } from "./validation";

export function RuntimeConfiguration({ module, onBlocked }: {
  module: Resource<Module>; onBlocked: (blocked: boolean) => void;
}) {
  const t = useMessages(), query = useQueryClient();
  const draft = useVersionedDraft(`testflow.module-runtime.${module.id}`, module.version, moduleRuntime(module.data));
  const [saved, setSaved] = useState(module);
  const dirty = JSON.stringify(draft.data) !== JSON.stringify(moduleRuntime(saved.data));
  const save = useWrite(() => write<Resource<Module>>(`/modules/${module.id}/runtime`, {
    expected_version: draft.baseVersion, runtime: draft.data,
  }, "PUT"));
  const conflict = module.version > draft.baseVersion || save.error instanceof ApiError && save.error.status === 409;
  useEffect(() => onBlocked(dirty || conflict || save.isPending), [dirty, conflict, save.isPending, onBlocked]);
  const invalid = !draft.data.image.trim() || !Number.isInteger(draft.data.port) || draft.data.port! < 1024 || draft.data.port! > 65535 || !!draft.data.code_mount && !draft.data.code_mount.commit;
  return <div className="testflow-stack testflow-module-runtime-editor">
    <RuntimeEditor value={draft.data} onChange={draft.setData} />
    <Action primary action="save-module-runtime" isPending={save.isPending} isDisabled={!dirty || invalid || conflict}
      onPress={() => save.mutate(undefined, {onSuccess: result => {
        setSaved(result); draft.setData(moduleRuntime(result.data)); draft.setBaseVersion(result.version); draft.clear();
        query.setQueryData(["resource", "modules", module.id, undefined], result);
      }})}>{t.modules.saveRuntime}</Action>
    <Failure error={save.error} />
    {conflict && <DraftConflict kind="modules" id={module.id} draft={{...module.data, runtime: draft.data}}
      onContinue={latest => {setSaved(latest); draft.setBaseVersion(latest.version); save.reset();}} />}
    {dirty ? <Notice>{t.modules.saveRuntimeFirst}</Notice> : !conflict && <ModuleValidation key={saved.revision_id} module={saved} runtime={moduleRuntime(saved.data)} />}
  </div>;
}
