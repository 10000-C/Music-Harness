import { describe, expect, it } from 'vitest';

import {
  createEditedSpikeMidiFile,
  createSpikeMidiFile,
  createSpikeSoundFont,
  inspectSpikeMidi,
  inspectSpikeSoundFont,
  parseSpikeMidi,
} from '../src/renderer/spessasynth-spike/spike-fixtures.js';

describe('SpessaSynth competition spike fixtures', () => {
  it('round-trips a multi-track MIDI with the required musical metadata', () => {
    const midiBuffer = createSpikeMidiFile();
    const evidence = inspectSpikeMidi(parseSpikeMidi(midiBuffer));

    expect(midiBuffer.byteLength).toBeGreaterThan(100);
    expect(evidence).toMatchObject({
      format: 1,
      timeDivision: 480,
      timeSignatures: [{ ticks: 0, numerator: 4, denominator: 4 }],
    });
    expect(evidence.tempos).toContainEqual({ ticks: 0, bpm: 120 });
    expect(evidence.tracks.slice(1)).toMatchObject([
      {
        name: 'Piano',
        channels: [0],
        programs: [{ channel: 0, program: 0, ticks: 0 }],
        notes: [
          { channel: 0, midiNote: 60, velocity: 104, ticks: 0 },
          { channel: 0, midiNote: 64, velocity: 92, ticks: 720 },
        ],
      },
      {
        name: 'Bass',
        channels: [1],
        programs: [{ channel: 1, program: 1, ticks: 0 }],
        notes: [
          { channel: 1, midiNote: 36, velocity: 96, ticks: 0 },
          { channel: 1, midiNote: 40, velocity: 88, ticks: 720 },
        ],
      },
    ]);
  });

  it('creates and parses a deterministic two-preset SF2', () => {
    const evidence = inspectSpikeSoundFont(createSpikeSoundFont());

    expect(evidence.byteLength).toBeGreaterThan(500);
    expect(evidence).toMatchObject({
      presetCount: 2,
      presets: [
        { name: 'Saw Wave', program: 0, bankMSB: 0, bankLSB: 0 },
        { name: 'Dark Saw', program: 1, bankMSB: 0, bankLSB: 0 },
      ],
    });
  });

  it('persists programmatic transpose, instrument, mix and velocity edits', () => {
    const original = parseSpikeMidi(createSpikeMidiFile());
    const edited = inspectSpikeMidi(
      parseSpikeMidi(createEditedSpikeMidiFile(original), 'edited.mid'),
    );

    const piano = edited.tracks[1];
    const bass = edited.tracks[2];
    expect(piano?.notes).toMatchObject([
      { midiNote: 60, velocity: 80 },
      { midiNote: 64, velocity: 80 },
    ]);
    expect(bass).toMatchObject({
      programs: [{ channel: 1, program: 0, ticks: 0 }],
      notes: [{ midiNote: 48 }, { midiNote: 52 }],
    });

    const reparsed = parseSpikeMidi(
      parseSpikeMidi(createEditedSpikeMidiFile(original)).writeMIDI(),
    );
    expect(inspectSpikeMidi(reparsed).tracks[2]).toMatchObject({
      programs: [{ program: 0 }],
      notes: [{ midiNote: 48 }, { midiNote: 52 }],
    });
  });
});
