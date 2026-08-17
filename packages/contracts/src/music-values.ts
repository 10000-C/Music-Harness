declare const midiNoteNumberBrand: unique symbol;

export type MidiNoteNumber = number & {
  readonly [midiNoteNumberBrand]: true;
};

export const isMidiNoteNumber = (value: unknown): value is MidiNoteNumber =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 0 &&
  value <= 127;

export const createMidiNoteNumber = (value: number): MidiNoteNumber => {
  if (!isMidiNoteNumber(value)) {
    throw new RangeError(
      `MIDI note number must be an integer from 0 through 127: ${String(value)}`,
    );
  }
  return value;
};
