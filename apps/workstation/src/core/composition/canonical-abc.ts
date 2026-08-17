import ABCJS from 'abcjs';
import type { AudioTrackNoteItem, TuneObject } from 'abcjs';

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

import type {
  AbcSpan,
  CanonicalAbcCompilation,
  DomainMusicEvent,
  DomainNoteEvent,
  DomainTrack,
} from './composition-types.js';
import { failCompositionValidation } from './composition-validation-error.js';
import {
  isSupportedGlobalMeter,
  type GlobalMeterValue,
} from './meter-policy.js';

const TICKS_PER_WHOLE_NOTE = PROJECT_PPQ * 4;
const DEFAULT_VELOCITY = 100;

const NOTE_DURATION = String.raw`(?:\d+(?:\/\d+)?|\/\d+|\/+)`;
const PITCH = String.raw`(?:[_^=]?[A-Ga-g][,']*)`;
const NOTE_TOKEN = new RegExp(
  `^${PITCH}(?:${NOTE_DURATION})?-$|^${PITCH}(?:${NOTE_DURATION})?$`,
);
const CHORD_TOKEN = new RegExp(
  `^\\[(?:${PITCH})+\\](?:${NOTE_DURATION})?-$|^\\[(?:${PITCH})+\\](?:${NOTE_DURATION})?$`,
);
const REST_TOKEN = new RegExp(`^z(?:${NOTE_DURATION})?$`);
const REPEAT_MARKER = /\|:|:\||\|[1-9]|\[[1-9]/;
const INLINE_INSTRUCTION = /\[I:[^\]\n]*\]/g;
const VELOCITY_INSTRUCTION = /^\[I:MIDI vol ([1-9]|[1-9]\d|1[01]\d|12[0-7])\]$/;

interface ParsedPitch {
  readonly accidental?: string;
  readonly endTie?: boolean;
  readonly pitch: number;
  readonly startTie?: object;
}

interface ParsedVoiceItem {
  readonly el_type: string;
  readonly cmd?: string;
  readonly params?: readonly unknown[];
  readonly startChar?: number;
  readonly endChar?: number;
  readonly duration?: number | readonly number[];
  readonly pitches?: readonly ParsedPitch[];
  readonly rest?: { readonly type: string };
  readonly bpm?: number;
  readonly root?: string;
  readonly acc?: string;
  readonly mode?: string;
  readonly decoration?: readonly unknown[];
  readonly gracenotes?: readonly unknown[];
  readonly chord?: readonly unknown[];
  readonly startTriplet?: number;
  readonly endTriplet?: boolean;
  readonly startSlur?: readonly unknown[];
  readonly endSlur?: readonly unknown[];
}

interface SequenceItem {
  readonly el_type: string;
  readonly volume?: number;
  readonly elem?: {
    readonly startChar?: number;
    readonly endChar?: number;
  };
}

interface ParsedContainer {
  readonly source: string;
  readonly title: string;
  readonly meter: string;
  readonly meterValue: GlobalMeterValue;
  readonly defaultLength: string;
  readonly initialTempo: number;
  readonly initialKey: string;
  readonly tune: TuneObject;
  readonly voices: readonly (readonly ParsedVoiceItem[])[];
  readonly velocityDirectives: ReadonlyMap<number, VelocityDirective>;
  readonly hasRepeat: boolean;
}

interface VelocityDirective {
  readonly velocity: number;
  readonly span: AbcSpan;
}

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

const normalizeLineEndings = (source: string): string =>
  source.replace(/\r\n?/g, '\n');

const headerValues = (source: string, name: string): string[] =>
  source
    .split('\n')
    .filter((line) => line.startsWith(`${name}:`))
    .map((line) => line.slice(2).trim());

const oneHeader = (source: string, name: string): string => {
  const values = headerValues(source, name);
  if (values.length !== 1 || values[0] === undefined || values[0] === '') {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      `Canonical ABC requires exactly one ${name}: header`,
    );
  }
  return values[0];
};

const validateContainerShape = (source: string): void => {
  if (oneHeader(source, 'X') !== '1') {
    failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      'Canonical ABC requires X:1',
    );
  }

  const declaredVoices = headerValues(source, 'V');
  if (
    declaredVoices.length !== TRACK_IDS.length ||
    !TRACK_IDS.every((trackId, index) => declaredVoices[index] === trackId)
  ) {
    failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      'Canonical ABC must declare the six fixed voices exactly once and in order',
    );
  }

  const bodyVoices = [...source.matchAll(/\[V:([^\]]+)\]/g)].map(
    (match) => match[1],
  );
  if (
    bodyVoices.length !== TRACK_IDS.length ||
    !TRACK_IDS.every((trackId, index) => bodyVoices[index] === trackId)
  ) {
    failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      'Canonical ABC must contain one body for each fixed voice in order',
    );
  }
};

