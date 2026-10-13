import { useState } from "react";
import { X } from "lucide-react";
import { useMessages } from "../../i18n";
import { Action, Text } from ".";

export function TagsInput({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const t = useMessages();
  const [input, setInput] = useState("");
  const add = () => {
    const tag = input.trim();
    if (tag && !value.includes(tag)) onChange([...value, tag]);
    setInput("");
  };
  return <div className="testflow-tags-input">
    <Text label={t.assets.tags} value={input} onChange={setInput} hint={t.assets.tagsHint}
      placeholder={t.assets.tagsPlaceholder} onKeyDown={event => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(); }
      }} />
    <div className="testflow-chips" aria-label={t.assets.tags}>
      {value.map(tag => <span className="testflow-tag" key={tag}>{tag}<Action variant="ghost" size="sm" isIconOnly
        aria-label={`${t.common.delete} ${tag}`} onPress={() => onChange(value.filter(v => v !== tag))}><X /></Action></span>)}
    </div>
  </div>;
}
