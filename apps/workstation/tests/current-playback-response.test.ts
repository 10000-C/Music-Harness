import { describe, expect, it } from 'vitest';
import { currentPlaybackFailure } from '../src/core/project/current-playback-response.js';
import { ProjectError } from '../src/core/project/project-error.js';

describe('Current playback Core failure boundary', () => {
  it('normalizes unavailable Current without leaking the authority error', () => {
    expect(
      currentPlaybackFailure(
        'request-1',
        new ProjectError('PROJECT_NOT_OPEN', 'private authority detail'),
      ),
    ).toEqual({
      type: 'playback.failed',
      protocolVersion: 1,
      requestId: 'request-1',
      code: 'CURRENT_UNAVAILABLE',
      userMessage: 'Current is unavailable for playback.',
    });
  });

  it('normalizes compilation errors without leaking parser detail', () => {
    expect(
      currentPlaybackFailure('request-2', new Error('private parser detail')),
    ).toMatchObject({
      code: 'COMPILATION_FAILED',
      userMessage: 'Current could not be compiled for playback.',
    });
  });
});
