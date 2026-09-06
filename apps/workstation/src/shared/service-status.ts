export const serviceStates = [
  'stopped',
  'starting',
  'ready',
  'degraded',
  'restarting',
  'failed',
  'stopping',
] as const;

export type ServiceState = (typeof serviceStates)[number];

export interface ServiceFleetSnapshot {
  readonly core: ServiceState;
  readonly agent: ServiceState;
}

const serviceStateSet = new Set<unknown>(serviceStates);

export const isServiceFleetSnapshot = (
  value: unknown,
): value is ServiceFleetSnapshot =>
  typeof value === 'object' &&
  value !== null &&
  serviceStateSet.has((value as { core?: unknown }).core) &&
  serviceStateSet.has((value as { agent?: unknown }).agent);

export const unavailableServiceSnapshot = (): ServiceFleetSnapshot =>
  Object.freeze({ core: 'failed', agent: 'failed' });
