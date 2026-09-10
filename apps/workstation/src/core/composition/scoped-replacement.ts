import {
  TRACK_IDS,
  type TaskScope,
  type Tick,
  type TrackId,
} from '@agent-music/contracts';

import { canonicalizeExternalAbc } from './canonical-abc.js';
import {
  compileComposition,
  type CompositionCompilation,
} from './composition-pipeline.js';
import { failCompositionValidation } from './composition-validation-error.js';
import {
  isScopeMappingCacheValid,
  queryScopeMapping,
  type ScopeMappingEntry,
} from './scope-mapping.js';

export interface TrackReplacement {
  readonly trackId: TrackId;
  readonly abc: string;
}

export interface ScopedReplacementResult {
  readonly changedTrackIds: readonly TrackId[];
  readonly compilation: CompositionCompilation;
}

interface SourceEdit {
  readonly trackId: TrackId;
  readonly startChar: number;
  readonly endChar: number;
  readonly replacement: string;
}

const entriesCoverRange = (
  entries: readonly ScopeMappingEntry[],
  startTick: Tick,
  endTick: Tick,
): boolean => {
  if (
    entries.length === 0 ||
    entries[0]?.startTick !== startTick ||
    entries.at(-1)?.endTick !== endTick
  ) {
    return false;
  }
  return entries.every(
    (entry, index) =>
      index === 0 || entries[index - 1]?.endTick === entry.startTick,
  );
};

const sourceRange = (
  entries: readonly ScopeMappingEntry[],
): { readonly startChar: number; readonly endChar: number } => {
  const spans = entries.flatMap((entry) => entry.abcSpans);
  if (spans.length === 0) {
    return failCompositionValidation(
      'SCOPE_REPLACEMENT_INVALID',
      'Scope does not map to replaceable ABC spans',
    );
  }
  return {
    startChar: Math.min(...spans.map((span) => span.startChar)),
    endChar: Math.max(...spans.map((span) => span.endChar)),
  };
};

const validateReplacements = (
  scope: TaskScope,
  replacements: readonly TrackReplacement[],
): void => {
  if (replacements.length === 0) {
    failCompositionValidation(
      'SCOPE_REPLACEMENT_INVALID',
      'At least one track replacement is required',
    );
  }

  const seen = new Set<TrackId>();
  for (const replacement of replacements) {
    if (
      seen.has(replacement.trackId) ||
      !scope.trackIds.includes(replacement.trackId) ||
      replacement.abc.trim() === '' ||
      /^\s*[A-Z]:/m.test(replacement.abc) ||
      /\[V:[^\]]+\]/.test(replacement.abc)
    ) {
      failCompositionValidation(
        'SCOPE_REPLACEMENT_INVALID',
        `Invalid or unauthorized replacement for ${replacement.trackId}`,
      );
    }
    seen.add(replacement.trackId);
  }
};

const applySourceEdits = (
  source: string,
  edits: readonly SourceEdit[],
): string => {
  let next = source;
  for (const edit of [...edits].sort(
    (left, right) => right.startChar - left.startChar,
  )) {
    next =
      next.slice(0, edit.startChar) +
      edit.replacement.trim() +
      next.slice(edit.endChar);
  }
  return next;
};

const eventFingerprint = (
  compilation: CompositionCompilation,
  trackId: TrackId,
  startTick: Tick,
  endTick: Tick,
): string => {
  const track = compilation.tracks.find(
    (candidate) => candidate.trackId === trackId,
  );
  if (track === undefined) {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      `Composition is missing ${trackId}`,
    );
  }

  return JSON.stringify(
    track.events
      .filter(
        (event) =>
          event.startTick + event.durationTick <= startTick ||
          event.startTick >= endTick,
      )
      .map((event) =>
        event.type === 'note'
          ? {
              type: event.type,
              startTick: event.startTick,
              durationTick: event.durationTick,
              pitches: event.pitches,
              velocity: event.velocity,
            }
          : {
              type: event.type,
              startTick: event.startTick,
              durationTick: event.durationTick,
            },
      ),
  );
};

const hasAllTracks = (trackIds: readonly TrackId[]): boolean =>
  trackIds.length === TRACK_IDS.length &&
  TRACK_IDS.every((trackId) => trackIds.includes(trackId));

const globalMapsChanged = (
  before: CompositionCompilation,
  after: CompositionCompilation,
): boolean =>
  JSON.stringify(before.tempoMap) !== JSON.stringify(after.tempoMap) ||
  JSON.stringify(before.keyMap) !== JSON.stringify(after.keyMap);

export const replaceScopedMusic = (
  compilation: CompositionCompilation,
  scope: TaskScope,
  replacements: readonly TrackReplacement[],
): ScopedReplacementResult => {
  validateReplacements(scope, replacements);
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
  const edits: SourceEdit[] = replacements.map((replacement) => {
    const track = query.tracks.find(
      (candidate) => candidate.trackId === replacement.trackId,
    );
    if (track === undefined) {
      return failCompositionValidation(
        'SCOPE_REPLACEMENT_INVALID',
        `Scope does not include ${replacement.trackId}`,
      );
    }
    if (track.protectedEntries.length > 0) {
      return failCompositionValidation(
        'SCOPE_CROSSES_EVENT',
        `Scope crosses a protected event in ${replacement.trackId}`,
      );
    }
    if (!entriesCoverRange(track.entries, query.startTick, query.endTick)) {
      return failCompositionValidation(
        'SCOPE_DURATION_MISMATCH',
        `Scope is not fully covered by explicit events in ${replacement.trackId}`,
      );
    }
    return {
      trackId: replacement.trackId,
      ...sourceRange(track.entries),
      replacement: replacement.abc,
    };
  });

  const editedSource = applySourceEdits(compilation.canonicalAbc, edits);
  const canonical = canonicalizeExternalAbc(editedSource);
  const next = compileComposition(canonical);

  if (
    scope.type === 'timeRange' &&
    next.totalTicks !== compilation.totalTicks
  ) {
    return failCompositionValidation(
      'SCOPE_DURATION_MISMATCH',
      'A time-range replacement must preserve composition length',
    );
  }
  if (globalMapsChanged(compilation, next) && !hasAllTracks(scope.trackIds)) {
    return failCompositionValidation(
      'SCOPE_GLOBAL_CHANGE_REQUIRES_ALL_TRACKS',
      'Tempo and Key changes require a Scope covering all six tracks',
    );
  }

  if (scope.type === 'timeRange') {
    for (const replacement of replacements) {
      if (
        eventFingerprint(
          compilation,
          replacement.trackId,
          query.startTick,
          query.endTick,
        ) !==
        eventFingerprint(
          next,
          replacement.trackId,
          query.startTick,
          query.endTick,
        )
      ) {
        return failCompositionValidation(
          'SCOPE_OUTSIDE_CHANGED',
          `Replacement changed events outside Scope in ${replacement.trackId}`,
        );
      }
    }
  }

  return {
    changedTrackIds: replacements.map((replacement) => replacement.trackId),
    compilation: next,
  };
};
