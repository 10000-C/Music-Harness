import { failCompositionValidation } from './composition-validation-error.js';

const MAX_MIDI_TEMPO_MICROSECONDS = 0xff_ffff;

export interface MidiTempo {
  readonly microsecondsPerQuarter: number;
}

export const createMidiTempoFromBpm = (bpm: number): MidiTempo => {
  if (!Number.isFinite(bpm) || bpm <= 0) {
    return failCompositionValidation(
      'MIDI_TEMPO_INVALID',
      `Tempo BPM must be a finite positive number: ${String(bpm)}`,
    );
  }

  const microsecondsPerQuarter = Math.round(60_000_000 / bpm);
  if (
    microsecondsPerQuarter < 1 ||
    microsecondsPerQuarter > MAX_MIDI_TEMPO_MICROSECONDS
  ) {
    return failCompositionValidation(
      'MIDI_TEMPO_INVALID',
      `Tempo cannot be represented by the Standard MIDI 24-bit Set Tempo field: ${String(bpm)} BPM`,
    );
  }

  return { microsecondsPerQuarter };
};
