import type { TaskScope, TickRange } from '@agent-music/contracts';
import type { RendererTimelineViewModel as TimelineViewModel } from '../b-contracts/index.js';
import { formatBarRange } from './timeline/timeline-labels.js';

export const formatScope = (
  scope: TaskScope,
  timeline: TimelineViewModel | null,
): { label: string; tracks: string } => {
  const formatRange = (range: TickRange) =>
    timeline !== null
      ? formatBarRange(range, timeline)
      : `Ticks ${range.startTick}–${range.endTick}`;

  const label =
    scope.type === 'wholeProject' ? '全工程 (Whole Project)' : formatRange(scope);
  const tracks =
    scope.trackIds.length === 0
      ? 'All tracks'
      : scope.trackIds.join(', ');

  return { label, tracks };
};
