import { createHash } from 'node:crypto';

import {
  PROJECT_PPQ,
  isTaskScope,
  type KeyEvent,
  type MeterEvent,
  type TaskScope,
  type TempoEvent,
  type Tick,
  type TrackId,
} from '@agent-music/contracts';

import type { CompositionCompilation } from './composition-pipeline.js';
import type {
  AbcSpan,
  CanonicalAbcCompilation,
  DomainMusicEvent,
} from './composition-types.js';
import { failCompositionValidation } from './composition-validation-error.js';

export const SCOPE_MAPPING_PARSER_VERSION = 'abcjs@6.6.4';

export interface ScopeMappingEntry {
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly abcSpans: readonly AbcSpan[];
}

export interface ScopeMappingCache {
  readonly sourceHash: string;
  readonly parserVersion: string;
  readonly ppq: number;
  readonly tracks: Readonly<Record<TrackId, readonly ScopeMappingEntry[]>>;
}

export interface ScopeMappingTrackQuery {
  readonly trackId: TrackId;
  readonly entries: readonly ScopeMappingEntry[];
  readonly protectedEntries: readonly ScopeMappingEntry[];
}

export interface ScopeMappingQuery {
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly tracks: readonly ScopeMappingTrackQuery[];
}

export interface ProtectedScopeEvent {
  readonly type: DomainMusicEvent['type'];
  readonly startTick: Tick;
  readonly endTick: Tick;
}

export interface ScopedTrackComposition {
  readonly trackId: TrackId;
  readonly abc: string;
  readonly protectedEvents: readonly ProtectedScopeEvent[];
}

export interface ScopedCompositionContext {
  readonly meter: MeterEvent;
  readonly tempo: TempoEvent;
  readonly key: KeyEvent;
}

export interface ScopedComposition {
  readonly startTick: Tick;
  readonly endTick: Tick;
  readonly tracks: readonly ScopedTrackComposition[];
  readonly context: ScopedCompositionContext;
}

const tick = (value: number): Tick => value as Tick;

const sourceHash = (source: string): string =>
  createHash('sha256').update(source, 'utf8').digest('hex');

export const createScopeMappingCache = (
  compilation: CanonicalAbcCompilation,
): ScopeMappingCache => {
  const tracks: Record<TrackId, ScopeMappingEntry[]> = {
    'track.drums': [],
    'track.bass': [],
    'track.guitar': [],
    'track.keys': [],
    'track.strings': [],
    'track.winds': [],
  };
  for (const track of compilation.tracks) {
    tracks[track.trackId] = track.events.map((event): ScopeMappingEntry => ({
      startTick: event.startTick,
      endTick: tick(event.startTick + event.durationTick),
      abcSpans: event.abcSpans,
    }));
  }

  return {
    sourceHash: sourceHash(compilation.canonicalAbc),
    parserVersion: SCOPE_MAPPING_PARSER_VERSION,
    ppq: PROJECT_PPQ,
    tracks,
  };
};

export const isScopeMappingCacheValid = (
  cache: ScopeMappingCache,
  canonicalAbc: string,
): boolean =>
  cache.parserVersion === SCOPE_MAPPING_PARSER_VERSION &&
  cache.ppq === PROJECT_PPQ &&
  cache.sourceHash === sourceHash(canonicalAbc);

const scopeRange = (
  scope: TaskScope,
  totalTicks: Tick,
): { readonly startTick: Tick; readonly endTick: Tick } => {
  if (!isTaskScope(scope)) {
    return failCompositionValidation('SCOPE_INVALID', 'Task Scope is invalid');
  }

  const startTick = scope.type === 'wholeProject' ? tick(0) : scope.startTick;
  const endTick = scope.type === 'wholeProject' ? totalTicks : scope.endTick;
  if (endTick > totalTicks) {
    return failCompositionValidation(
      'SCOPE_INVALID',
      'Task Scope extends beyond the composition',
    );
  }
  return { startTick, endTick };
};

export const queryScopeMapping = (
  cache: ScopeMappingCache,
  scope: TaskScope,
  totalTicks: Tick,
): ScopeMappingQuery => {
  const range = scopeRange(scope, totalTicks);

  return {
    ...range,
    tracks: scope.trackIds.map((trackId) => {
      const sourceEntries = cache.tracks[trackId];
      const entries: ScopeMappingEntry[] = [];
      const protectedEntries: ScopeMappingEntry[] = [];
      for (const entry of sourceEntries) {
        const intersects =
          entry.startTick < range.endTick && entry.endTick > range.startTick;
        const contained =
          entry.startTick >= range.startTick && entry.endTick <= range.endTick;
        if (contained) {
          entries.push(entry);
        } else if (intersects) {
          protectedEntries.push(entry);
        }
      }
      return { trackId, entries, protectedEntries };
    }),
  };
};

const abcForEntries = (
  canonicalAbc: string,
  entries: readonly ScopeMappingEntry[],
): string => {
  const spans = entries.flatMap((entry) => entry.abcSpans);
  if (spans.length === 0) {
    return '';
  }
  const startChar = Math.min(...spans.map((span) => span.startChar));
  const endChar = Math.max(...spans.map((span) => span.endChar));
  return canonicalAbc.slice(startChar, endChar).trim();
};

const latestAt = <T extends { readonly tick: Tick }>(
  events: readonly T[],
  atTick: Tick,
): T => {
  const event = events.filter((candidate) => candidate.tick <= atTick).at(-1);
  if (event === undefined) {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      'Composition is missing initial musical context',
    );
  }
  return event;
};

const protectedEventsFor = (
  compilation: CompositionCompilation,
  trackId: TrackId,
  entries: readonly ScopeMappingEntry[],
): readonly ProtectedScopeEvent[] => {
  const track = compilation.tracks.find(
    (candidate) => candidate.trackId === trackId,
  );
  if (track === undefined) {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      `Composition is missing ${trackId}`,
    );
  }

  return entries.map((entry) => {
    const event = track.events.find(
      (candidate) =>
        candidate.startTick === entry.startTick &&
        candidate.startTick + candidate.durationTick === entry.endTick,
    );
    if (event === undefined) {
      return failCompositionValidation(
        'SCOPE_MAPPING_STALE',
        `Scope Mapping entry for ${trackId} has no matching domain event`,
      );
    }
    return {
      type: event.type,
      startTick: entry.startTick,
      endTick: entry.endTick,
    };
  });
};

export const getScopedComposition = (
  compilation: CompositionCompilation,
  scope: TaskScope,
): ScopedComposition => {
  if (
    !isScopeMappingCacheValid(
      compilation.scopeMapping,
      compilation.canonicalAbc,
    )
  ) {
    return failCompositionValidation(
      'SCOPE_MAPPING_STALE',
      'Scope Mapping cache does not match Canonical ABC',
    );
  }

  const query = queryScopeMapping(
    compilation.scopeMapping,
    scope,
    compilation.totalTicks,
  );
  return {
    startTick: query.startTick,
    endTick: query.endTick,
    tracks: query.tracks.map((track) => ({
      trackId: track.trackId,
      abc: abcForEntries(compilation.canonicalAbc, track.entries),
      protectedEvents: protectedEventsFor(
        compilation,
        track.trackId,
        track.protectedEntries,
      ),
    })),
    context: {
      meter: latestAt(compilation.meterMap, query.startTick),
      tempo: latestAt(compilation.tempoMap, query.startTick),
      key: latestAt(compilation.keyMap, query.startTick),
    },
  };
};
