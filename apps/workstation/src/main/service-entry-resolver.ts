import { join } from 'node:path';
import type { ServiceKind } from '../shared/service-lifecycle.js';

export const resolveServiceEntry = (
  service: ServiceKind,
): string | undefined => {
  if (
    process.env.AGENT_MUSIC_FAKE_SERVICES === '1' &&
    !(service === 'core' && process.env.AGENT_MUSIC_REAL_CORE === '1')
  )
    return join(__dirname, 'fake-service-entry.js');
  if (service === 'agent' && process.env.AGENT_MUSIC_FAKE_AGENT === '1')
    return join(__dirname, 'fake-service-entry.js');
  if (service === 'core') return join(__dirname, 'project-service-entry.js');
  return (
    process.env.AGENT_MUSIC_AGENT_ENTRY ??
    join(__dirname, 'agent-service-entry.js')
  );
};
