import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Languages,
  Moon,
  Sun,
  Workflow,
  LayoutDashboard,
  Search,
  RefreshCw,
  ChevronRight,
  Box,
  ChevronDown,
  KeyRound,
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
  Choice,
  Dialog,
  Empty,
  Failure,
  Head,
  Json,
  Notice,
  Text,
} from "../shared/ui";
import { Credentials, Hide } from "../shared/ui/resources";
import { getJson, write } from "../shared/api/client";
import { useLive, useResources, useWrite } from "../shared/api/hooks";
import { SessionGate } from "../features/auth/page";
import type { Resource } from "../shared/api/types";
import { BoxIcon, FlowIcon, GridIcon } from "../shared/icons";
const routeFor = (kind: string, id: string) =>
  `/${kind === "tasks" ? "test-tasks" : kind}/${id}`;
function GlobalSearch({ onClose }: { onClose: () => void }) {
  const t = useMessages();
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const search = useQuery({
    queryKey: ["search", q],
    queryFn: () =>
      getJson<{
        items: { id: string; name: string; kind: string; version?: number }[];
      }>(`/system/search?q=${encodeURIComponent(q)}`),
    enabled: q.length > 0,
  });
  return (
    <Dialog title={t.common.search} onClose={onClose}>
      <div className="testflow-stack">
        <Text label={t.common.search} value={q} onChange={setQ} />
        <Failure error={search.error} />
        {!search.data?.items.length &&
          !features.some((f) =>
            t[f.id].title.toLowerCase().includes(q.toLowerCase()),
          ) && <Empty text={t.common.emptySearch} />}
        {features
          .filter(
            (f) => !q || t[f.id].title.toLowerCase().includes(q.toLowerCase()),
          )
          .map((f) => (
            <Action
              key={f.path}
              onPress={() => {
                navigate(f.path);
                onClose();
              }}
            >
              {t[f.id].title}
            </Action>
          ))}
        {search.data?.items.map((r) => (
          <Action
            key={r.id}
            className="testflow-search-result"
            onPress={() => {
              navigate(routeFor(r.kind, r.id));
              onClose();
            }}
          >
            <span>
              {r.name}
              <small className="testflow-muted testflow-block">
                {r.id.slice(0, 8)}
              </small>
            </span>
            <Badge>
              {
                t[
                  features.find(
                    (f) => f.path === routeFor(r.kind, "").replace(/\/$/, ""),
                  )?.id || "executions"
                ].title
              }
            </Badge>
            {r.version && `v${r.version}`}
          </Action>
        ))}
      </div>
    </Dialog>
  );
}
function Hidden({ onClose }: { onClose: () => void }) {
  const t = useMessages();
  const [kind, setKind] = useState("repositories");
  const resources = useResources<unknown>(kind, "hidden=true");
  return (
    <Dialog title={t.common.hiddenResources} onClose={onClose}>
      <div className="testflow-stack">
        <Choice
          label={t.common.fieldType}
          value={kind}
          options={features
            .filter((f) => f.id !== "executions")
            .map((f) => ({
              id: f.id === "evaluation" ? "evaluation-profiles" : f.id,
              name: t[f.id].title,
            }))}
          onChange={setKind}
        />
        <Failure error={resources.error} />
        {resources.data?.items.map((r) => (
          <div className="testflow-row testflow-between" key={r.id}>
            <span className="testflow-stack">
              <span>{r.name}</span>
              <small className="testflow-tiny testflow-muted testflow-mono">
                {r.id.slice(0, 8)}
              </small>
            </span>
            <Hide kind={kind} resource={r} />
          </div>
        ))}
        {resources.data?.items.length === 0 && <Empty text={t.common.empty} />}
      </div>
    </Dialog>
  );
}
function Shell() {
  const t = useMessages();
  const { locale, theme, setLocale, setTheme } = usePreferences();
  const location = useLocation();
  const navigate = useNavigate();
  const query = useQueryClient();
  const connected = useLive();
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
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay("search");
      }
    };
    window.addEventListener("keydown", key);
    const about = () => setOverlay("about");
    window.addEventListener("testflow:about", about);
    return () => {
      window.removeEventListener("keydown", key);
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
        <div className="testflow-workspace-box testflow-row">
          <span className="testflow-workspace-symbol">
            <BoxIcon />
          </span>
          <div className="testflow-grow">
            <strong>{t.common.workspace}</strong>
            <div className="testflow-tiny testflow-muted testflow-mono">
              testflow_platform
            </div>
          </div>
          <ChevronDown />
        </div>
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
          <Action
            variant="ghost"
            size="sm"
            action="hidden-resources"
            aria-label={t.common.hiddenResources}
            className="testflow-hidden-link"
            onPress={() => setOverlay("hidden")}
          >
            {t.common.hiddenResourcesLabel}
          </Action>
          <div className="testflow-footer-status testflow-row testflow-between">
            <span>
              <span className={`testflow-dot ${connected ? "testflow-text-green" : "testflow-recording"}`} aria-hidden="true" />{" "}
              {connected ? t.common.connected : t.common.disconnected}
            </span>
            <span className="testflow-mono">v0.1</span>
          </div>
        </div>
      </aside>
      <div className="testflow-main">
        <header className="testflow-topbar">
          <div className="testflow-breadcrumbs">
            <span>{t.common.workspaceBreadcrumb}</span>
            <ChevronRight />
            <strong>{current ? t[current.id].title : t.overview.title}</strong>
            <span className="testflow-breadcrumb-domain">{current?.id === "tasks" ? "TEST TASKS" : current?.id.toUpperCase() || "OVERVIEW"}</span>
          </div>
          <div className="testflow-row testflow-global-actions">
            <Action
              variant="ghost"
              size="sm"
              action="search"
              className="testflow-topbar-search"
              onPress={() => setOverlay("search")}
            >
              <span><Search /></span>
              <span>{t.common.search}</span>
              <kbd>Ctrl K</kbd>
            </Action>
            <div className="testflow-row testflow-global-tools">
            <Action
              variant="ghost"
              size="sm"
              action="refresh-view"
              aria-label={t.common.refresh}
              onPress={() => {
                void query.invalidateQueries();
              }}
            >
              <RefreshCw />
            </Action>
            <Action
              variant="ghost"
              size="sm"
              aria-label={t.common.credentials}
              onPress={() => setOverlay("credentials")}
            >
              <KeyRound />
            </Action>
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
      {overlay === "search" && <GlobalSearch onClose={() => setOverlay("")} />}
      {overlay === "credentials" && (
        <Credentials onClose={() => setOverlay("")} />
      )}
      {overlay === "hidden" && <Hidden onClose={() => setOverlay("")} />}
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
