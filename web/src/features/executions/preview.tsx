import { useQuery } from "@tanstack/react-query";
import { useMessages } from "../../i18n";
import { getJson } from "../../shared/api/client";
import type { Asset, Execution, Resource, Schema } from "../../shared/api/types";
import { Failure } from "../../shared/ui";
import { AssetReference } from "../assets/references";
import { ValueMedia } from "../assets/media";
import { MaterialLabel } from "../assets/material-label";

export interface MaterialPreview {
  input_schema: Schema; inputs: Record<string, unknown>; output_schema: Schema; output: Record<string, unknown>;
  reference?: Record<string, unknown>; reference_confirmed?: boolean;
}
export function executionPreview(execution: Execution): MaterialPreview {
  const graph = (execution.snapshot.pipeline as {graph: {input_schema: Schema; output_schema: Schema}}).graph;
  return {input_schema: graph.input_schema, output_schema: graph.output_schema,
    inputs: execution.snapshot.inputs as Record<string, unknown>, output: execution.output};
}
export function ExecutionMediaPreview({ materials, executionId, output = false, sourceCase }: {
  materials?: MaterialPreview; executionId?: string | null; output?: boolean; sourceCase?: {datasetId: string; caseId: string};
}) {
  const t = useMessages();
  const query = useQuery({queryKey: ["execution-preview", executionId], enabled: !materials?.input_schema && !!executionId,
    queryFn: () => getJson<Execution>("/executions/" + executionId)});
  const data = materials?.input_schema ? materials : query.data ? executionPreview(query.data) : undefined;
  if (!data) return <Failure error={query.error} />;
  const schema = output ? data.output_schema : data.input_schema;
  const values = output ? data.output : data.inputs;
  return <><div className="testflow-execution-preview" aria-label={output ? t.executions.finalOutput : t.executions.input}>
    {schema.fields.map((field, index) => {
      if (!(field.name in values)) return null;
      const entry = values[field.name] as {asset?: Resource<Asset>; value?: unknown};
      return <div key={field.name} className="testflow-case-material">
        <MaterialLabel field={field} index={index} />
        {!output && entry?.asset ? <AssetReference id={entry.asset.id} version={String(entry.asset.selected_version)} /> :
            <ValueMedia field={field} value={output ? values[field.name] : entry?.value} compact showStatus={false} />}
      </div>;
    })}
  </div>
  </>;
}
