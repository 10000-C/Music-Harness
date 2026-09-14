import {
  type CoreBootstrapState,
  type StructuredUiError,
} from '../src/renderer/b-contracts/index.js';
import { describe, expect, it, vi } from 'vitest';
import {
  FAKE_PROJECT_ID,
  getFakeCoreFixture,
} from '../src/renderer/core-client/index.js';
import {
  candidateAvailabilityMessage,
  currentSafetyMessage,
  restartDesktopServiceSafely,
  restartableServices,
  selectWorkstationError,
  serviceLabel,
} from '../src/renderer/workspace/workstation-alert-model.js';

const error = (
  code: string,
  overrides: Partial<StructuredUiError> = {},
): StructuredUiError => ({
  code,
  title: `${code} title`,
  message: `${code} message`,
  currentSafety: 'safe',
  candidateAvailability: 'unavailable',
  nextAction: `${code} next action`,
  ...overrides,
});

describe('workstation StructuredUiError presentation', () => {
  it('selects blocked-project, recovery, failed-task, and event-list errors', () => {
    const stable = getFakeCoreFixture('stable');
    const projectError = error('PROJECT_BLOCKED', {
      currentSafety: 'unknown',
      candidateAvailability: 'unknown',
    });
    const recoveryError = error('CURRENT_RECOVERY', {
      currentSafety: 'requiresRecovery',
      candidateAvailability: 'notApplicable',
    });
    const eventError = error('LATEST_EVENT');

    const blocked: CoreBootstrapState = {
      ...stable,
      project: {
        status: 'blocked',
        projectId: FAKE_PROJECT_ID,
        displayName: 'Blocked project',
        error: projectError,
      },
    };
    const recovery: CoreBootstrapState = {
      ...stable,
      current: {
        status: 'recoveryRequired',
        revision: null,
        error: recoveryError,
      },
    };
    const eventOnly: CoreBootstrapState = {
      ...stable,
      errors: [eventError],
    };

    expect(selectWorkstationError(blocked)).toEqual(projectError);
    expect(selectWorkstationError(recovery)).toEqual(recoveryError);
    expect(selectWorkstationError(getFakeCoreFixture('failed'))?.code).toBe(
      'AGENT_GENERATION_FAILED',
    );
    expect(selectWorkstationError(eventOnly)).toEqual(eventError);
    expect(selectWorkstationError(stable)).toBeNull();
  });

  it('projects explicit Current safety and Candidate availability messages', () => {
    expect(currentSafetyMessage('safe')).toBe('Current is safe.');
    expect(currentSafetyMessage('unknown')).toContain('could not be confirmed');
    expect(currentSafetyMessage('requiresRecovery')).toContain(
      'requires recovery',
    );
    expect(candidateAvailabilityMessage('available')).toContain(
      'remains available',
    );
    expect(candidateAvailabilityMessage('unavailable')).toBe(
      'Candidate is unavailable.',
    );
    expect(candidateAvailabilityMessage('notApplicable')).toContain(
      'does not apply',
    );
    expect(candidateAvailabilityMessage('unknown')).toContain(
      'could not be confirmed',
    );
  });
});

describe('desktop service recovery presentation', () => {
  it('selects degraded and failed services as separate restart targets', () => {
    expect(restartableServices({ core: 'degraded', agent: 'failed' })).toEqual([
      'core',
      'agent',
    ]);
    expect(restartableServices({ core: 'ready', agent: 'starting' })).toEqual(
      [],
    );
    expect(serviceLabel('core')).toBe('Core');
    expect(serviceLabel('agent')).toBe('Agent');
  });

  it('uses normalized restart failures and does not leak thrown details', async () => {
    const normalizedFailure = await restartDesktopServiceSafely(
      vi.fn().mockResolvedValue({
        ok: false,
        code: 'RESTART_FAILED',
        userMessage: 'Core could not restart. Try again.',
      }),
      'core',
    );
    const thrownFailure = await restartDesktopServiceSafely(
      vi.fn().mockRejectedValue(new Error('secret process command line')),
      'agent',
    );

    expect(normalizedFailure).toEqual({
      tone: 'error',
      message: 'Core could not restart. Try again.',
    });
    expect(thrownFailure.tone).toBe('error');
    expect(thrownFailure.message).not.toContain('secret');
    expect(thrownFailure.message).toContain('Agent');
  });
});
