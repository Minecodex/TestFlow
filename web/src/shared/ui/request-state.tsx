import { useMessages } from "../../i18n";
import { Action, Failure, Notice } from ".";
export function RequestState({
  error,
  retry,
  back,
}: {
  error: unknown;
  retry: () => void;
  back: () => void;
}) {
  const t = useMessages();
  return (
    <div className="testflow-stack">
      {error ? (
        <>
          <Failure error={error} />
          <div className="testflow-row">
            <Action onPress={retry}>{t.common.retry}</Action>
            <Action onPress={back}>{t.common.back}</Action>
          </div>
        </>
      ) : (
        <Notice>{t.common.loading}</Notice>
      )}
    </div>
  );
}
