import {
  PROJECT_PPQ,
  TRACK_IDS,
  createMidiNoteNumber,
  type KeyEvent,
  type MeterEvent,
  type TempoEvent,
  type Tick,
  type TrackId,
} from '@agent-music/contracts';

import {
  audioNotesForVoice,
  keySignatureFor,
  meterFractionFor,
  type ParsedPitch,
} from './abc-parser-adapter.js';
import {
  durationSuffixForToken,
  isTieContinuation,
  spanFor,
  validateNoteItem,
  type ParsedCanonicalAbc,
} from './canonical-abc-format.js';
import type {
  AbcSpan,
  CanonicalAbcCompilation,
  DomainMusicEvent,
  DomainNoteEvent,
  DomainTrack,
} from './composition-types.js';
import { failCompositionValidation } from './composition-validation-error.js';

const TICKS_PER_WHOLE_NOTE = PROJECT_PPQ * 4;
const DEFAULT_VELOCITY = 100;

interface TrackBuildResult {
  readonly track: DomainTrack;
  readonly tempoMap: readonly TempoEvent[];
  readonly keyMap: readonly KeyEvent[];
}

const tick = (value: number): Tick => value as Tick;

const playablePitch = (value: number) => {
  try {
    return createMidiNoteNumber(value);
  } catch {
    return failCompositionValidation(
      'MIDI_NOTE_NUMBER_INVALID',
      `Playable pitch must be an integer from 0 through 127: ${String(value)}`,
    );
  }
};

const exactDurationTick = (duration: number): Tick => {
  const value = duration * TICKS_PER_WHOLE_NOTE;
  if (!Number.isInteger(value) || value <= 0) {
    return failCompositionValidation(
      'ABC_DURATION_NOT_EXACT',
      `ABC duration ${String(duration)} cannot map exactly to PPQ=${String(PROJECT_PPQ)}`,
    );
  }
  return tick(value);
};

const durationFactor = (suffix: string): number => {
  if (suffix === '') {
    return 1;
  }
  if (/^\d+$/.test(suffix)) {
    return Number(suffix);
  }
  const fraction = /^(\d*)\/(\d+)$/.exec(suffix);
  if (fraction !== null) {
    return Number(fraction[1] === '' ? '1' : fraction[1]) / Number(fraction[2]);
  }
  if (/^\/+$/u.test(suffix)) {
    return 1 / 2 ** suffix.length;
  }
  return failCompositionValidation(
    'ABC_UNSUPPORTED_SYNTAX',
    `Unsupported P0 ABC duration suffix: ${suffix}`,
  );
};

export const eventDurationTick = (
  token: string,
  defaultLength: string,
): Tick => {
  const suffix = durationSuffixForToken(token);
  const length = /^(\d+)\/(\d+)$/.exec(defaultLength);
  if (length?.[1] === undefined || length[2] === undefined) {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      'Canonical ABC has an invalid default note length',
    );
  }
  return exactDurationTick(
    (Number(length[1]) / Number(length[2])) * durationFactor(suffix),
  );
};

// TODO(A2): Resolve explicit continuation accidentals against the full
// bar accidental context instead of only the preceding tied onset.
const tieContinuationMatches = (
  previous: readonly ParsedPitch[] | undefined,
  continuation: readonly ParsedPitch[] | undefined,
): boolean => {
  if (continuation === undefined || previous?.length !== continuation.length) {
    return false;
  }

  return continuation.every((pitch, index) => {
    const preceding = previous[index];
    return (
      preceding?.pitch === pitch.pitch &&
      (pitch.accidental === undefined ||
        pitch.accidental === preceding.accidental)
    );
  });
};

