import type {
  CoreBootstrapState,
  CoreEvent,
  ProjectId,
} from '../b-contracts/index.js';

export type CoreEventRejectionReason =
  'duplicate' | 'out-of-order' | 'old-project' | 'no-active-project';

export type CoreEventSequenceDecision =
  | { readonly accepted: true }
  | {
      readonly accepted: false;
      readonly reason: CoreEventRejectionReason;
    };

const activeProjectId = (state: CoreBootstrapState): ProjectId | null => {
  switch (state.project.status) {
    case 'open':
      return state.project.projectId;
    case 'blocked':
      return state.project.projectId;
    case 'closed':
    case 'opening':
      return null;
  }
};

const canEstablishProject = (event: CoreEvent): boolean =>
  event.type === 'bootstrapChanged' || event.type === 'projectChanged';

/**
 * Decides whether an event belongs after the current authoritative snapshot.
 * Sequence gaps are allowed because a fresh aggregate may coalesce Core events;
 * equal, older, and cross-project events are never applied.
 */
export const sequenceCoreEvent = (
  state: CoreBootstrapState,
  event: CoreEvent,
): CoreEventSequenceDecision => {
  const projectId = activeProjectId(state);

  if (projectId === null) {
    if (event.sequence === state.sequence) {
      return { accepted: false, reason: 'duplicate' };
    }

    if (event.sequence < state.sequence) {
      return { accepted: false, reason: 'out-of-order' };
    }

    return canEstablishProject(event)
      ? { accepted: true }
      : { accepted: false, reason: 'no-active-project' };
  }

  if (event.projectId !== projectId) {
    return { accepted: false, reason: 'old-project' };
  }

  if (event.sequence === state.sequence) {
    return { accepted: false, reason: 'duplicate' };
  }

  if (event.sequence < state.sequence) {
    return { accepted: false, reason: 'out-of-order' };
  }

  return { accepted: true };
};
