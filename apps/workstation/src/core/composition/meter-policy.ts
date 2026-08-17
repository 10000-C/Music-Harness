export interface GlobalMeterValue {
  readonly numerator: number;
  readonly denominator: number;
}

export const isSupportedGlobalMeter = (meter: GlobalMeterValue): boolean =>
  Number.isInteger(meter.numerator) &&
  meter.numerator >= 1 &&
  meter.numerator <= 255 &&
  Number.isInteger(meter.denominator) &&
  meter.denominator >= 1 &&
  meter.denominator <= 128 &&
  (meter.denominator & (meter.denominator - 1)) === 0;