const validateHeaders = (
  source: string,
): {
  readonly title: string;
  readonly meter: string;
  readonly meterValue: GlobalMeterValue;
  readonly defaultLength: string;
  readonly initialTempo: number;
  readonly initialKey: string;
} => {
  const title =
    headerValues(source, 'T')[0]?.replace(/\s+/g, ' ').trim() ?? 'Untitled';
  const meter = oneHeader(source, 'M');
  const defaultLength = oneHeader(source, 'L');
  const tempo = oneHeader(source, 'Q');
  const initialKey = oneHeader(source, 'K').replace(/\s+/g, '');

  const meterMatch = /^(\d+)\/(\d+)$/.exec(meter);
  const lengthMatch = /^(\d+)\/(\d+)$/.exec(defaultLength);
  const tempoMatch = /^1\/4=(\d+)$/.exec(tempo);
  const initialTempo = tempoMatch === null ? 0 : Number(tempoMatch[1]);
  const meterValue: GlobalMeterValue = {
    numerator: Number(meterMatch?.[1]),
    denominator: Number(meterMatch?.[2]),
  };
  if (
    meterMatch === null ||
    lengthMatch === null ||
    tempoMatch === null ||
    !isSupportedGlobalMeter(meterValue) ||
    Number(lengthMatch[1]) <= 0 ||
    Number(lengthMatch[2]) <= 0 ||
    initialTempo <= 0 ||
    initialKey === ''
  ) {
    failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      'M, L, Q, and K headers must use supported canonical forms',
    );
  }

  return {
    title,
    meter,
    meterValue,
    defaultLength,
    initialTempo,
    initialKey,
  };
};

const collectVoices = (tune: TuneObject): readonly ParsedVoiceItem[][] => {
  const voices = TRACK_IDS.map(() => [] as ParsedVoiceItem[]);

  for (const line of tune.lines) {
    const lineVoices = (line.staff ?? []).flatMap(
      (staff) => staff.voices ?? [],
    );
    if (lineVoices.length > TRACK_IDS.length) {
      failCompositionValidation(
        'ABC_STRUCTURE_INVALID',
        'Each product track must contain exactly one ABC voice',
      );
    }
    lineVoices.forEach((voice, index) => {
      voices[index]?.push(...(voice as readonly ParsedVoiceItem[]));
    });
  }

  if (voices.some((voice) => voice.length === 0)) {
    failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      'All six fixed voices must contain music or explicit rests',
    );
  }

  return voices;
};

const isTieContinuation = (item: ParsedVoiceItem): boolean =>
  item.pitches !== undefined &&
  item.pitches.length > 0 &&
  item.pitches.every((pitch) => pitch.endTie === true);

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

const collectVelocityDirectives = (
  source: string,
  voices: readonly (readonly ParsedVoiceItem[])[],
): ReadonlyMap<number, VelocityDirective> => {
  if (/%%MIDI\b/.test(source)) {
    return failCompositionValidation(
      'ABC_UNSUPPORTED_SYNTAX',
      'Velocity must use the canonical inline [I:MIDI vol N] form',
    );
  }

  const notesByStartChar = new Map<number, ParsedVoiceItem>();
  for (const item of voices.flat()) {
    if (item.el_type === 'note' && item.startChar !== undefined) {
      notesByStartChar.set(item.startChar, item);
    }
  }

  const directives = new Map<number, VelocityDirective>();
  for (const match of source.matchAll(INLINE_INSTRUCTION)) {
    const token = match[0];
    const startChar = match.index;
    const velocityMatch = VELOCITY_INSTRUCTION.exec(token);
    if (velocityMatch?.[1] === undefined) {
      return failCompositionValidation(
        'ABC_UNSUPPORTED_SYNTAX',
        `Unsupported or invalid P0 ABC instruction: ${token}`,
      );
    }

    const endChar = startChar + token.length;
    let tokenStartChar = endChar;
    while (/\s/.test(source[tokenStartChar] ?? '')) {
      tokenStartChar += 1;
    }
    const note =
      notesByStartChar.get(endChar) ?? notesByStartChar.get(tokenStartChar);
    const noteStartChar = note?.startChar;
    if (
      note === undefined ||
      noteStartChar === undefined ||
      note.rest !== undefined ||
      isTieContinuation(note) ||
      directives.has(noteStartChar)
    ) {
      return failCompositionValidation(
        'ABC_UNSUPPORTED_SYNTAX',
        'Velocity must bind to exactly one following Note or Chord onset',
      );
    }

    directives.set(noteStartChar, {
      velocity: Number(velocityMatch[1]),
      span: { startChar, endChar },
    });
  }
  const parsedVelocityCount = voices
    .flat()
    .filter((item) => item.el_type === 'midi').length;
  if (parsedVelocityCount !== directives.size) {
    return failCompositionValidation(
      'ABC_UNSUPPORTED_SYNTAX',
      'Velocity must use the canonical inline [I:MIDI vol N] form',
    );
  }
  return directives;
};

