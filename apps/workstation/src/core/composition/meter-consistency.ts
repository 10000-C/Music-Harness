import { PROJECT_PPQ } from '@agent-music/contracts';

import { readCanonicalMeterStructure } from './canonical-abc.js';
import type { ValidationReport } from './composition-types.js';
import { CompositionValidationError } from './composition-validation-error.js';

const TICKS_PER_WHOLE_NOTE = PROJECT_PPQ * 4;

export const validateFinalMeterConsistency = (
  source: string,
): ValidationReport => {
  try {
    const structure = readCanonicalMeterStructure(source);
    const { meter } = structure;
    const measureTicks =
      (TICKS_PER_WHOLE_NOTE * meter.numerator) / meter.denominator;

    for (const track of structure.tracks) {
      let previousBarlineTick = 0;

      for (const [index, barlineTick] of track.barlineTicks.entries()) {
        const measureLength = barlineTick - previousBarlineTick;
        const terminalBarline =
          index === track.barlineTicks.length - 1 &&
          barlineTick === track.totalTicks;
        const validLength = terminalBarline
          ? measureLength > 0 && measureLength <= measureTicks
          : measureLength === measureTicks;

        if (!validLength) {
          return {
            valid: false,
            issues: [
              {
                code: 'METER_BARLINE_MISMATCH',
                message: `Barline layout in ${track.trackId} does not match ${String(meter.numerator)}/${String(meter.denominator)} at tick ${String(barlineTick)}`,
              },
            ],
          };
        }
        previousBarlineTick = barlineTick;
      }

      const trailingMeasureLength = track.totalTicks - previousBarlineTick;
      if (trailingMeasureLength > measureTicks) {
        return {
          valid: false,
          issues: [
            {
              code: 'METER_BARLINE_MISMATCH',
              message: `Final measure in ${track.trackId} does not match ${String(meter.numerator)}/${String(meter.denominator)}`,
            },
          ],
        };
      }
    }

    return { valid: true, issues: [] };
  } catch (error) {
    if (error instanceof CompositionValidationError) {
      return error.report;
    }
    throw error;
  }
};
