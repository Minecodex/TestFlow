import { useEffect, useState } from "react";
import { X, CheckCircle2 } from "lucide-react";
import { useMessages } from "../../i18n";
import { Action } from ".";

export function Feedback() {
  const t = useMessages();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: number;
    const show = () => {
      clearTimeout(timer);
      setVisible(true);
      timer = window.setTimeout(() => setVisible(false), 4000);
    };
    window.addEventListener("testflow:submitted", show);
    return () => {
      window.removeEventListener("testflow:submitted", show);
      clearTimeout(timer);
    };
  }, []);
  return visible ? (
    <div className="testflow-feedback" role="status">
      <CheckCircle2 />
      <span>{t.common.submitted}</span>
      <Action
        isIconOnly
        size="sm"
        aria-label={t.common.close}
        onPress={() => setVisible(false)}
      >
        <X />
      </Action>
    </div>
  ) : null;
}
