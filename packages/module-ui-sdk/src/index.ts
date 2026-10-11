import type { ComponentType } from 'react';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// Bootstrap interface; package loading/version negotiation will be implemented separately.
export interface ModuleConfigPanelProps<Value extends JsonObject = JsonObject> {
  value: Value;
  onChange: (value: Value) => void;
  readonly: boolean;
  schema: JsonObject;
  locale: 'zh-CN' | 'en-US';
  theme: 'light' | 'dark';
}

export type ModuleConfigPanel<Value extends JsonObject = JsonObject> = ComponentType<ModuleConfigPanelProps<Value>>;
