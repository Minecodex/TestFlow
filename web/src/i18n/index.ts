import { usePreferences } from '../shared/state/preferences';
import { commonZh, commonEn } from './common';
import { overviewZh, overviewEn } from './overview';
import { repositoriesZh, repositoriesEn } from './repositories';
import { modulesZh, modulesEn } from './modules';
import { assetsZh, assetsEn } from './assets';
import { datasetsZh, datasetsEn } from './datasets';
import { pipelinesZh, pipelinesEn } from './pipelines';
import { evaluationZh, evaluationEn } from './evaluation';
import { tasksZh, tasksEn } from './tasks';
import { executionsZh, executionsEn } from './executions';

const featureMessages = {
  repositories: { zh: repositoriesZh, en: repositoriesEn },
  modules: { zh: modulesZh, en: modulesEn },
  assets: { zh: assetsZh, en: assetsEn },
  datasets: { zh: datasetsZh, en: datasetsEn },
  pipelines: { zh: pipelinesZh, en: pipelinesEn },
  evaluation: { zh: evaluationZh, en: evaluationEn },
  tasks: { zh: tasksZh, en: tasksEn },
  executions: { zh: executionsZh, en: executionsEn },
};
export type FeatureId = keyof typeof featureMessages;

const zh = {
  common: commonZh, overview: overviewZh,
  repositories: featureMessages.repositories.zh,
  modules: featureMessages.modules.zh,
  assets: featureMessages.assets.zh,
  datasets: featureMessages.datasets.zh,
  pipelines: featureMessages.pipelines.zh,
  evaluation: featureMessages.evaluation.zh,
  tasks: featureMessages.tasks.zh,
  executions: featureMessages.executions.zh,
};
const en: typeof zh = {
  common: commonEn, overview: overviewEn,
  repositories: featureMessages.repositories.en,
  modules: featureMessages.modules.en,
  assets: featureMessages.assets.en,
  datasets: featureMessages.datasets.en,
  pipelines: featureMessages.pipelines.en,
  evaluation: featureMessages.evaluation.en,
  tasks: featureMessages.tasks.en,
  executions: featureMessages.executions.en,
};
export function useMessages() {
  return usePreferences((state) => state.locale) === 'en-US' ? en : zh;
}
