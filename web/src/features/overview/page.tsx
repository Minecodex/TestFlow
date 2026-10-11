import { Button } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, CheckCircle2, CircleDashed, Layers3, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMessages } from '../../i18n';
import { features } from '../../app/features';
import { fetchSystemStatus } from './api';

export function OverviewPage() {
  const t = useMessages();
  const navigate = useNavigate();
  const status = useQuery({ queryKey: ['system', 'status'], queryFn: ({ signal }) => fetchSystemStatus(signal) });
  const connection = status.isError ? t.common.disconnected : status.data ? t.common.connected : t.common.connecting;
  return (
    <div className="testflow-page">
      <header className="testflow-page-heading"><div><h1>{t.overview.title}</h1><p>{t.overview.description}</p></div></header>
      <section className="testflow-welcome">
        <div><span className="testflow-eyebrow">TESTFLOW</span><h2>{t.overview.welcome}</h2><p>{t.overview.welcomeDescription}</p></div>
        <Layers3 className="testflow-welcome-icon" aria-hidden="true" />
      </section>
      <section className="testflow-panel" aria-labelledby="system-heading">
        <div className="testflow-panel-heading"><h2 id="system-heading">{t.overview.system}</h2><Button variant="tertiary" size="sm" onPress={() => void status.refetch()} isPending={status.isFetching}><RefreshCw aria-hidden="true" />{t.common.refresh}</Button></div>
        <div role="status" className="testflow-connection" data-state={status.isError ? 'error' : status.data ? 'ready' : 'pending'}>
          {status.data && !status.isError ? <CheckCircle2 aria-hidden="true" /> : <CircleDashed aria-hidden="true" />}{connection}
        </div>
        {status.isError && <p className="testflow-muted">{t.overview.connectionHint}</p>}
        <dl className="testflow-system-grid">
          <div><dt>{t.overview.architecture}</dt><dd>{status.data ? t.overview.monolith : '—'}</dd></div>
          <div><dt>{t.overview.version}</dt><dd>{status.data?.version ?? '—'}</dd></div>
          <div><dt>{t.overview.database}</dt><dd>{status.data ? status.data.database === 'configured' ? t.overview.configured : t.overview.notConfigured : '—'}</dd></div>
        </dl>
      </section>
      <h2 className="testflow-section-title">{t.overview.features}</h2>
      <div className="testflow-feature-grid">{features.map(({ id, path, icon: Icon }) => (
        <article className="testflow-feature-card" key={id}>
          <div className="testflow-card-top"><Icon aria-hidden="true" /><span className="testflow-status-label">{t.common.planned}</span></div>
          <h3>{t[id].title}</h3><p>{t[id].description}</p>
          <Button variant="tertiary" size="sm" onPress={() => navigate(path)}>{t.overview.next}<ArrowUpRight aria-hidden="true" /></Button>
        </article>
      ))}</div>
    </div>
  );
}
