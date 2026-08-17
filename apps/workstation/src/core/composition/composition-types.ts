import type {
  KeyEvent,
  MeterEvent,
  MidiNoteNumber,
  TempoEvent,
  Tick,
  TrackId,
} from '@agent-music/contracts';

export interface AbcSpan {
  readonly startChar: number;
  readonly endChar: number;
}

interface DomainEventBase {
  readonly trackId: TrackId;
  readonly startTick: Tick;
  readonly durationTick: Tick;
  readonly abcSpans: readonly AbcSpan[];
}

export interface DomainNoteEvent extends DomainEventBase {
  readonly type: 'note';
  readonly pitches: readonly MidiNoteNumber[];
  readonly velocity: number;
}

export interface DomainRestEvent extends DomainEventBase {
  readonly type: 'rest';
}

export type DomainMusicEvent = DomainNoteEvent | DomainRestEvent;

export interface DomainTrack {
  readonly trackId: TrackId;
  readonly totalTicks: Tick;
  readonly events: readonly DomainMusicEvent[];
}

export type CompositionValidationIssueCode =
  | 'ABC_PARSE_FAILED'
  | 'ABC_PARSER_WARNING'
  | 'ABC_STRUCTURE_INVALID'
  | 'ABC_UNSUPPORTED_SYNTAX'
  | 'ABC_REPEAT_EXPANSION_FAILED'
  | 'ABC_NOT_CANONICAL'
  | 'ABC_DURATION_NOT_EXACT'
  | 'TRACK_LENGTH_MISMATCH'
  | 'GLOBAL_MAP_MISMATCH'
  | 'MIDI_NOTE_NUMBER_INVALID'
  | 'MIDI_TEMPO_INVALID'
  | 'GLOBAL_METER_INVALID'
  | 'METER_BARLINE_MISMATCH'
  | 'SCOPE_INVALID'
  | 'SCOPE_MAPPING_STALE'
  | 'SCOPE_CROSSES_EVENT'
  | 'SCOPE_REPLACEMENT_INVALID'
  | 'SCOPE_DURATION_MISMATCH'
  | 'SCOPE_OUTSIDE_CHANGED'
  | 'SCOPE_GLOBAL_CHANGE_REQUIRES_ALL_TRACKS'
  | 'SCOPE_GLOBAL_METER_REQUIRES_WHOLE_PROJECT';

export interface CompositionValidationIssue {
  readonly code: CompositionValidationIssueCode;
  readonly message: string;
}

export interface ValidationReport {
  readonly valid: boolean;
  readonly issues: readonly CompositionValidationIssue[];
}

export interface CanonicalAbcCompilation {
  readonly canonicalAbc: string;
  readonly totalTicks: Tick;
  readonly tracks: readonly DomainTrack[];
  readonly meterMap: readonly MeterEvent[];
  readonly tempoMap: readonly TempoEvent[];
  readonly keyMap: readonly KeyEvent[];
  readonly validationReport: ValidationReport;
}
