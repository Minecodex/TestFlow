import { useState } from "react";
import { Input, Label, TextField } from "@heroui/react";
import type { ModuleConfigPanelProps } from "@testflow/module-ui-sdk";

export const sdk = "testflow.ui.v1";
export default function Panel({ value, onChange, readonly, locale }: ModuleConfigPanelProps) {
  const [edits, setEdits] = useState(0);
  const change = (key: string, text: string) => {
    setEdits(n => n + 1);
    onChange({ ...value, [key]: key === "delay_ms" ? Number(text) : text });
  };
  return <div className="testflow-stack">
    <TextField value={String(value.mode)} isDisabled={readonly} onChange={text => change("mode", text)}>
      <Label>{locale === "zh-CN" ? "测试行为" : "Test behavior"}</Label><Input />
    </TextField>
    <TextField value={String(value.delay_ms)} isDisabled={readonly} onChange={text => change("delay_ms", text)}>
      <Label>{locale === "zh-CN" ? "延迟（毫秒）" : "Delay (ms)"}</Label><Input />
    </TextField>
    <span className="testflow-small testflow-muted">{locale === "zh-CN" ? "参数修订" : "Parameter edits"}: {edits}</span>
  </div>;
}