const parseContainer = (rawSource: string): ParsedContainer => {
  const source = normalizeLineEndings(rawSource).trimEnd() + '\n';
  validateContainerShape(source);
  const headers = validateHeaders(source);

  let tunes: readonly TuneObject[];
  try {
    tunes = ABCJS.parseOnly(source, { add_classes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failCompositionValidation(
      'ABC_PARSE_FAILED',
      `ABC parser failed: ${message}`,
    );
  }

  const tune = tunes[0];
  if (tunes.length !== 1 || tune === undefined) {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      'Canonical ABC must contain exactly one tune',
    );
  }
  if (tune.warnings !== undefined && tune.warnings.length > 0) {
    return failCompositionValidation(
      'ABC_PARSER_WARNING',
      `ABC parser warning: ${tune.warnings.join('; ')}`,
    );
  }

  const voices = collectVoices(tune);
  return {
    source,
    ...headers,
    tune,
    voices,
    velocityDirectives: collectVelocityDirectives(source, voices),
    hasRepeat: REPEAT_MARKER.test(source),
  };
};

const spanFor = (
  source: string,
  item: { readonly startChar?: number; readonly endChar?: number },
): AbcSpan => {
  const { startChar, endChar } = item;
  if (
    startChar === undefined ||
    endChar === undefined ||
    startChar < 0 ||
    endChar <= startChar ||
    endChar > source.length
  ) {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      'ABC parser did not return a stable source span',
    );
  }
  return { startChar, endChar };
};

const tokenFor = (
  source: string,
  item: { readonly startChar?: number; readonly endChar?: number },
): string => {
  const span = spanFor(source, item);
  return source.slice(span.startChar, span.endChar).trim();
};

const validateNoteItem = (source: string, item: ParsedVoiceItem): string => {
  const token = tokenFor(source, item);
  if (
    item.startTriplet !== undefined ||
    item.endTriplet === true ||
    item.gracenotes !== undefined ||
    item.decoration !== undefined ||
    item.chord !== undefined ||
    item.startSlur !== undefined ||
    item.endSlur !== undefined ||
    /[<>{}()!+]/.test(token)
  ) {
    return failCompositionValidation(
      'ABC_UNSUPPORTED_SYNTAX',
      `Unsupported P0 ABC syntax in token: ${token}`,
    );
  }

  const supported =
    item.rest !== undefined
      ? item.rest.type === 'rest' || item.rest.type === 'whole'
        ? REST_TOKEN.test(token)
        : false
      : NOTE_TOKEN.test(token) || CHORD_TOKEN.test(token);
  if (!supported) {
    return failCompositionValidation(
      'ABC_UNSUPPORTED_SYNTAX',
      `Unsupported P0 ABC token: ${token}`,
    );
  }

  if (item.pitches !== undefined && item.pitches.length > 1) {
    const tieStates = new Set(
      item.pitches.map(
        (pitch) =>
          (pitch.startTie === undefined ? 0 : 2) +
          (pitch.endTie === true ? 1 : 0),
      ),
    );
    if (tieStates.size !== 1) {
      return failCompositionValidation(
        'ABC_UNSUPPORTED_SYNTAX',
        'P0 chords require every pitch to share the same tie state',
      );
    }
  }

  return token;
};

const localDirectiveToken = (source: string, item: ParsedVoiceItem): string => {
  if (item.el_type === 'tempo' && item.bpm !== undefined) {
    return `[Q:1/4=${String(item.bpm)}]`;
  }
  if (item.el_type === 'key' && item.root !== undefined) {
    return `[K:${item.root}${item.acc ?? ''}${item.mode ?? ''}]`;
  }
  return failCompositionValidation(
    'ABC_UNSUPPORTED_SYNTAX',
    `Unsupported P0 ABC directive: ${tokenFor(source, item)}`,
  );
};

