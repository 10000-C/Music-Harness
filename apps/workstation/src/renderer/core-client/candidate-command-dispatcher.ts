import type { CandidateCommand } from '@agent-music/contracts';
import type { DesktopBridge } from '../../shared/desktop-bridge.js';
import type { RendererCommand } from '../b-contracts/index.js';
import type { WorkstationStore } from '../state/index.js';
import { projectCandidateEvents } from './candidate-event-projection.js';

const toCandidateCommand = (
  command: RendererCommand,
  store: WorkstationStore,
): CandidateCommand | null => {
  switch (command.type) {
    case 'startTask':
      return {
        type: 'candidate.startTask',
        requestId: command.requestId,
        projectId: command.projectId,
        scope: command.scope,
      };
    case 'cancelTask': {
      const candidate = store.getState().authoritative.candidate;
      if (
        (candidate.status !== 'building' && candidate.status !== 'ready') ||
        candidate.taskId !== command.taskId
      )
        return null;
      return {
        type: 'candidate.cancelTask',
        requestId: command.requestId,
        projectId: command.projectId,
        candidateId: candidate.candidateId,
        taskId: command.taskId,
      };
    }
    case 'acceptCandidate':
      return {
        type: 'candidate.accept',
        requestId: command.requestId,
        projectId: command.projectId,
        candidateId: command.candidateId,
      };
    case 'rejectCandidate':
      return {
        type: 'candidate.reject',
        requestId: command.requestId,
        projectId: command.projectId,
        candidateId: command.candidateId,
      };
    default:
      return null;
  }
};

export interface CandidateDispatchOutcome {
  readonly handled: boolean;
  readonly currentReloadRequired: boolean;
}

/**
 * The B4 command seam that joins the desktop Candidate bridge to the B2
 * product store. Preview loading remains B3-owned, so it is intentionally not
 * translated into a Candidate command here.
 */
export const dispatchCandidateRendererCommand = async (
  bridge: Pick<DesktopBridge, 'dispatchCandidate'>,
  store: WorkstationStore,
  command: RendererCommand,
): Promise<CandidateDispatchOutcome> => {
  const candidateCommand = toCandidateCommand(command, store);
  if (candidateCommand === null) {
    return { handled: false, currentReloadRequired: false };
  }
  const result = await bridge.dispatchCandidate(candidateCommand);
  if (!result.ok) {
    throw new Error(result.userMessage);
  }
  const projection = projectCandidateEvents(
    command.projectId,
    store.getState().authoritative,
    result.events,
  );
  projection.events.forEach((event) => store.applyCoreEvent(event));
  return {
    handled: true,
    currentReloadRequired: projection.currentReloadRequired,
  };
};
