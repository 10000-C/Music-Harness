import { TRACK_IDS } from '@agent-music/contracts';

import {
  parseAbcDocument,
  sequenceParsedAbc,
  type ParsedAbcDocument,
  type ParsedPitch,
  type ParsedVoiceItem,
} from './abc-parser-adapter.js';
import type { AbcSpan } from './composition-types.js';
import { failCompositionValidation } from './composition-validation-error.js';
import {
  isSupportedGlobalMeter,
  type GlobalMeterValue,
} from './meter-policy.js';

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

export interface VelocityDirective {
  readonly velocity: number;
  readonly span: AbcSpan;
}

export interface ParsedCanonicalAbc extends ParsedAbcDocument {
  readonly title: string;
  readonly meter: string;
  readonly meterValue: GlobalMeterValue;
  readonly defaultLength: string;
  readonly initialTempo: number;
  readonly initialKey: string;
  readonly velocityDirectives: ReadonlyMap<number, VelocityDirective>;
  readonly hasRepeat: boolean;
}

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

export const isTieContinuation = (item: ParsedVoiceItem): boolean =>
  item.pitches !== undefined &&
  item.pitches.length > 0 &&
  item.pitches.every((pitch) => pitch.endTie === true);

export const spanFor = (
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

export const validateNoteItem = (
  source: string,
  item: ParsedVoiceItem,
): string => {
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

export const durationSuffixForToken = (token: string): string => {
  const untied = token.endsWith('-') ? token.slice(0, -1) : token;
  if (untied.startsWith('[')) {
    return untied.slice(untied.lastIndexOf(']') + 1);
  }
  if (untied.startsWith('z')) {
    return untied.slice(1);
  }
  const pitch = new RegExp(`^${PITCH}`).exec(untied)?.[0];
  if (pitch === undefined) {
    return failCompositionValidation(
      'ABC_UNSUPPORTED_SYNTAX',
      `Cannot read P0 ABC event duration: ${token}`,
    );
  }
  return untied.slice(pitch.length);
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

export const parseCanonicalAbc = (rawSource: string): ParsedCanonicalAbc => {
  const source = normalizeLineEndings(rawSource).trimEnd() + '\n';
  validateContainerShape(source);
  const headers = validateHeaders(source);
  const parsed = parseAbcDocument(source);

  return {
    ...parsed,
    ...headers,
    velocityDirectives: collectVelocityDirectives(source, parsed.voices),
    hasRepeat: REPEAT_MARKER.test(source),
  };
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
  parsed: ParsedCanonicalAbc,
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

  const sequence = sequenceParsedAbc(parsed);
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
  parsed: ParsedCanonicalAbc,
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

export const serializeCanonicalAbc = (parsed: ParsedCanonicalAbc): string => {
  const voices = parsed.hasRepeat
    ? serializeRepeatedVoices(parsed)
    : parsed.voices.map((voice) => serializeParsedVoice(parsed.source, voice));
  return serializeContainer(parsed, voices);
};

export const createInitialCanonicalAbcSource = (): string => `X:1
T:Untitled
M:4/4
L:1/4
Q:1/4=120
K:C
${TRACK_IDS.map((trackId) => `V:${trackId}`).join('\n')}
${TRACK_IDS.map((trackId) => `[V:${trackId}] z4 |`).join('\n')}
`;

export type { ParsedPitch, ParsedVoiceItem };
