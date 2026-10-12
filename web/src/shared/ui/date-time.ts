import { useMemo } from "react";
import { usePreferences } from "../state/preferences";

/** Lists use a compact local timestamp; full precision remains in details and snapshots. */
export function useCompactDateTime() {
  const locale = usePreferences(state => state.locale);
  const formatter = useMemo(() => new Intl.DateTimeFormat(locale, {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }), [locale]);
  return (value: string | Date) => formatter.format(new Date(value));
}
