import type {
  CoreBootstrapState,
  ServiceKind,
  StructuredUiError,
} from '../b-contracts/index.js';
import type { CommandResult } from '../../shared/shell-contracts.js';
import type { ServiceFleetSnapshot } from '../../shared/service-status.js';

export interface ServiceRestartFeedback {
  readonly tone: 'success' | 'error';
  readonly message: string;
}

export type RestartDesktopService = (
  service: ServiceKind,
) => Promise<CommandResult>;

export const selectWorkstationError = (
  state: CoreBootstrapState,
): StructuredUiError | null => {
  if (state.project.status === 'blocked') return state.project.error;
  if (state.current.status === 'recoveryRequired') return state.current.error;
  if (state.task.status === 'failed') return state.task.error;
  if (state.candidate.status === 'failed') return state.candidate.error;
  return state.errors.at(-1) ?? null;
};

const serviceLabels: Readonly<Record<ServiceKind, string>> = {
  core: 'Core',
  agent: 'Agent',
};

const currentSafetyMessages: Readonly<
  Record<StructuredUiError['currentSafety'], string>
> = {
  safe: 'Current is safe.',
  unknown: 'Current safety could not be confirmed.',
  requiresRecovery: 'Current requires recovery before continuing.',
};

const candidateAvailabilityMessages: Readonly<
  Record<StructuredUiError['candidateAvailability'], string>
> = {
  available: 'Candidate remains available.',
  unavailable: 'Candidate is unavailable.',
  notApplicable: 'Candidate does not apply to this operation.',
  unknown: 'Candidate availability could not be confirmed.',
};

export const serviceLabel = (service: ServiceKind): string =>
  serviceLabels[service];

export const currentSafetyMessage = (
  safety: StructuredUiError['currentSafety'],
): string => currentSafetyMessages[safety];

export const candidateAvailabilityMessage = (
  availability: StructuredUiError['candidateAvailability'],
): string => candidateAvailabilityMessages[availability];

export const restartableServices = (
  snapshot: ServiceFleetSnapshot,
): readonly ServiceKind[] =>
  (['core', 'agent'] as const).filter(
    (service) =>
      snapshot[service] === 'degraded' || snapshot[service] === 'failed',
  );

export const restartDesktopServiceSafely = async (
  restart: RestartDesktopService,
  service: ServiceKind,
): Promise<ServiceRestartFeedback> => {
  const label = serviceLabel(service);
  try {
    const result = await restart(service);
    if (result.ok) {
      return {
        tone: 'success',
        message: `${label} restart requested.`,
      };
    }
    const userMessage = result.userMessage?.trim();
    return {
      tone: 'error',
      message:
        userMessage !== undefined && userMessage.length > 0
          ? userMessage
          : `${label} could not restart. Try again.`,
    };
  } catch {
    return {
      tone: 'error',
      message: `${label} could not restart. Try again.`,
    };
  }
};
