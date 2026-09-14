export interface AudioBufferLike {
  readonly sampleRate: number;
  readonly length: number;
  readonly numberOfChannels: number;
  getChannelData(channel: number): Float32Array;
}

const clampSample = (value: number): number =>
  Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));

const writeAscii = (view: DataView, offset: number, value: string): void => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

/** Encode an abcjs AudioBuffer into a canonical PCM16 RIFF/WAV payload. */
export const encodeAudioBufferToWav = (
  audioBuffer: AudioBufferLike,
): Uint8Array => {
  if (
    !Number.isInteger(audioBuffer.sampleRate) ||
    audioBuffer.sampleRate <= 0 ||
    !Number.isInteger(audioBuffer.length) ||
    audioBuffer.length <= 0 ||
    !Number.isInteger(audioBuffer.numberOfChannels) ||
    audioBuffer.numberOfChannels <= 0 ||
    audioBuffer.numberOfChannels > 32
  ) {
    throw new Error('Audio buffer metadata is invalid.');
  }

  const channelData = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channel) => {
      const data = audioBuffer.getChannelData(channel);
      if (data.length < audioBuffer.length) {
        throw new Error('Audio buffer channel length is invalid.');
      }
      return data;
    },
  );
  const bytesPerSample = 2;
  const blockAlign = audioBuffer.numberOfChannels * bytesPerSample;
  const dataSize = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, audioBuffer.numberOfChannels, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let frame = 0; frame < audioBuffer.length; frame += 1) {
    for (const channel of channelData) {
      const sample = clampSample(channel[frame] ?? 0);
      const pcm =
        sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      view.setInt16(offset, pcm, true);
      offset += bytesPerSample;
    }
  }
  return new Uint8Array(buffer);
};
