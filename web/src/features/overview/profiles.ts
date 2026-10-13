import { useQueries } from "@tanstack/react-query";
import { getJson } from "../../shared/api/client";
import { useResourceOptions } from "../../shared/api/hooks";
import type { Profile } from "../../shared/api/types";
export function useProfileVersions() {
  const profiles = useResourceOptions<Profile>("evaluation-profiles");
  const revisions = useQueries({
    queries: (profiles.data?.items || []).map((profile) => ({
      queryKey: ["versions", "evaluation-profiles", profile.id],
      queryFn: () =>
        getJson<{ items: { number: number }[] }>(
          `/evaluation-profiles/${profile.id}/versions`,
        ),
    })),
  });
  const options = (profiles.data?.items || []).flatMap((profile, index) =>
    (revisions[index]?.data?.items || [{ number: profile.version }]).map(
      (revision) => ({
        id: `${profile.id}:${revision.number}`,
        name: `${profile.name} · v${revision.number}`,
      }),
    ),
  );
  return {
    options,
    isPending: profiles.isPending,
    error: profiles.error || revisions.find((r) => r.error)?.error,
  };
}