const velocityDirectiveToken = (item: ParsedVoiceItem): string => {
  const velocity = item.params?.[0];
  if (
    item.el_type !== 'midi' ||
    item.cmd !== 'vol' ||
    typeof velocity !== 'number' ||
    !Number.isInteger(velocity) ||
    velocity < 1 ||
    velocity > 127
  ) {
    return failCompositionValidation(
      'ABC_UNSUPPORTED_SYNTAX',
      'Only integer [I:MIDI vol N] instructions from 1 through 127 are supported',
    );
  }
  return `[I:MIDI vol ${String(velocity)}]`;
};

const serializeParsedVoice = (
  source: string,
  voice: readonly ParsedVoiceItem[],
): string => {
  const tokens: string[] = [];
  let velocityPending = false;

  for (const item of voice) {
    switch (item.el_type) {
      case 'midi':
        if (velocityPending) {
          return failCompositionValidation(
            'ABC_UNSUPPORTED_SYNTAX',
            'A Velocity instruction cannot overwrite another instruction',
          );
        }
        tokens.push(velocityDirectiveToken(item));
        velocityPending = true;
        break;
      case 'note':
        if (
          velocityPending &&
          (item.rest !== undefined || isTieContinuation(item))
        ) {
          return failCompositionValidation(
            'ABC_UNSUPPORTED_SYNTAX',
            'Velocity must bind to a Note or Chord onset',
          );
        }
        tokens.push(validateNoteItem(source, item));
        velocityPending = false;
        break;
      case 'bar':
        if (velocityPending) {
          return failCompositionValidation(
            'ABC_UNSUPPORTED_SYNTAX',
            'A Velocity instruction cannot cross a bar',
          );
        }
        tokens.push('|');
        break;
      case 'tempo':
      case 'key':
        if (velocityPending) {
          return failCompositionValidation(
            'ABC_UNSUPPORTED_SYNTAX',
            'A Velocity instruction cannot cross a global directive',
          );
        }
        tokens.push(localDirectiveToken(source, item));
        break;
      default:
        return failCompositionValidation(
          'ABC_UNSUPPORTED_SYNTAX',
          `Unsupported P0 ABC element: ${item.el_type}`,
        );
    }
  }

  if (velocityPending) {
    return failCompositionValidation(
      'ABC_UNSUPPORTED_SYNTAX',
      'A Velocity instruction cannot be left dangling',
    );
  }
  return tokens.join(' ');
};

const serializeRepeatedVoices = (
  parsed: ParsedContainer,
): readonly string[] => {
  if (
    parsed.voices.some((voice) =>
      voice.some((item) => item.el_type === 'tempo' || item.el_type === 'key'),
    )
  ) {
    return failCompositionValidation(
      'ABC_REPEAT_EXPANSION_FAILED',
      'Repeat expansion with local Tempo or Key events is not supported',
    );
  }

  const sequence = ABCJS.synth.sequence(
    parsed.tune,
    {},
  ) as unknown as readonly (readonly SequenceItem[])[];
  if (sequence.length !== TRACK_IDS.length) {
    return failCompositionValidation(
      'ABC_REPEAT_EXPANSION_FAILED',
      'Repeat expansion did not preserve the six fixed voices',
    );
  }

  return sequence.map((voice) => {
    const tokens: string[] = [];
    let pendingVelocity: number | undefined;
    for (const item of voice) {
      if (
        item.el_type === 'vol' &&
        item.volume !== undefined &&
        Number.isInteger(item.volume) &&
        item.volume >= 0 &&
        item.volume <= 127 &&
        pendingVelocity === undefined
      ) {
        pendingVelocity = item.volume;
      } else if (item.el_type === 'note' && item.elem !== undefined) {
        const note = item.elem as ParsedVoiceItem;
        if (
          pendingVelocity !== undefined &&
          (note.rest !== undefined || isTieContinuation(note))
        ) {
          return failCompositionValidation(
            'ABC_REPEAT_EXPANSION_FAILED',
            'Repeat expansion produced an invalid Velocity target',
          );
        }
        if (pendingVelocity !== undefined) {
          tokens.push(`[I:MIDI vol ${String(pendingVelocity)}]`);
        }
        tokens.push(validateNoteItem(parsed.source, note));
        pendingVelocity = undefined;
      } else if (item.el_type === 'bar') {
        if (pendingVelocity !== undefined) {
          return failCompositionValidation(
            'ABC_REPEAT_EXPANSION_FAILED',
            'Repeat expansion left a dangling Velocity instruction',
          );
        }
        tokens.push('|');
      } else if (
        !['instrument', 'channel', 'name', 'tempo', 'key', 'meter'].includes(
          item.el_type,
        )
      ) {
        return failCompositionValidation(
          'ABC_REPEAT_EXPANSION_FAILED',
          `Repeat expansion produced unsupported element: ${item.el_type}`,
        );
      }
    }
    if (pendingVelocity !== undefined) {
      return failCompositionValidation(
        'ABC_REPEAT_EXPANSION_FAILED',
        'Repeat expansion left a dangling Velocity instruction',
      );
    }
    return tokens.join(' ');
  });
};

