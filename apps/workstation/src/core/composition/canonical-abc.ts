import { TRACK_IDS, type Tick, type TrackId } from '@agent-music/contracts';

import {
  createInitialCanonicalAbcSource,
  parseCanonicalAbc,
  serializeCanonicalAbc,
  validateNoteItem,
} from './canonical-abc-format.js';
import {
  buildCanonicalCompilation,
  eventDurationTick,
} from './composition-domain-builder.js';
import type { CanonicalAbcCompilation } from './composition-types.js';
import { failCompositionValidation } from './composition-validation-error.js';
import type { GlobalMeterValue } from './meter-policy.js';

const tick = (value: number): Tick => value as Tick;

export const canonicalizeExternalAbc = (source: string): string => {
  const parsed = parseCanonicalAbc(source);
  const canonical = serializeCanonicalAbc(parsed);

  const verification = parseCanonicalAbc(canonical);
  if (verification.hasRepeat) {
    return failCompositionValidation(
      'ABC_REPEAT_EXPANSION_FAILED',
      'Canonical serializer left repeat markers in the output',
    );
  }
  return canonical;
};

export const compileCanonicalAbc = (
  source: string,
): CanonicalAbcCompilation => {
  const canonical = canonicalizeExternalAbc(source);
  if (source !== canonical) {
    return failCompositionValidation(
      'ABC_NOT_CANONICAL',
      'compileCanonicalAbc accepts only normalized, repeat-free Canonical ABC',
    );
  }

  return buildCanonicalCompilation(parseCanonicalAbc(canonical), canonical);
};

export interface CanonicalBarlineTrack {
  readonly trackId: TrackId;
  readonly totalTicks: Tick;
  readonly barlineTicks: readonly Tick[];
}

export interface CanonicalMeterStructure {
  readonly meter: GlobalMeterValue;
  readonly tracks: readonly CanonicalBarlineTrack[];
}

export const readCanonicalMeterStructure = (
  source: string,
): CanonicalMeterStructure => {
  const parsed = parseCanonicalAbc(source);
  const tracks = TRACK_IDS.map((trackId, voiceIndex) => {
    const voice = parsed.voices[voiceIndex];
    if (voice === undefined) {
      return failCompositionValidation(
        'ABC_STRUCTURE_INVALID',
        `Missing parsed voice for ${trackId}`,
      );
    }

    let cursor = tick(0);
    const barlineTicks: Tick[] = [];
    for (const item of voice) {
      if (item.el_type === 'note') {
        if (typeof item.duration !== 'number') {
          return failCompositionValidation(
            'ABC_STRUCTURE_INVALID',
            `Missing duration in ${trackId}`,
          );
        }
        const token = validateNoteItem(parsed.source, item);
        cursor = tick(cursor + eventDurationTick(token, parsed.defaultLength));
      } else if (item.el_type === 'bar') {
        barlineTicks.push(cursor);
      }
    }

    return { trackId, totalTicks: cursor, barlineTicks };
  });

  return { meter: parsed.meterValue, tracks };
};

export const createInitialCanonicalAbc = (): string =>
  createInitialCanonicalAbcSource();
