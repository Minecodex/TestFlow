import { useQuery } from "@tanstack/react-query";
import { getJson } from "../api/client";
import type { Resource } from "../api/types";
import { Choice, Failure } from ".";
import { useMessages } from "../../i18n";
export function PinnedChoice({
  kind,
  label,
  resources,
  id,
  version,
  onChange,
}: {
  kind: string;
  label: string;
  resources: Resource<unknown>[];
  id: string;
  version: number;
  onChange: (id: string, version: number) => void;
}) {
  const t = useMessages();
  const versions = useQuery({
    queryKey: ["versions", kind, id],
    queryFn: () =>
      getJson<{ items: { number: number; data: { name?: string } }[] }>(
        `/${kind}/${id}/versions`,
      ),
    enabled: !!id && id !== "__snapshot",
  });
  return (
    <div className="testflow-stack">
      <Choice
        label={label}
        value={id}
        options={resources}
        onChange={(id) =>
          onChange(id, resources.find((r) => r.id === id)?.version || 1)
        }
      />
      {id && id !== "__snapshot" && (
        <Choice
          label={t.common.version}
          value={String(version)}
          options={(versions.data?.items || [{ number: version }]).map((v) => ({
            id: String(v.number),
            name: `v${v.number}`,
          }))}
          onChange={(v) => onChange(id, Number(v))}
        />
      )}
      <Failure error={versions.error} />
    </div>
  );
}
