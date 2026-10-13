import type { ComponentType } from "react";
import { RepoIcon, BoxIcon, AudioIcon, DatabaseIcon, FlowIcon, JudgeIcon, TaskIcon, HistoryIcon } from "../shared/icons";
import type { FeatureId } from "../i18n";

export const features = [
  { id: "repositories", path: "/repositories", icon: RepoIcon },
  { id: "modules", path: "/modules", icon: BoxIcon },
  { id: "assets", path: "/assets", icon: AudioIcon },
  { id: "datasets", path: "/datasets", icon: DatabaseIcon },
  { id: "pipelines", path: "/pipelines", icon: FlowIcon },
  { id: "evaluation", path: "/evaluation-profiles", icon: JudgeIcon },
  { id: "tasks", path: "/test-tasks", icon: TaskIcon },
  { id: "executions", path: "/executions", icon: HistoryIcon },
] satisfies { id: FeatureId; path: string; icon: ComponentType<{size?:number}> }[];
