import type * as React from "react";
import type { ComponentType } from "react";

export const sdk = "testflow.ui.v1" as const;
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export interface ModuleConfigPanelProps<Value extends JsonObject = JsonObject> {
  value: Value;
  onChange: (value: Value) => void;
  readonly: boolean;
  schema: JsonObject;
  locale: "zh-CN" | "en-US";
  theme: "light" | "dark";
  version: { moduleId: string; revisionId: string; version: number };
}
export type ModuleConfigPanel<Value extends JsonObject = JsonObject> =
  ComponentType<ModuleConfigPanelProps<Value>>;
export interface ModuleUIHost {
  version: typeof sdk;
  React: typeof React;
  JSXRuntime: { jsx: unknown; jsxs: unknown; Fragment: unknown };
  HeroUI: Record<string, unknown>;
  SDK: {
    credentialOptions: (
      kind?: string,
    ) => Promise<{ id: string; name: string; kind: string }[]>;
  };
}
export function getHost(): ModuleUIHost {
  const host = (window as unknown as { TestFlowHost?: ModuleUIHost })
    .TestFlowHost;
  if (!host || host.version !== sdk)
    throw new Error("TestFlow UI host v1 required");
  return host;
}
