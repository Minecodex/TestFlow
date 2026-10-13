import type { Evaluation, Execution, Profile, Resource } from "./types";
/** Latest ended evaluation for this fixed profile and binding configuration, including errors. */
export function currentEvaluation(
  execution: Execution,
): Evaluation | undefined {
  const frozen = execution.snapshot.profile as Resource<Profile> & {
    binding_digest?: string;
  };
  return execution.evaluations.find((evaluation) => {
    const profile = evaluation.profile as Resource<Profile> & {
      binding_digest?: string;
    };
    return (
      !["queued", "running"].includes(evaluation.state) &&
      profile.revision_id === frozen.revision_id &&
      profile.binding_digest === frozen.binding_digest
    );
  });
}
