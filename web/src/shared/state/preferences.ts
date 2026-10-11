import { create } from 'zustand';

export type Locale = 'zh-CN' | 'en-US';
export type Theme = 'light' | 'dark';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Preferences still work in memory. */ }
}

interface Preferences {
  locale: Locale;
  theme: Theme;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: Theme) => void;
}

export const usePreferences = create<Preferences>((set) => ({
  locale: read('testflow.locale') === 'en-US' ? 'en-US' : 'zh-CN',
  theme: read('testflow.theme') === 'dark' ? 'dark' : 'light',
  setLocale: (locale) => { write('testflow.locale', locale); set({ locale }); },
  setTheme: (theme) => { write('testflow.theme', theme); set({ theme }); },
}));
