import { useState } from "react";
import { useMessages } from "../../i18n";
import { getJson } from "../api/client";
import type { Resource } from "../api/types";
import { Action, Dialog, Failure, Json, Notice } from ".";

export function restoreDraft<T>(key: string, baseVersion: number, data: T) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null");
    if (
      stored?.data &&
      Number.isInteger(stored.base_version) &&
      stored.base_version >= 0
    )
      return {
        baseVersion: stored.base_version as number,
        data: stored.data as T,
      };
  } catch {
    /* An unreadable draft must not prevent opening the saved version. */
  }
  return { baseVersion, data: structuredClone(data) };
}

/** Review the server version before explicitly rebasing a retained local draft. */
export function DraftConflict<T>({
  kind,
  id,
  draft,
  onContinue,
}: {
  kind: string;
  id: string;
  draft: T;
  onContinue: (resource: Resource<T>) => void;
}) {
  const t = useMessages();
  const [latest, setLatest] = useState<Resource<T>>();
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  return (
    <div className="testflow-stack">
      <Notice error>{t.common.versionConflict}</Notice>
      <Action
        isPending={busy}
        onPress={async () => {
          setBusy(true);
          try {
            setLatest(await getJson<Resource<T>>(`/${kind}/${id}`));
            setError(undefined);
          } catch (error) {
            setError(error);
          } finally {
            setBusy(false);
          }
        }}
      >
        {t.common.reviewLatest}
      </Action>
      <Failure error={error} />
      {latest && (
        <Dialog
          title={t.common.versionConflict}
          wide
          onClose={() => setLatest(undefined)}
          footer={
            <>
              <Action onPress={() => setLatest(undefined)}>
                {t.common.cancel}
              </Action>
              <Action
                primary
                onPress={() => {
                  onContinue(latest);
                  setLatest(undefined);
                }}
              >
                {t.common.continueDraft}
              </Action>
            </>
          }
        >
          <Notice>{t.common.continueDraftHint}</Notice>
          <div className="testflow-grid-2">
            <div>
              <h3>
                {t.common.savedVersion} · v{latest.version}
              </h3>
              <Json value={latest.data} />
            </div>
            <div>
              <h3>{t.common.retainedDraft}</h3>
              <Json value={draft} />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
