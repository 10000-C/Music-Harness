import ABCJS from 'abcjs';
import type { AudioTrackNoteItem, TuneObject } from 'abcjs';

import {
  PROJECT_PPQ,
  TRACK_IDS,
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

interface ParsedPitch {
  readonly endTie?: boolean;
  readonly startTie?: object;
}

interface ParsedVoiceItem {
  readonly el_type: string;
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
  readonly elem?: {
    readonly startChar?: number;
    readonly endChar?: number;
  };
}

interface ParsedContainer {
  readonly source: string;
  readonly title: string;
  readonly meter: string;
  readonly defaultLength: string;
  readonly initialTempo: number;
  readonly initialKey: string;
  readonly tune: TuneObject;
  readonly voices: readonly (readonly ParsedVoiceItem[])[];
  readonly hasRepeat: boolean;
}

interface TrackBuildResult {
  readonly track: DomainTrack;
  readonly tempoMap: readonly TempoEvent[];
  readonly keyMap: readonly KeyEvent[];
}

const tick = (value: number): Tick => value as Tick;

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
  if (
    meterMatch === null ||
    lengthMatch === null ||
    tempoMatch === null ||
    Number(meterMatch[1]) <= 0 ||
    Number(meterMatch[2]) <= 0 ||
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

  return {
    source,
    ...headers,
    tune,
    voices: collectVoices(tune),
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

const serializeParsedVoice = (
  source: string,
  voice: readonly ParsedVoiceItem[],
): string =>
  voice
    .map((item) => {
      switch (item.el_type) {
        case 'note':
          return validateNoteItem(source, item);
        case 'bar':
          return '|';
        case 'tempo':
        case 'key':
          return localDirectiveToken(source, item);
        default:
          return failCompositionValidation(
            'ABC_UNSUPPORTED_SYNTAX',
            `Unsupported P0 ABC element: ${item.el_type}`,
          );
      }
    })
    .join(' ');

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
    for (const item of voice) {
      if (item.el_type === 'note' && item.elem !== undefined) {
        tokens.push(
          validateNoteItem(parsed.source, item.elem as ParsedVoiceItem),
        );
      } else if (item.el_type === 'bar') {
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

    validateNoteItem(parsed.source, item);
    if (typeof item.duration !== 'number') {
      return failCompositionValidation(
        'ABC_STRUCTURE_INVALID',
        `Missing duration in ${trackId}`,
      );
    }
    const tokenDuration = exactDurationTick(item.duration);
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
      cursor = tick(cursor + tokenDuration);
      continue;
    }

    const isTieContinuation =
      item.pitches !== undefined &&
      item.pitches.length > 0 &&
      item.pitches.every((pitch) => pitch.endTie === true);
    if (isTieContinuation) {
      const previous = events.at(-1);
      if (previous?.type !== 'note') {
        return failCompositionValidation(
          'ABC_STRUCTURE_INVALID',
          `Tie continuation in ${trackId} has no preceding note`,
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
    events.push({
      type: 'note',
      trackId,
      startTick: cursor,
      durationTick: tokenDuration,
      pitches: audioNotes.map((audioNote) => audioNote.pitch),
      velocity: DEFAULT_VELOCITY,
      abcSpans: spans,
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
    bpm: parsed.tune.getBpm(),
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
