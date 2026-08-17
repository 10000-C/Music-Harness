import {
  TRACK_IDS,
  isTaskScope,
  type TaskScope,
  type TrackId,
} from '@agent-music/contracts';

import { canonicalizeExternalAbc } from './canonical-abc.js';
import {
  compileComposition,
  type CompositionCompilation,
} from './composition-pipeline.js';
import { failCompositionValidation } from './composition-validation-error.js';
import {
  isSupportedGlobalMeter,
  type GlobalMeterValue,
} from './meter-policy.js';
import { isScopeMappingCacheValid } from './scope-mapping.js';

export interface GlobalMeterUpdateResult {
  readonly compilation: CompositionCompilation;
}

const hasAllTracks = (trackIds: readonly TrackId[]): boolean =>
  trackIds.length === TRACK_IDS.length &&
  TRACK_IDS.every((trackId) => trackIds.includes(trackId));

const musicFingerprint = (compilation: CompositionCompilation): string =>
  JSON.stringify({
    totalTicks: compilation.totalTicks,
    tempoMap: compilation.tempoMap,
    keyMap: compilation.keyMap,
    tracks: compilation.tracks.map((track) => ({
      trackId: track.trackId,
      totalTicks: track.totalTicks,
      events: track.events.map((event) =>
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
    })),
  });

export const updateGlobalMeter = (
  compilation: CompositionCompilation,
  scope: TaskScope,
  meter: GlobalMeterValue,
): GlobalMeterUpdateResult => {
  if (!isTaskScope(scope)) {
    return failCompositionValidation('SCOPE_INVALID', 'Task Scope is invalid');
  }
  if (scope.type !== 'wholeProject' || !hasAllTracks(scope.trackIds)) {
    return failCompositionValidation(
      'SCOPE_GLOBAL_METER_REQUIRES_WHOLE_PROJECT',
      'Global Meter changes require a wholeProject Scope covering all six tracks',
    );
  }
  if (!isSupportedGlobalMeter(meter)) {
    return failCompositionValidation(
      'GLOBAL_METER_INVALID',
      'Global Meter must have a numerator from 1 through 255 and a power-of-two denominator from 1 through 128',
    );
  }
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

  const editedSource = compilation.canonicalAbc.replace(
    /^M:[^\n]+$/m,
    `M:${String(meter.numerator)}/${String(meter.denominator)}`,
  );
  const next = compileComposition(canonicalizeExternalAbc(editedSource));
  const beforeFingerprint = musicFingerprint(compilation);
  const nextFingerprint = musicFingerprint(next);
  if (nextFingerprint !== beforeFingerprint) {
    return failCompositionValidation(
      'SCOPE_OUTSIDE_CHANGED',
      'Global Meter update changed non-Meter composition events',
    );
  }

  return { compilation: next };
};
