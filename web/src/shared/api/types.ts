import type { components } from "./generated";
export type Schema = components["schemas"]["Schema"];
export type PortField = components["schemas"]["PortField"];
export type Pipeline = components["schemas"]["PipelineBody"];
export type GraphNode = components["schemas"]["GraphNode"];
export type Runtime = components["schemas"]["PodRuntime"];
export type Dataset = components["schemas"]["DatasetBody"];
export type Case = components["schemas"]["Case"];
export type Binding = components["schemas"]["Binding"];
export type Asset = components["schemas"]["AssetBody"];
export type Repository = components["schemas"]["RepositoryBody"];
export type Profile = components["schemas"]["EvaluationProfileBody"];
export type Dimension = components["schemas"]["Dimension"];
export type TaskBody = components["schemas"]["TaskBody"];
export type QuickBody = components["schemas"]["QuickExecutionBody"];
export type Page<T> = Omit<
  components["schemas"]["ResourcePageResponse"],
  "items"
> & { items: T[] };
export type Resource<T> = Omit<
  components["schemas"]["ResourceResponse"],
  "data"
> & { data: T };
export interface Module {
  name: string;
  manifest: components["schemas"]["ModuleManifest"];
  inputs: Schema;
  outputs: Schema;
  parameters: Record<string, unknown>;
  package_digest: string;
  contract_digest: string;
  readme: string;
}
export type Operation = components["schemas"]["OperationResponse"];
export type Credential = components["schemas"]["CredentialResponse"];
export type TraceNode = components["schemas"]["TraceNodeResponse"];
export type Evaluation = Omit<
  components["schemas"]["EvaluationResponse"],
  "profile" | "result"
> & {
  profile: Resource<Profile>;
  result: { verdict?: string; dimensions?: Score[] };
};
export interface Score {
  method: string;
  id: string;
  name: string;
  state: string;
  score?: number;
  threshold?: number;
  reason?: string;
  required: boolean;
  needs_reference: boolean;
  applicable: boolean;
  bindings: {
    actual: components["schemas"]["EvidenceBinding"];
    reference?: components["schemas"]["EvidenceBinding"] | null;
    evidence: components["schemas"]["EvidenceBinding"][];
  };
  evidence?: string[];
  provider?: Record<string, unknown>;
  error?: { code: string; message: string };
}
export type Event = components["schemas"]["EventResponse"];
export type Execution = Omit<
  components["schemas"]["ExecutionResponse"],
  "evaluations" | "attempts"
> & {
  evaluations: Evaluation[];
  attempts: Execution[];
};
export type Rates = components["schemas"]["RatesResponse"];
export type ReportRow = Omit<
  components["schemas"]["ReportRowResponse"],
  "case" | "dataset" | "pipeline" | "evaluation"
> & {
  case: Case;
  dataset: { id: string; name: string; version: number };
  pipeline: { id: string; name: string; version: number };
  evaluation: Evaluation["result"] | null;
};
export type Report = Omit<components["schemas"]["ReportResponse"], "rows"> & {
  rows: ReportRow[];
};
export type Task = Omit<
  components["schemas"]["TaskDetailResponse"],
  "report" | "snapshot"
> & { report: Report; snapshot: TaskBody & { restrictions?: unknown[] } };
export type Overview = Omit<
  components["schemas"]["OverviewResponse"],
  "tasks"
> & { tasks: Task[] };
export const formats = {
  Text: "UTF-8",
  JSON: "application/json",
  Audio: "WAV · 16kHz · Mono",
  Image: "Image/*",
};
export const textSchema: Schema = {
  fields: [{ name: "text", type: "Text", format: "UTF-8", stream: false }],
};
