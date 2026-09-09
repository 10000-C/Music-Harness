import {
  BasicMIDI,
  MIDIBuilder,
  MIDIControllers,
  MIDIMessageTypes,
  SoundBankLoader,
  type MIDIMessage,
  type ModifyMIDIOptions,
} from 'spessasynth_core';
import { createBundledP0SoundFont } from '../opendaw-runtime/builtin-soundfont.js';

export interface SpikeNoteEvidence {
  readonly channel: number;
  readonly midiNote: number;
  readonly velocity: number;
  readonly ticks: number;
}

export interface SpikeProgramEvidence {
  readonly channel: number;
  readonly program: number;
  readonly ticks: number;
}

export interface SpikeTrackEvidence {
  readonly index: number;
  readonly name: string;
  readonly channels: readonly number[];
  readonly notes: readonly SpikeNoteEvidence[];
  readonly programs: readonly SpikeProgramEvidence[];
}

export interface SpikeMidiEvidence {
  readonly fileName: string | null;
  readonly format: number;
  readonly timeDivision: number;
  readonly durationSeconds: number;
  readonly tempos: readonly {
    readonly ticks: number;
    readonly bpm: number;
  }[];
  readonly timeSignatures: readonly {
    readonly ticks: number;
    readonly numerator: number;
    readonly denominator: number;
  }[];
  readonly tracks: readonly SpikeTrackEvidence[];
}

export interface SpikeSoundFontEvidence {
  readonly byteLength: number;
  readonly presetCount: number;
  readonly presets: readonly {
    readonly name: string;
    readonly program: number;
    readonly bankMSB: number;
    readonly bankLSB: number;
  }[];
}

const channelFor = (message: MIDIMessage): number => message.statusByte & 0x0f;
const messageTypeFor = (message: MIDIMessage): number =>
  message.statusByte & 0xf0;

const requireDataByte = (message: MIDIMessage, index: number): number => {
  const value = message.data[index];
  if (value === undefined) {
    throw new Error(
      `MIDI event 0x${message.statusByte.toString(16)} is missing byte ${String(index)}.`,
    );
  }
  return value;
};

/** Creates a valid format-1 SMF with conductor, piano and bass tracks. */
export const createSpikeMidiFile = (): ArrayBuffer => {
  const midi = new MIDIBuilder({
    format: 1,
    timeDivision: 480,
    initialTempo: 120,
    name: 'AMW SpessaSynth Spike',
  });
  midi.addEvent(0, 0, MIDIMessageTypes.timeSignature, [4, 2, 24, 8]);

  midi.addTrack('Piano');
  midi.programChange(0, 1, 0, 0);
  midi.noteOn(0, 1, 0, 60, 104);
  midi.noteOff(720, 1, 0, 60);
  midi.noteOn(720, 1, 0, 64, 92);
  midi.noteOff(1_440, 1, 0, 64);

  midi.addTrack('Bass');
  midi.programChange(0, 2, 1, 1);
  midi.noteOn(0, 2, 1, 36, 96);
  midi.noteOff(720, 2, 1, 36);
  midi.noteOn(720, 2, 1, 40, 88);
  midi.noteOff(1_440, 2, 1, 40);

  midi.flush(true);
  return midi.writeMIDI();
};

/** Creates a tiny, deterministic SF2 with two selectable presets. */
export const createSpikeSoundFont = (): ArrayBuffer => {
  return createBundledP0SoundFont();
};

export const parseSpikeMidi = (
  buffer: ArrayBuffer,
  fileName = 'spessasynth-spike.mid',
): BasicMIDI => BasicMIDI.fromArrayBuffer(buffer, fileName);

export const inspectSpikeMidi = (midi: BasicMIDI): SpikeMidiEvidence => {
  const timeSignatures = midi.tracks.flatMap((track) =>
    [...track.events]
      .filter((event) => event.statusByte === MIDIMessageTypes.timeSignature)
      .map((event) => ({
        ticks: event.ticks,
        numerator: requireDataByte(event, 0),
        denominator: 2 ** requireDataByte(event, 1),
      })),
  );

  const tracks = midi.tracks.map((track, index): SpikeTrackEvidence => {
    const notes: SpikeNoteEvidence[] = [];
    const programs: SpikeProgramEvidence[] = [];
    for (const event of track.events) {
      const type = messageTypeFor(event);
      if (type === MIDIMessageTypes.noteOn && requireDataByte(event, 1) > 0) {
        notes.push({
          channel: channelFor(event),
          midiNote: requireDataByte(event, 0),
          velocity: requireDataByte(event, 1),
          ticks: event.ticks,
        });
      } else if (type === MIDIMessageTypes.programChange) {
        programs.push({
          channel: channelFor(event),
          program: requireDataByte(event, 0),
          ticks: event.ticks,
        });
      }
    }

    return {
      index,
      name: track.name,
      channels: [...track.channels].sort((left, right) => left - right),
      notes,
      programs,
    };
  });

  return {
    fileName: midi.fileName ?? null,
    format: midi.format,
    timeDivision: midi.timeDivision,
    durationSeconds: midi.duration,
    tempos: midi.tempoChanges.map((change) => ({
      ticks: change.ticks,
      bpm: change.tempo,
    })),
    timeSignatures,
    tracks,
  };
};

export const inspectSpikeSoundFont = (
  buffer: ArrayBuffer,
): SpikeSoundFontEvidence => {
  const bank = SoundBankLoader.fromArrayBuffer(buffer);
  return {
    byteLength: buffer.byteLength,
    presetCount: bank.presets.length,
    presets: bank.presets.map((preset) => ({
      name: preset.name,
      program: preset.program,
      bankMSB: preset.bankMSB,
      bankLSB: preset.bankLSB,
    })),
  };
};

/** Simulates an Agent edit through SpessaSynth's programmatic MIDI API. */
export const createEditedSpikeMidiFile = (source: BasicMIDI): ArrayBuffer => {
  const edited = BasicMIDI.copyFrom(source);
  const channels: NonNullable<ModifyMIDIOptions['channels']> = new Map();
  channels.set(1, {
    keyShift: 12,
    patch: {
      program: 0,
      bankMSB: 0,
      bankLSB: 0,
      isGMGSDrum: false,
    },
    controllers: new Map([
      [MIDIControllers.mainVolume, 84],
      [MIDIControllers.pan, 40],
      [MIDIControllers.brightness, 82],
      [MIDIControllers.reverbDepth, 36],
    ]),
  });
  edited.modify({ channels });

  for (const track of edited.tracks) {
    for (const event of track.events) {
      if (
        messageTypeFor(event) === MIDIMessageTypes.noteOn &&
        channelFor(event) === 0 &&
        requireDataByte(event, 1) > 0
      ) {
        event.data[1] = 80;
      }
    }
  }

  edited.flush(true);
  return edited.writeMIDI();
};
