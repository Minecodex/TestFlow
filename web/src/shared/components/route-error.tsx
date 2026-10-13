import { Button } from "@heroui/react";
import { useEffect } from "react";
import { useRouteError } from "react-router-dom";
import { useMessages } from "../../i18n";

export function RouteError() {
  const t = useMessages();
  const error = useRouteError();
  const staleChunk = error instanceof Error && /dynamically imported|Loading chunk|module script/i.test(error.message);
  useEffect(() => {
    if (!staleChunk) return;
    // Recover display data once after deployment; never resubmit execution commands.
    const key = "testflow.chunk-reload." + location.pathname;
    try {
      if (Date.now() - Number(sessionStorage.getItem(key) || 0) < 60_000) return;
      sessionStorage.setItem(key, String(Date.now()));
      location.reload();
    } catch {}
  }, [staleChunk]);
  return (
    <main className="testflow-login">
      <section className="testflow-panel testflow-stack">
        <strong>TestFlow</strong>
        <h1>{t.common.pageLoadError}</h1>
        <p>{t.common.reloadDescription}</p>
        <div className="testflow-row">
          <Button onPress={() => location.assign("/")}>{t.common.back}</Button>
          <Button variant="primary" onPress={() => location.reload()}>{t.common.refresh}</Button>
        </div>
      </section>
    </main>
  );
}
