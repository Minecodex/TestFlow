import { getJson } from '../../shared/api/client';

export interface SystemStatus {
  service: 'testflow';
  version: string;
  architecture: 'monolith';
  database: 'configured' | 'not_configured';
  features: { id: string; state: 'planned' }[];
}

export const fetchSystemStatus = (signal?: AbortSignal) => getJson<SystemStatus>('/system/status', signal);