const buildTrack = (
  parsed: ParsedCanonicalAbc,
  trackId: TrackId,
  voiceIndex: number,
  initialTempo: TempoEvent,
  initialKey: KeyEvent,
): TrackBuildResult => {
  const voice = parsed.voices[voiceIndex];
  const audioTrack = audioNotesForVoice(parsed, voiceIndex);
  if (voice === undefined) {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      `Missing parsed voice for ${trackId}`,
    );
  }

  const notesByStartChar = new Map<number, typeof audioTrack>();
  for (const audioItem of audioTrack) {
    if (audioItem.cmd !== 'note') {
      continue;
    }
    const current = notesByStartChar.get(audioItem.startChar) ?? [];
    notesByStartChar.set(audioItem.startChar, [...current, audioItem]);
  }

  const events: DomainMusicEvent[] = [];
  const tempoMap: TempoEvent[] = [initialTempo];
  const keyMap: KeyEvent[] = [initialKey];
  let cursor = tick(0);
  let pendingDirectiveSpans: AbcSpan[] = [];
  let previousNotePitches: readonly ParsedPitch[] | undefined;

  for (const item of voice) {
    if (item.el_type === 'tempo') {
      if (cursor === 0) {
        return failCompositionValidation(
          'INITIAL_GLOBAL_EVENT_CONFLICT',
          'Tick 0 initial Tempo must use the Q: header / updateMusicalProperties; inline [Q:] is only allowed after music has started',
        );
      }
      if (item.bpm === undefined || item.bpm <= 0) {
        return failCompositionValidation(
          'ABC_STRUCTURE_INVALID',
          `Invalid Tempo event in ${trackId}`,
        );
      }
      tempoMap.push({ tick: cursor, bpm: item.bpm });
      pendingDirectiveSpans.push(spanFor(parsed.source, item));
      continue;
    }
    if (item.el_type === 'key') {
      if (cursor === 0) {
        return failCompositionValidation(
          'INITIAL_GLOBAL_EVENT_CONFLICT',
          'Tick 0 initial Key must use the K: header; inline [K:] is only allowed after music has started',
        );
      }
      if (item.root === undefined) {
        return failCompositionValidation(
          'ABC_STRUCTURE_INVALID',
          `Invalid Key event in ${trackId}`,
        );
      }
      keyMap.push({
        tick: cursor,
        tonic: item.root,
        accidental: item.acc === '#' || item.acc === 'b' ? item.acc : '',
        mode: item.mode ?? '',
      });
      pendingDirectiveSpans.push(spanFor(parsed.source, item));
      continue;
    }
    if (item.el_type !== 'note') {
      continue;
    }

    if (typeof item.duration !== 'number') {
      return failCompositionValidation(
        'ABC_STRUCTURE_INVALID',
        `Missing duration in ${trackId}`,
      );
    }
    const token = validateNoteItem(parsed.source, item);
    const tokenDuration = eventDurationTick(token, parsed.defaultLength);
    const itemSpan = spanFor(parsed.source, item);
    const spans = [...pendingDirectiveSpans, itemSpan];
    pendingDirectiveSpans = [];

    if (item.rest !== undefined) {
      events.push({
        type: 'rest',
        trackId,
        startTick: cursor,
        durationTick: tokenDuration,
        abcSpans: spans,
      });
      previousNotePitches = undefined;
      cursor = tick(cursor + tokenDuration);
      continue;
    }

    if (isTieContinuation(item)) {
      const previous = events.at(-1);
      const continuationOnsets = notesByStartChar.get(itemSpan.startChar);
      if (
        previous?.type !== 'note' ||
        !tieContinuationMatches(previousNotePitches, item.pitches) ||
        (continuationOnsets !== undefined && continuationOnsets.length > 0)
      ) {
        return failCompositionValidation(
          'ABC_STRUCTURE_INVALID',
          `Tie continuation in ${trackId} must preserve the preceding pitch set`,
        );
      }
      const replacement: DomainNoteEvent = {
        ...previous,
        durationTick: tick(previous.durationTick + tokenDuration),
        abcSpans: [...previous.abcSpans, ...spans],
      };
      events[events.length - 1] = replacement;
      cursor = tick(cursor + tokenDuration);
      continue;
    }

    const audioNotes = notesByStartChar.get(itemSpan.startChar);
    if (audioNotes === undefined || audioNotes.length === 0) {
      return failCompositionValidation(
        'ABC_STRUCTURE_INVALID',
        `ABC audio setup did not produce pitches for ${trackId}`,
      );
    }
    const velocityDirective = parsed.velocityDirectives.get(itemSpan.startChar);
    previousNotePitches = item.pitches;
    events.push({
      type: 'note',
      trackId,
      startTick: cursor,
      durationTick: tokenDuration,
      pitches: audioNotes.map((audioNote) => playablePitch(audioNote.pitch)),
      velocity: velocityDirective?.velocity ?? DEFAULT_VELOCITY,
      abcSpans: [
        ...spans.slice(0, -1),
        ...(velocityDirective === undefined ? [] : [velocityDirective.span]),
        itemSpan,
      ],
    });
    cursor = tick(cursor + tokenDuration);
  }

  if (pendingDirectiveSpans.length > 0) {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      `Tempo or Key event in ${trackId} must be followed by music`,
    );
  }

  return {
    track: { trackId, totalTicks: cursor, events },
    tempoMap,
    keyMap,
  };
};

const sameMap = (
  left: readonly unknown[],
  right: readonly unknown[],
): boolean => JSON.stringify(left) === JSON.stringify(right);

export const buildCanonicalCompilation = (
  parsed: ParsedCanonicalAbc,
  canonicalAbc: string,
): CanonicalAbcCompilation => {
  const meter = meterFractionFor(parsed);
  const initialTempo: TempoEvent = {
    tick: tick(0),
    bpm: parsed.initialTempo,
  };
  const key = keySignatureFor(parsed);
  const initialKey: KeyEvent = {
    tick: tick(0),
    tonic: key.root,
    accidental: key.acc,
    mode: key.mode,
  };
  const meterMap: readonly MeterEvent[] = [
    {
      tick: tick(0),
      numerator: meter.num,
      denominator: meter.den ?? 1,
    },
  ];

  const builtTracks = TRACK_IDS.map((trackId, index) =>
    buildTrack(parsed, trackId, index, initialTempo, initialKey),
  );
  const totalTicks = builtTracks[0]?.track.totalTicks;
  if (
    totalTicks === undefined ||
    totalTicks === 0 ||
    builtTracks.some((built) => built.track.totalTicks !== totalTicks)
  ) {
    return failCompositionValidation(
      'TRACK_LENGTH_MISMATCH',
      'All six Canonical ABC voices must have the same non-zero totalTicks',
      {
        tracks: Object.fromEntries(
          builtTracks.map((built) => [
            built.track.trackId,
            built.track.totalTicks,
          ]),
        ),
      },
    );
  }

  const tempoMap = builtTracks[0]?.tempoMap ?? [];
  const keyMap = builtTracks[0]?.keyMap ?? [];
  if (
    builtTracks.some(
      (built) =>
        !sameMap(built.tempoMap, tempoMap) || !sameMap(built.keyMap, keyMap),
    )
  ) {
    return failCompositionValidation(
      'GLOBAL_MAP_MISMATCH',
      'Tempo and Key maps must be identical across all six voices',
    );
  }

  return {
    canonicalAbc,
    totalTicks,
    tracks: builtTracks.map((built) => built.track),
    meterMap,
    tempoMap,
    keyMap,
    validationReport: { valid: true, issues: [] },
  };
};
