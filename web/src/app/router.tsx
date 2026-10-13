import { createBrowserRouter } from "react-router-dom";
import { WorkspaceLayout } from "../layouts/workspace-layout";
import { OverviewPage } from "../features/overview/page";
import { LoginPage } from "../features/auth/page";
import { NotFoundPage } from "../shared/components/not-found-page";
import { RouteError } from "../shared/components/route-error";

export const router = createBrowserRouter([
  { path: "/login", Component: LoginPage, ErrorBoundary: RouteError },
  {
    path: "/",
    Component: WorkspaceLayout,
    ErrorBoundary: RouteError,
    HydrateFallback: () => null,
    children: [
      { index: true, Component: OverviewPage },
      {
        path: "repositories",
        lazy: async () => ({
          Component: (await import("../features/repositories/page"))
            .RepositoriesPage,
        }),
      },
      {
        path: "repositories/:id",
        lazy: async () => ({
          Component: (await import("../features/repositories/page"))
            .RepositoriesPage,
        }),
      },
      {
        path: "modules",
        lazy: async () => ({
          Component: (await import("../features/modules/page")).ModulesPage,
        }),
      },
      {
        path: "modules/:id",
        lazy: async () => ({
          Component: (await import("../features/modules/page")).ModulesPage,
        }),
      },
      {
        path: "assets",
        lazy: async () => ({
          Component: (await import("../features/assets/page")).AssetsPage,
        }),
      },
      {
        path: "assets/:id",
        lazy: async () => ({
          Component: (await import("../features/assets/page")).AssetsPage,
        }),
      },
      {
        path: "datasets",
        lazy: async () => ({
          Component: (await import("../features/datasets/page")).DatasetsPage,
        }),
      },
      {
        path: "datasets/:id",
        lazy: async () => ({
          Component: (await import("../features/datasets/page")).DatasetsPage,
        }),
      },
      {
        path: "pipelines",
        lazy: async () => ({
          Component: (await import("../features/pipelines/page")).PipelinesPage,
        }),
      },
      {
        path: "pipelines/:id",
        lazy: async () => ({
          Component: (await import("../features/pipelines/page")).PipelinesPage,
        }),
      },
      {
        path: "evaluation-profiles",
        lazy: async () => ({
          Component: (await import("../features/evaluation/page"))
            .EvaluationPage,
        }),
      },
      {
        path: "evaluation-profiles/:id",
        lazy: async () => ({
          Component: (await import("../features/evaluation/page"))
            .EvaluationPage,
        }),
      },
      {
        path: "test-tasks",
        lazy: async () => ({
          Component: (await import("../features/tasks/page")).TasksPage,
        }),
      },
      {
        path: "test-tasks/:id",
        lazy: async () => ({
          Component: (await import("../features/tasks/page")).TasksPage,
        }),
      },
      {
        path: "executions",
        lazy: async () => ({
          Component: (await import("../features/executions/page"))
            .ExecutionsPage,
        }),
      },
      {
        path: "executions/:id",
        lazy: async () => ({
          Component: (await import("../features/executions/page"))
            .ExecutionsPage,
        }),
      },
      { path: "*", Component: NotFoundPage },
    ],
  },
]);