const serializeContainer = (
  parsed: ParsedContainer,
  voices: readonly string[],
): string => `X:1
T:${parsed.title}
M:${parsed.meter}
L:${parsed.defaultLength}
Q:1/4=${String(parsed.initialTempo)}
K:${parsed.initialKey}
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map(
  (trackId, index) => `[V:${trackId}] ${voices[index] ?? ''}`,
).join('\n')}
`;

export const canonicalizeExternalAbc = (source: string): string => {
  const parsed = parseContainer(source);
  const voices = parsed.hasRepeat
    ? serializeRepeatedVoices(parsed)
    : parsed.voices.map((voice) => serializeParsedVoice(parsed.source, voice));
  const canonical = serializeContainer(parsed, voices);

  const verification = parseContainer(canonical);
  if (verification.hasRepeat) {
    return failCompositionValidation(
      'ABC_REPEAT_EXPANSION_FAILED',
      'Canonical serializer left repeat markers in the output',
    );
  }
  return canonical;
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

const eventDurationTick = (token: string, defaultLength: string): Tick => {
  const untied = token.endsWith('-') ? token.slice(0, -1) : token;
  let suffix: string;
  if (untied.startsWith('[')) {
    suffix = untied.slice(untied.lastIndexOf(']') + 1);
  } else if (untied.startsWith('z')) {
    suffix = untied.slice(1);
  } else {
    const pitch = new RegExp(`^${PITCH}`).exec(untied)?.[0];
    if (pitch === undefined) {
      return failCompositionValidation(
        'ABC_UNSUPPORTED_SYNTAX',
        `Cannot read P0 ABC event duration: ${token}`,
      );
    }
    suffix = untied.slice(pitch.length);
  }

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
  const parsed = parseContainer(source);
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

const sameMap = (
  left: readonly unknown[],
  right: readonly unknown[],
): boolean => JSON.stringify(left) === JSON.stringify(right);

const buildTrack = (
  parsed: ParsedContainer,
  trackId: TrackId,
  voiceIndex: number,
  initialTempo: TempoEvent,
  initialKey: KeyEvent,
): TrackBuildResult => {
  const voice = parsed.voices[voiceIndex];
  const audioTrack = parsed.tune.setUpAudio({}).tracks[voiceIndex] ?? [];
  if (voice === undefined) {
    return failCompositionValidation(
      'ABC_STRUCTURE_INVALID',
      `Missing parsed voice for ${trackId}`,
    );
  }

  const notesByStartChar = new Map<number, AudioTrackNoteItem[]>();
  for (const audioItem of audioTrack) {
    if (audioItem.cmd !== 'note') {
      continue;
    }
    const current = notesByStartChar.get(audioItem.startChar) ?? [];
    current.push(audioItem);
    notesByStartChar.set(audioItem.startChar, current);
  }

  const events: DomainMusicEvent[] = [];
  const tempoMap: TempoEvent[] = [initialTempo];
  const keyMap: KeyEvent[] = [initialKey];
  let cursor = tick(0);
  let pendingDirectiveSpans: AbcSpan[] = [];
  let previousNotePitches: readonly ParsedPitch[] | undefined;

  for (const item of voice) {
    if (item.el_type === 'tempo') {
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

const initialKeyEvent = (tune: TuneObject): KeyEvent => {
  const key = tune.getKeySignature();
  return {
    tick: tick(0),
    tonic: key.root,
    accidental: key.acc,
    mode: key.mode,
  };
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

  const parsed = parseContainer(canonical);
  const meter = parsed.tune.getMeterFraction();
  const initialTempo: TempoEvent = {
    tick: tick(0),
    bpm: parsed.initialTempo,
  };
  const initialKey = initialKeyEvent(parsed.tune);
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
    canonicalAbc: canonical,
    totalTicks,
    tracks: builtTracks.map((built) => built.track),
    meterMap,
    tempoMap,
    keyMap,
    validationReport: { valid: true, issues: [] },
  };
};

export const createInitialCanonicalAbc = (): string => `X:1
T:Untitled
M:4/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map((trackId) => `[V:${trackId}] z4 |`).join('\n')}
`;
