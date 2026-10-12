import * as React from "react";
import * as JSXRuntime from "react/jsx-runtime";
import * as HeroUI from "@heroui/react";
import { useEffect, useState } from "react";
import { usePreferences } from "../state/preferences";
import { Action, Json, Notice } from "../ui";
import type { Module, Resource } from "../api/types";
import { getJson } from "../api/client";
import { useMessages } from "../../i18n";
import { parameterErrors } from "../schema/validation";
interface PanelProps {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  readonly: boolean;
  schema: Record<string, unknown>;
  locale: string;
  theme: string;
  version: { moduleId: string; revisionId: string; version: number };
}
interface Host {
  version: "testflow.ui.v1";
  React: typeof React;
  JSXRuntime: typeof JSXRuntime;
  HeroUI: typeof HeroUI;
  SDK: {
    credentialOptions: (
      kind?: string,
    ) => Promise<{ id: string; name: string; kind: string }[]>;
  };
}
declare global {
  interface Window {
    TestFlowHost: Host;
  }
}
window.TestFlowHost = Object.freeze({
  version: "testflow.ui.v1",
  React,
  JSXRuntime,
  HeroUI,
  SDK: Object.freeze({
    credentialOptions: async (kind = "module") => {
      const response = await getJson<{
        items: { id: string; name: string; kind: string }[];
      }>("/credentials");
      return response.items.filter((item) => item.kind === kind);
    },
  }),
});
const cache = new Map<
  string,
  Promise<{ default: React.ComponentType<PanelProps>; sdk: string }>
>();
class Boundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
export function ModulePanel({
  module,
  value,
  onChange,
  readonly = false,
}: {
  module: Resource<Module>;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  readonly?: boolean;
}) {
  const t = useMessages();
  const { locale, theme } = usePreferences();
  const [component, setComponent] = useState<React.ComponentType<PanelProps>>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setComponent(undefined);
    setFailed(false);
    const path = `/api/v1/modules/${module.id}/files/${module.data.manifest.ui}?version=${module.selected_version}&load=${attempt}`;
    if (!cache.has(path)) cache.set(path, import(/* @vite-ignore */ path));
    cache
      .get(path)!
      .then((result) => {
        if (
          result.sdk !== "testflow.ui.v1" ||
          typeof result.default !== "function"
        )
          throw new Error("UI SDK mismatch");
        if (active) setComponent(() => result.default);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [module.id, module.selected_version, module.data.manifest.ui, attempt]);
  const fallback = (
    <>
      <Notice error>{t.modules.uiFailure}</Notice>
      <Json value={value} />
      <Action onPress={() => setAttempt((v) => v + 1)}>{t.common.retry}</Action>
    </>
  );
  const Component = component;
  const errors = parameterErrors(module.data.parameters, value);
  const panel = failed ? (
    fallback
  ) : Component ? (
    <Boundary key={module.revision_id + ":" + attempt} fallback={fallback}>
      <Component
        value={value}
        onChange={(v) => {
          if (!readonly) onChange(v);
        }}
        readonly={readonly}
        schema={module.data.parameters}
        locale={locale}
        theme={theme}
        version={{
          moduleId: module.id,
          revisionId: module.revision_id,
          version: module.selected_version,
        }}
      />
    </Boundary>
  ) : (
    <Notice>{t.common.loading}</Notice>
  );
  return (
    <div className="testflow-stack">
      {errors.length > 0 && (
        <Notice error>
          {t.modules.parametersInvalid}
          {errors.map((error, i) => (
            <div key={i}>
              <code>{error.path}</code> · {error.detail}
            </div>
          ))}
        </Notice>
      )}
      {panel}
    </div>
  );
}
