import type { CorePlaybackResponse } from '../../shared/playback-bridge.js';
import { ProjectError } from './project-error.js';

/** Maps authority failures to safe renderer-facing playback failures. */
export const currentPlaybackFailure = (
  requestId: string,
  error: unknown,
): Extract<CorePlaybackResponse, { type: 'playback.failed' }> =>
  error instanceof ProjectError
    ? {
        type: 'playback.failed',
        protocolVersion: 1,
        requestId,
        code: 'CURRENT_UNAVAILABLE',
        userMessage: 'Current is unavailable for playback.',
      }
    : {
        type: 'playback.failed',
        protocolVersion: 1,
        requestId,
        code: 'COMPILATION_FAILED',
        userMessage: 'Current could not be compiled for playback.',
      };
