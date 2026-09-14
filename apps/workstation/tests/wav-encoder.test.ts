import { describe, expect, it } from 'vitest';
import { encodeAudioBufferToWav } from '../src/renderer/export/wav-encoder.js';

const createBuffer = (channels: readonly Float32Array[], sampleRate = 8) => ({
  sampleRate,
  length: channels[0]?.length ?? 0,
  numberOfChannels: channels.length,
  getChannelData: (channel: number) => channels[channel] ?? new Float32Array(),
});

describe('WAV encoder', () => {
  it('writes a PCM16 RIFF payload with interleaved channel samples', () => {
    const wav = encodeAudioBufferToWav(
      createBuffer([new Float32Array([-1, 0.5]), new Float32Array([0, 1])]),
    );
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(8);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(8);
    expect(view.getInt16(44, true)).toBe(-32768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(16384);
    expect(view.getInt16(50, true)).toBe(32767);
  });

  it('clamps non-finite samples and rejects invalid metadata', () => {
    const wav = encodeAudioBufferToWav(
      createBuffer([new Float32Array([Number.NaN, 2])]),
    );
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(() =>
      encodeAudioBufferToWav(createBuffer([new Float32Array()])),
    ).toThrow('metadata is invalid');
  });
});
