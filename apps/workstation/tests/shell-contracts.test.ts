import { describe, expect, it } from 'vitest';
import {
  isExportPathRequest,
  isProjectDirectoryPurpose,
} from '../src/shared/shell-contracts.js';

describe('shell contracts', () => {
  it.each(['create', 'open', 'saveAs'])(
    'allows directory purpose %s',
    (value) => {
      expect(isProjectDirectoryPurpose(value)).toBe(true);
    },
  );
  it.each(['delete', '', null])(
    'rejects non-semantic directory purpose %s',
    (value) => {
      expect(isProjectDirectoryPurpose(value)).toBe(false);
    },
  );
  it.each(['abc', 'midi', 'wav'])(
    'allows export format %s with a safe filename',
    (format) => {
      expect(
        isExportPathRequest({ format, suggestedName: 'song-01.abc' }),
      ).toBe(true);
    },
  );
  it('allows Unicode and spaces in a safe Windows filename', () => {
    expect(
      isExportPathRequest({
        format: 'wav',
        suggestedName: '午夜 草图.wav',
      }),
    ).toBe(true);
  });
  it.each([
    { format: 'mp3', suggestedName: 'song' },
    { format: 'wav', suggestedName: '../song.wav' },
    { format: 'wav', suggestedName: '' },
    { format: 'wav', suggestedName: 'CON.wav' },
    { format: 'wav', suggestedName: 'song. ' },
  ])('rejects unsafe export request', (value) => {
    expect(isExportPathRequest(value)).toBe(false);
  });
});
