import {
  BasicPreset,
  BasicSoundBank,
  GeneratorTypes,
  SoundBankLoader,
} from 'spessasynth_core';

/**
 * Small bundled P0 fallback for local playback. It is deliberately generated
 * from SpessaSynth's licensed sample bank until product-owned SF2 selection is
 * available; callers always receive an isolated buffer.
 */
export const createBundledP0SoundFont = (): ArrayBuffer => {
  const bank = SoundBankLoader.fromArrayBuffer(
    BasicSoundBank.getSampleSoundBankFile(),
  );
  const instrument = bank.instruments[0];
  if (instrument === undefined) {
    throw new Error('Bundled P0 SoundFont has no instrument.');
  }
  const alternatePreset = new BasicPreset(bank);
  alternatePreset.name = 'Dark Saw';
  alternatePreset.program = 1;
  alternatePreset.bankMSB = 0;
  alternatePreset.bankLSB = 0;
  alternatePreset.isGMGSDrum = false;
  alternatePreset.globalZone.setGenerator(
    GeneratorTypes.initialFilterFc,
    -4_800,
  );
  alternatePreset.createZone(instrument);
  bank.presets.push(alternatePreset);
  bank.flush();
  return bank.writeSF2();
};
