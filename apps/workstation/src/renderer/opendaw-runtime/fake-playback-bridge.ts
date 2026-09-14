import type { ProjectId } from '@agent-music/contracts';
import type {
  CorePlaybackSnapshot,
  PlaybackSnapshotSource,
} from '../../shared/playback-bridge.js';
import type { PlaybackSnapshotResult } from '../../shared/shell-contracts.js';
import type { SourceAwarePlaybackBridge } from './source-aware-playback-adapter.js';

export interface FakePlaybackBridge extends SourceAwarePlaybackBridge {
  readonly readCalls: readonly {
    projectId: ProjectId;
    source: PlaybackSnapshotSource;
  }[];
  replaceSnapshot(snapshot: CorePlaybackSnapshot): void;
  failSource(source: PlaybackSnapshotSource): void;
}

const matches = (
  left: PlaybackSnapshotSource,
  right: PlaybackSnapshotSource,
): boolean =>
  left.kind === right.kind &&
  left.revision === right.revision &&
  (left.kind === 'current' ||
    (right.kind === 'candidate' && left.candidateId === right.candidateId));

export const createFakePlaybackBridge = (
  initialSnapshots: readonly CorePlaybackSnapshot[],
): FakePlaybackBridge => {
  const snapshots = new Map<string, CorePlaybackSnapshot>();
  const calls: { projectId: ProjectId; source: PlaybackSnapshotSource }[] = [];
  const keyFor = (
    projectId: ProjectId,
    source: PlaybackSnapshotSource,
  ): string =>
    `${projectId}:${source.kind}:${source.revision}:${source.kind === 'candidate' ? source.candidateId : ''}`;
  for (const snapshot of initialSnapshots) {
    snapshots.set(keyFor(snapshot.projectId, snapshot.source), snapshot);
  }

  return {
    get readCalls() {
      return calls;
    },
    readPlaybackSnapshot: async (
      projectId: ProjectId,
      source: PlaybackSnapshotSource,
    ): Promise<PlaybackSnapshotResult> => {
      calls.push({ projectId, source });
      const snapshot = snapshots.get(keyFor(projectId, source));
      return snapshot === undefined
        ? {
            ok: false,
            code:
              source.kind === 'current'
                ? 'CURRENT_UNAVAILABLE'
                : 'CANDIDATE_UNAVAILABLE',
            userMessage: 'The requested playback snapshot is unavailable.',
          }
        : { ok: true, snapshot: structuredClone(snapshot) };
    },
    replaceSnapshot(snapshot) {
      snapshots.set(keyFor(snapshot.projectId, snapshot.source), snapshot);
    },
    failSource(source) {
      for (const [key, snapshot] of snapshots) {
        if (matches(snapshot.source, source)) snapshots.delete(key);
      }
    },
  };
};
