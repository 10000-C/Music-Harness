import { join } from 'node:path';
import type { ServiceKind } from './b-contracts/service-lifecycle.js';

export const resolveServiceEntry = (
  service: ServiceKind,
): string | undefined => {
  if (process.env.AGENT_MUSIC_FAKE_SERVICES === '1')
    return join(__dirname, 'fake-service-entry.js');
  return process.env[
    service === 'core' ? 'AGENT_MUSIC_CORE_ENTRY' : 'AGENT_MUSIC_AGENT_ENTRY'
  ];
};
