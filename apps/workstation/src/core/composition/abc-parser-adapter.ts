import ABCJS from 'abcjs';
import type { AudioTrackNoteItem, TuneObject } from 'abcjs';

import { TRACK_IDS } from '@agent-music/contracts';

import { failCompositionValidation } from './composition-validation-error.js';

export interface ParsedPitch {
  readonly accidental?: string;
  readonly endTie?: boolean;
  readonly pitch: number;
  readonly startTie?: object;
}

export interface ParsedVoiceItem {
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

export interface ParsedSequenceItem {
  readonly el_type: string;
  readonly volume?: number;
  readonly elem?: {
    readonly startChar?: number;
    readonly endChar?: number;
  };
}

export interface ParsedAudioNote {
  readonly cmd: string;
  readonly startChar: number;
  readonly pitch: number;
}

export interface ParsedMeterFraction {
  readonly num: number;
  readonly den?: number;
}

export interface ParsedKeySignature {
  readonly root: string;
  readonly acc: '' | '#' | 'b';
  readonly mode: string;
}

export interface ParsedAbcDocument {
  readonly source: string;
  readonly voices: readonly (readonly ParsedVoiceItem[])[];
  readonly parserState: unknown;
}

const decodeWarningText = (value: string): string =>
  value
    .replace(/<[^>]*>/g, '')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ')
    .trim();

const normalizedParserWarnings = (warnings: readonly string[]) => {
  const grouped = new Map<string, { count: number; first: string }>();
  for (const raw of warnings) {
    const clean = decodeWarningText(raw);
    const key = clean.replace(/Music Line:\d+:\d+:/g, 'Music Line:');
    const existing = grouped.get(key);
    grouped.set(key, {
      count: (existing?.count ?? 0) + 1,
      first: existing?.first ?? clean,
    });
  }
  const items = [...grouped.values()].slice(0, 5).map((item) => ({
    message: item.first.slice(0, 400),
    count: item.count,
  }));
  const hasPostfixAccidental = warnings.some((warning) =>
    /Unknown character ignored:[\s\S]*[#]/.test(warning),
  );
  return {
    totalWarnings: warnings.length,
    warnings: items,
    ...(hasPostfixAccidental
      ? {
          hint: 'ABC accidentals precede the pitch: use ^F, _B, or =C instead of F#, Bb, or postfix accidentals.',
        }
      : {}),
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

const tuneFor = (document: ParsedAbcDocument): TuneObject =>
  document.parserState as TuneObject;

export const parseAbcDocument = (source: string): ParsedAbcDocument => {
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
    const details = normalizedParserWarnings(tune.warnings);
    return failCompositionValidation(
      'ABC_PARSER_WARNING',
      `ABC parser warning (${String(details.totalWarnings)} occurrence${details.totalWarnings === 1 ? '' : 's'}): ${details.warnings[0]?.message ?? 'invalid ABC syntax'}`,
      details,
    );
  }

  return {
    source,
    voices: collectVoices(tune),
    parserState: tune,
  };
};

export const sequenceParsedAbc = (
  document: ParsedAbcDocument,
): readonly (readonly ParsedSequenceItem[])[] =>
  ABCJS.synth.sequence(
    tuneFor(document),
    {},
  ) as unknown as readonly (readonly ParsedSequenceItem[])[];

export const audioNotesForVoice = (
  document: ParsedAbcDocument,
  voiceIndex: number,
): readonly ParsedAudioNote[] =>
  (tuneFor(document).setUpAudio({}).tracks[voiceIndex] ?? [])
    .filter((item): item is AudioTrackNoteItem => item.cmd === 'note')
    .map((item) => ({
      cmd: item.cmd,
      startChar: item.startChar,
      pitch: item.pitch,
    }));

export const meterFractionFor = (
  document: ParsedAbcDocument,
): ParsedMeterFraction => tuneFor(document).getMeterFraction();

export const keySignatureFor = (
  document: ParsedAbcDocument,
): ParsedKeySignature => {
  const key = tuneFor(document).getKeySignature();
  return {
    root: key.root,
    acc: key.acc === '#' || key.acc === 'b' ? key.acc : '',
    mode: key.mode,
  };
};
