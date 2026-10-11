import { Button } from '@heroui/react';
import { Languages, Moon, Sun, Workflow, LayoutDashboard } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { features } from '../app/features';
import { useMessages } from '../i18n';
import { usePreferences } from '../shared/state/preferences';

export function WorkspaceLayout() {
  const t = useMessages();
  const { locale, theme, setLocale, setTheme } = usePreferences();
  return <div className="testflow-workspace">
    <aside className="testflow-sidebar">
      <NavLink className="testflow-brand" to="/"><span><Workflow aria-hidden="true" /></span>TestFlow<span className="testflow-brand-dot">.</span></NavLink>
      <div className="testflow-workspace-label">{t.common.workspace}</div>
      <nav aria-label={t.common.navigation}>
        <NavLink className="testflow-nav-link" to="/" end><LayoutDashboard aria-hidden="true" />{t.overview.title}</NavLink>
        {features.map(({ id, path, icon: Icon }) => <NavLink className="testflow-nav-link" key={id} to={path}><Icon aria-hidden="true" />{t[id].title}</NavLink>)}
      </nav>
      <span className="testflow-sidebar-note">{t.common.foundation} · v0.1</span>
    </aside>
    <div className="testflow-main">
      <header className="testflow-topbar"><span>{t.common.workspace}</span><div className="testflow-preferences">
        <Button variant="tertiary" size="sm" aria-label={t.common.language} onPress={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}><Languages aria-hidden="true" />{locale === 'zh-CN' ? 'EN' : '中文'}</Button>
        <Button variant="tertiary" size="sm" isIconOnly aria-label={t.common.theme} onPress={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}</Button>
      </div></header>
      <main className="testflow-content"><Outlet /></main>
    </div>
  </div>;
}
