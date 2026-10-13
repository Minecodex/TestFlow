import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Moon,
  Sun,
  Play,
  LogOut,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  NavLink,
  Outlet,
  ScrollRestoration,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { features } from "../app/features";
import { useMessages } from "../i18n";
import { usePreferences } from "../shared/state/preferences";
import {
  Action,
  Badge,
  Dialog,
  Notice,
} from "../shared/ui";
import { getJson, write } from "../shared/api/client";
import { useLive, useWrite } from "../shared/api/hooks";
import { SessionGate } from "../features/auth/page";
import { FlowIcon, GridIcon } from "../shared/icons";
function Shell() {
  const t = useMessages();
  const { locale, theme, setLocale, setTheme } = usePreferences();
  const location = useLocation();
  const navigate = useNavigate();
  const query = useQueryClient();
  useLive();
  const [overlay, setOverlay] = useState("");
  const [guide, setGuide] = useState(-1);
  const current = features.find((f) => location.pathname.startsWith(f.path));
  const overview = useQuery({
    queryKey: ["overview"],
    queryFn: () =>
      getJson<{ counts: Record<string, number> }>("/system/overview"),
  });
  const logout = useWrite(async () => {
    await write("/auth/logout");
    query.clear();
    navigate("/login");
  });
  useEffect(() => {
    const about = () => setOverlay("about");
    window.addEventListener("testflow:about", about);
    return () => {
      window.removeEventListener("testflow:about", about);
    };
  }, []);
  const guideSteps = features;
  const guideTo = (n: number) => {
    setGuide(n);
    if (guideSteps[n]) navigate(guideSteps[n].path);
  };
  return (
    <div className="testflow-workspace">
      <aside className="testflow-sidebar">
        <NavLink className="testflow-brand" to="/">
          <span className="testflow-brand-mark">
            <FlowIcon />
          </span>
          <div>
            <div className="testflow-brand-name">
              TestFlow<span>.</span>
            </div>
            <div className="testflow-tiny testflow-muted">MODULE TEST LAB</div>
          </div>
        </NavLink>
        <nav aria-label={t.common.navigation}>
          <NavLink className="testflow-nav-link" to="/" end>
            <GridIcon />
            <span>{t.overview.title}</span>
          </NavLink>
          {features.map((f, i) => (
            <div key={f.id}>
              {[0, 2, 6].includes(i) && (
                <div className="testflow-nav-label">
                  {
                    (
                      {
                        0: t.common.resourceGroup,
                        2: t.common.testingGroup,
                        6: t.common.observabilityGroup,
                      } as Record<number, string>
                    )[i]
                  }
                </div>
              )}
              <NavLink className="testflow-nav-link" to={f.path}>
                <f.icon />
                <span>{t[f.id].title}</span>
                {["repositories","modules","datasets","tasks"].includes(f.id) && overview.data?.counts[f.id] !== undefined && (
                  <span className="testflow-nav-counter">
                    {overview.data.counts[f.id]}
                  </span>
                )}
              </NavLink>
            </div>
          ))}
        </nav>
        <div className="testflow-sidebar-bottom">
          <div className="testflow-row">
            <Action className="testflow-account" variant="ghost" size="sm" action="about"
              aria-label={t.common.about} onPress={() => setOverlay("about")}>
              <span className="testflow-avatar">A</span>
              <span className="testflow-account-copy"><span>admin</span><small className="testflow-tiny testflow-muted">{t.common.adminDescription}</small></span>
            </Action>
            <Action
              size="sm"
              variant="ghost"
              isIconOnly
              aria-label={t.common.logout}
              onPress={() => logout.mutate(undefined)}
            >
              <LogOut />
            </Action>
          </div>

        </div>
      </aside>
      <div className="testflow-main">
        <header className="testflow-topbar">
          <div className="testflow-breadcrumbs">
            <strong>{current ? t[current.id].title : t.overview.title}</strong>
            <span className="testflow-breadcrumb-domain">{current?.id === "tasks" ? "TEST TASKS" : current?.id.toUpperCase() || "OVERVIEW"}</span>
          </div>
          <div className="testflow-row testflow-global-actions">
            <div className="testflow-row testflow-global-tools">
            <Action
              variant="ghost"
              size="sm"
              aria-label={t.common.language}
              onPress={() => setLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
            >
              {locale === "zh-CN" ? "EN" : "中文"}
            </Action>
            <Action
              variant="ghost"
              size="sm"
              isIconOnly
              aria-label={t.common.theme}
              onPress={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon /> : <Sun />}
            </Action>
            </div>
            <Action size="sm" action="guide" onPress={() => guideTo(0)}>
              <Play />
              {t.common.guide}
            </Action>
          </div>
        </header>
        <main className="testflow-content">
          <Outlet />
        </main>
        <ScrollRestoration getKey={(location) => location.pathname} />
      </div>
      {overlay === "about" && (
        <Dialog title={t.common.about} onClose={() => setOverlay("")}>
          <Notice>{t.common.aboutDescription}</Notice>
          <p>TestFlow v0.1 · testflow.module.v1 · testflow.ui.v1</p>
        </Dialog>
      )}
      {guide >= 0 && (
        <aside className="testflow-guide">
          <div className="testflow-eyebrow">
            {guide + 1} / 8 · {t[guideSteps[guide].id].title}
          </div>
          <p>{t[guideSteps[guide].id].description}</p>
          <div className="testflow-row">
            <Action
              size="sm"
              action="guide-prev"
              isDisabled={guide === 0}
              onPress={() => guideTo(guide - 1)}
            >
              {t.common.previous}
            </Action>
            <Action
              size="sm"
              action="guide-next"
              isDisabled={guide === 7}
              onPress={() => guideTo(guide + 1)}
            >
              {t.common.next}
            </Action>
            <Action size="sm" action="end-guide" onPress={() => setGuide(-1)}>
              {t.common.endGuide}
            </Action>
          </div>
        </aside>
      )}
    </div>
  );
}
export function WorkspaceLayout() {
  return (
    <SessionGate>
      <Shell />
    </SessionGate>
  );
}
