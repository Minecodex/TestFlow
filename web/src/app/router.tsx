import { createBrowserRouter } from 'react-router-dom';
import { WorkspaceLayout } from '../layouts/workspace-layout';
import { OverviewPage } from '../features/overview/page';
import { NotFoundPage } from '../shared/components/not-found-page';

export const router = createBrowserRouter([
  { path: '/', Component: WorkspaceLayout, children: [
    { index: true, Component: OverviewPage },
    { path: 'repositories', lazy: async () => ({ Component: (await import('../features/repositories/page')).RepositoriesPage }) },
    { path: 'modules', lazy: async () => ({ Component: (await import('../features/modules/page')).ModulesPage }) },
    { path: 'assets', lazy: async () => ({ Component: (await import('../features/assets/page')).AssetsPage }) },
    { path: 'datasets', lazy: async () => ({ Component: (await import('../features/datasets/page')).DatasetsPage }) },
    { path: 'pipelines', lazy: async () => ({ Component: (await import('../features/pipelines/page')).PipelinesPage }) },
    { path: 'evaluation-profiles', lazy: async () => ({ Component: (await import('../features/evaluation/page')).EvaluationPage }) },
    { path: 'test-tasks', lazy: async () => ({ Component: (await import('../features/tasks/page')).TasksPage }) },
    { path: 'executions', lazy: async () => ({ Component: (await import('../features/executions/page')).ExecutionsPage }) },
    { path: '*', Component: NotFoundPage },
  ] },
]);
