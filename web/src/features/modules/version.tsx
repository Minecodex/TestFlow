import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useMessages } from "../../i18n";
import { getJson } from "../../shared/api/client";
import type { Module, Resource } from "../../shared/api/types";
import { Choice, Failure } from "../../shared/ui";
export function ModuleVersion({
  module,
  onSelect,
}: {
  module: Resource<Module>;
  onSelect: (module: Resource<Module>) => void;
}) {
  const t = useMessages();
  const [error, setError] = useState<unknown>();
  const versions = useQuery({
    queryKey: ["versions", "modules", module.id],
    queryFn: () =>
      getJson<{ items: { number: number; data: Module }[] }>(
        `/modules/${module.id}/versions`,
      ),
  });
  return (
    <>
      <Choice
        label={t.common.version}
        value={String(module.selected_version)}
        options={(versions.data?.items || []).map((v) => ({
          id: String(v.number),
          name: `v${v.number} · ${v.data.manifest.version}`,
        }))}
        onChange={async (version) => {
          try {
            const pinned = await getJson<Resource<Module>>(
              `/modules/${module.id}?version=${version}`,
            );
            setError(undefined);
            onSelect(pinned);
          } catch (e) {
            setError(e);
          }
        }}
      />
      <Failure error={error || versions.error} />
    </>
  );
}
