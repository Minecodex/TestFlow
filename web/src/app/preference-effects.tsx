import { useEffect } from "react";
import { usePreferences } from "../shared/state/preferences";

export function PreferenceEffects() {
  const { locale, theme } = usePreferences();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.classList.toggle("light", theme === "light");
    document.documentElement.style.colorScheme = theme;
  }, [locale, theme]);
  return null;
}
