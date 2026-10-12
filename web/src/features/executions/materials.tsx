import { useMessages } from "../../i18n";
import type { Evaluation, Execution, Pipeline, Resource, Profile } from "../../shared/api/types";
import { Badge, Empty, Json, Panel, Status } from "../../shared/ui";
import { ValueMedia } from "../assets/media";

function inputMaterial(value: unknown, captured: boolean) {
  if (captured) return value;
  const binding = value as {value?:unknown;asset?:{id:string;selected_version:number}};
  return binding.asset ? {asset_id:binding.asset.id,asset_version:binding.asset.selected_version} : binding.value;
}
export function elapsed(milliseconds?: number | null) {
  if (milliseconds == null) return "—";
  return milliseconds >= 1000 ? `${(milliseconds/1000).toFixed(2)} s` : `${Math.round(milliseconds)} ms`;
}
export function ExecutionMaterials({execution,graph,bindings,captured,targeted}: {
  execution:Execution;graph:Pipeline;bindings:Record<string,unknown>;captured:boolean;
  targeted:(source:string,field?:string)=>boolean;
}) {
  const t=useMessages();
  const dataset=execution.snapshot.dataset as {name?:string;selected_version?:number}|undefined;
  const reference=execution.snapshot.reference as Record<string,unknown>|undefined;
  const values=Object.values(reference || {});
  return <div className="testflow-grid-2 testflow-execution-materials">
    <Panel title={t.executions.input} actions={dataset?.name && <Badge>{dataset.name} v{dataset.selected_version}</Badge>}>
      <div className="testflow-stack">
        {graph.input_schema.fields.filter(f=>f.name in bindings).map(field=><div key={field.name} tabIndex={-1}
          data-evidence-target={targeted("input",field.name)} className={targeted("input",field.name)?"testflow-evidence-selected":""}>
          <div className="testflow-eyebrow testflow-material-label">{field.name}</div>
          <ValueMedia field={field} value={inputMaterial(bindings[field.name],captured)} framed />
        </div>)}
        <div tabIndex={-1} data-evidence-target={targeted("reference")}
          className={`testflow-execution-reference ${targeted("reference")?"testflow-evidence-selected":""}`}>
          <div className="testflow-row testflow-between testflow-material-title">
            <span className="testflow-small testflow-muted">{t.executions.referenceContent}</span>
            <Badge state={execution.snapshot.reference_confirmed?"ready":"pending"}>
              {execution.snapshot.reference_confirmed?t.common.confirmed:t.common.unconfirmed}
            </Badge>
          </div>
          {values.length===1 && typeof values[0]==="string"?<p className="testflow-small testflow-muted">{values[0]}</p>:<Json value={reference} />}
        </div>
      </div>
    </Panel>
    <Panel title={t.executions.finalOutput} actions={<Badge state={execution.winner?"ready":"pending"}>{execution.winner?t.executions.completeGroup:t.executions.noCompleteGroup}</Badge>}>
      <div className="testflow-stack">
        {graph.output_schema.fields.filter(f=>f.name in execution.output).map(field=>{
          const value=execution.output[field.name];
          const stream=field.stream && typeof value==="object" && value!==null?value as {eos?:boolean}:undefined;
          return <div key={field.name} tabIndex={-1} data-evidence-target={targeted("output",field.name)}
            className={targeted("output",field.name)?"testflow-evidence-selected":""}>
            <div className="testflow-row testflow-between testflow-material-title">
              <div className="testflow-eyebrow">{field.name} / {field.type}</div>
              {stream && <Badge state={stream.eos?"succeeded":"failed"}>{stream.eos?t.assets.streamComplete:t.assets.streamIncomplete}</Badge>}
            </div>
            <ValueMedia value={value} field={field} framed showStatus={false} />
          </div>;
        })}
        {!Object.keys(execution.output).length && <Empty text={t.common.empty} />}
      </div>
      <div className="testflow-section-note">{t.executions.outputRule}</div>
    </Panel>
  </div>;
}
export function ExecutionSummary({execution,evaluation,graph}: {execution:Execution;evaluation?:Evaluation;graph:Pipeline}) {
  const t=useMessages();
  const profile=evaluation?.profile || execution.snapshot.profile as Resource<Profile>;
  const mounts=graph.nodes.map(n=>n.runtime?.code_mount?.commit).filter(Boolean);
  const commits=[...new Set(mounts)];
  return <div className="testflow-execution-summary">
    <div><small>{t.executions.totalDuration}</small><strong className="testflow-mono">{elapsed(execution.duration_ms)}</strong></div>
    <div><small>{t.executions.codeCommit}</small><strong className="testflow-mono" title={commits.join(", ")}>{commits.length?commits.map(c=>c!.slice(0,7)).join(", "):t.executions.noRepository}</strong></div>
    <div><small>{t.evaluation.title}</small><strong>{profile?.name || "—"} {profile?.selected_version?`v${profile.selected_version}`:""}</strong></div>
    <div><small>{t.executions.evaluationBasis}</small><strong>{execution.snapshot.reference_confirmed?t.executions.referenceAndQuality:t.executions.qualityOnly}</strong></div>
    <div><small>{t.executions.triggeredEnd}</small><strong>{execution.winner || "—"}</strong></div>
    <div><small>{t.executions.cleanup}</small><span><Status value={execution.cleanup} /></span></div>
  </div>;
}
