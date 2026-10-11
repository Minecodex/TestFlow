import { GitBranch, Boxes, AudioLines, Database, Workflow, ClipboardCheck, ListChecks, History, type LucideIcon } from 'lucide-react';
import type { FeatureId } from '../i18n';

export const features = [
  { id: 'repositories', path: '/repositories', icon: GitBranch },
  { id: 'modules', path: '/modules', icon: Boxes },
  { id: 'assets', path: '/assets', icon: AudioLines },
  { id: 'datasets', path: '/datasets', icon: Database },
  { id: 'pipelines', path: '/pipelines', icon: Workflow },
  { id: 'evaluation', path: '/evaluation-profiles', icon: ClipboardCheck },
  { id: 'tasks', path: '/test-tasks', icon: ListChecks },
  { id: 'executions', path: '/executions', icon: History },
] satisfies { id: FeatureId; path: string; icon: LucideIcon }[];
