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

export interface MusicalPropertiesUpdate {
  readonly meter?: GlobalMeterValue;
  readonly tempo?: {
    readonly bpm: number;
  };
}

export interface MusicalPropertiesUpdateResult {
  readonly compilation: CompositionCompilation;
}

const hasAllTracks = (trackIds: readonly TrackId[]): boolean =>
  trackIds.length === TRACK_IDS.length &&
  TRACK_IDS.every((trackId) => trackIds.includes(trackId));

const eventFingerprint = (compilation: CompositionCompilation): string =>
  JSON.stringify({
    totalTicks: compilation.totalTicks,
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

const localTempoFingerprint = (compilation: CompositionCompilation): string =>
  JSON.stringify(compilation.tempoMap.slice(1));

export const updateMusicalProperties = (
  compilation: CompositionCompilation,
  scope: TaskScope,
  update: MusicalPropertiesUpdate,
): MusicalPropertiesUpdateResult => {
  if (!isTaskScope(scope)) {
    return failCompositionValidation('SCOPE_INVALID', 'Task Scope is invalid');
  }
  if (scope.type !== 'wholeProject' || !hasAllTracks(scope.trackIds)) {
    return failCompositionValidation(
      'SCOPE_GLOBAL_METER_REQUIRES_WHOLE_PROJECT',
      'Global musical property changes require a wholeProject Scope covering all six tracks',
    );
  }
  if (update.meter === undefined && update.tempo === undefined) {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      'At least one musical property must be provided',
    );
  }
  if (update.meter !== undefined && !isSupportedGlobalMeter(update.meter)) {
    return failCompositionValidation(
      'GLOBAL_METER_INVALID',
      'Global Meter must have a numerator from 1 through 255 and a power-of-two denominator from 1 through 128',
    );
  }
  if (
    update.tempo !== undefined &&
    (!Number.isInteger(update.tempo.bpm) || update.tempo.bpm <= 0)
  ) {
    return failCompositionValidation(
      'MIDI_TEMPO_INVALID',
      'Global Tempo BPM must be a positive integer',
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

  let editedSource = compilation.canonicalAbc;
  if (update.meter !== undefined) {
    editedSource = editedSource.replace(
      /^M:[^\n]+$/m,
      `M:${String(update.meter.numerator)}/${String(update.meter.denominator)}`,
    );
  }
  if (update.tempo !== undefined) {
    editedSource = editedSource.replace(
      /^Q:[^\n]+$/m,
      `Q:1/4=${String(update.tempo.bpm)}`,
    );
  }

  const next = compileComposition(canonicalizeExternalAbc(editedSource));
  if (eventFingerprint(next) !== eventFingerprint(compilation)) {
    return failCompositionValidation(
      'SCOPE_OUTSIDE_CHANGED',
      'Global musical property update changed composition events',
    );
  }
  if (
    update.tempo === undefined &&
    JSON.stringify(next.tempoMap) !== JSON.stringify(compilation.tempoMap)
  ) {
    return failCompositionValidation(
      'SCOPE_OUTSIDE_CHANGED',
      'Global musical property update changed Tempo unexpectedly',
    );
  }
  if (
    update.tempo !== undefined &&
    localTempoFingerprint(next) !== localTempoFingerprint(compilation)
  ) {
    return failCompositionValidation(
      'SCOPE_OUTSIDE_CHANGED',
      'Global Tempo update changed local Tempo events',
    );
  }
  if (
    update.meter === undefined &&
    JSON.stringify(next.meterMap) !== JSON.stringify(compilation.meterMap)
  ) {
    return failCompositionValidation(
      'SCOPE_OUTSIDE_CHANGED',
      'Global musical property update changed Meter unexpectedly',
    );
  }

  return { compilation: next };
};
