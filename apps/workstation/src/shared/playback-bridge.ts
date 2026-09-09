import {
  isPlaybackCompilation,
  isTimelineViewModel,
  type PlaybackCompilation,
  type TimelineViewModel,
} from '@agent-music/contracts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/** Read-only B3 request. It deliberately exposes only authoritative Current. */
export type CorePlaybackRequest = Readonly<{
  type: 'playback.readCurrent';
  protocolVersion: 1;
  requestId: string;
}>;

export type CorePlaybackResponse =
  | Readonly<{
      type: 'playback.current';
      protocolVersion: 1;
      requestId: string;
      revision: string;
      compilation: PlaybackCompilation;
      timeline: TimelineViewModel;
    }>
  | Readonly<{
      type: 'playback.failed';
      protocolVersion: 1;
      requestId: string;
      code: 'CURRENT_UNAVAILABLE' | 'COMPILATION_FAILED';
      userMessage: string;
    }>;

export const isCorePlaybackRequest = (
  value: unknown,
): value is CorePlaybackRequest =>
  isRecord(value) &&
  value.type === 'playback.readCurrent' &&
  value.protocolVersion === 1 &&
  isRequestId(value.requestId) &&
  Object.keys(value).length === 3;

export const isCorePlaybackResponse = (
  value: unknown,
): value is CorePlaybackResponse =>
  isRecord(value) && value.protocolVersion === 1 && isRequestId(value.requestId)
    ? value.type === 'playback.current'
      ? typeof value.revision === 'string' &&
        value.revision.length > 0 &&
        isPlaybackCompilation(value.compilation) &&
        isTimelineViewModel(value.timeline) &&
        Object.keys(value).length === 6
      : value.type === 'playback.failed' &&
        (value.code === 'CURRENT_UNAVAILABLE' ||
          value.code === 'COMPILATION_FAILED') &&
        typeof value.userMessage === 'string' &&
        value.userMessage.length > 0 &&
        Object.keys(value).length === 5
    : false;
