import type { Case, Dataset, Resource } from "../../shared/api/types";
import { ApiError, write } from "../../shared/api/client";
import { useWrite } from "../../shared/api/hooks";
import { DraftConflict } from "../../shared/ui/draft-conflict";
import { useVersionedDraft } from "../../shared/ui/versioned-draft";
import { Failure } from "../../shared/ui";
import { CaseEditor, emptyCase } from "./case-editor";

export function CaseSession({ dataset, initial, onClose }: {
  dataset: Resource<Dataset>; initial?: Case; onClose:()=>void;
}) {
  const draft = useVersionedDraft("testflow.case-draft.v2."+dataset.id+"."+(initial?.id || "new"),dataset.version,{
    dataset:dataset.data, value:initial || emptyCase(dataset.data.input_schema),
  });
  const merge = (value: Case) => ({...draft.data.dataset,cases:(draft.data.dataset.cases || []).some(c=>c.id===value.id)
    ? draft.data.dataset.cases?.map(c=>c.id===value.id ? value : c) : [...(draft.data.dataset.cases || []),value]});
  const save = useWrite((value: Case)=>write(`/datasets/${dataset.id}`,{expected_version:draft.baseVersion,data:merge(value)},"PUT"));
  const conflict = dataset.version > draft.baseVersion || (save.error instanceof ApiError && save.error.status===409);
  return <CaseEditor initial={draft.data.value} schema={draft.data.dataset.input_schema}
    creating={!initial}
    blocked={conflict} pending={save.isPending} onClose={onClose}
    onDraftChange={value=>draft.setData(previous=>({...previous,value}))}
    onSave={value=>save.mutate(value,{onSuccess:()=>{draft.clear();onClose();}})}
    extra={<>
      <Failure error={save.error} />
      {conflict && <DraftConflict kind="datasets" id={dataset.id} draft={merge(draft.data.value)}
        onContinue={latest=>{draft.setBaseVersion(latest.version);draft.setData(previous=>({dataset:latest.data,value:previous.value}));save.reset();}} />}
    </>}
  />;
}
