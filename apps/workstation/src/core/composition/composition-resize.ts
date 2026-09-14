import {
  PROJECT_PPQ,
  TRACK_IDS,
  type TaskScope,
  type TrackId,
} from '@agent-music/contracts';

import { canonicalizeExternalAbc } from './canonical-abc.js';
import {
  compileComposition,
  type CompositionCompilation,
} from './composition-pipeline.js';
import { failCompositionValidation } from './composition-validation-error.js';
import { isScopeMappingCacheValid } from './scope-mapping.js';

export interface CompositionResizeResult {
  readonly compilation: CompositionCompilation;
  readonly previousMeasureCount: number;
  readonly targetMeasureCount: number;
}

const hasAllTracks = (trackIds: readonly TrackId[]): boolean =>
  trackIds.length === TRACK_IDS.length &&
  TRACK_IDS.every((trackId) => trackIds.includes(trackId));

const ticksPerMeasure = (compilation: CompositionCompilation): number => {
  const meter = compilation.meterMap[0];
  if (meter === undefined)
    return failCompositionValidation(
      'COMPOSITION_RESIZE_INVALID',
      'Composition is missing Global Meter',
    );
  const value = (PROJECT_PPQ * 4 * meter.numerator) / meter.denominator;
  if (!Number.isSafeInteger(value) || value <= 0)
    return failCompositionValidation(
      'COMPOSITION_RESIZE_INVALID',
      'Global Meter cannot map to an exact measure length',
    );
  return value;
};

const restTokenForMeasure = (compilation: CompositionCompilation): string => {
  const meter = compilation.meterMap[0];
  if (meter === undefined)
    return failCompositionValidation(
      'COMPOSITION_RESIZE_INVALID',
      'Composition is missing Global Meter',
    );
  const defaultLength = /^L:(\d+)\/(\d+)$/m.exec(compilation.canonicalAbc);
  const defaultNumerator = Number(defaultLength?.[1]);
  const defaultDenominator = Number(defaultLength?.[2]);
  if (
    defaultLength === null ||
    !Number.isSafeInteger(defaultNumerator) ||
    !Number.isSafeInteger(defaultDenominator) ||
    defaultNumerator <= 0 ||
    defaultDenominator <= 0
  ) {
    return failCompositionValidation(
      'COMPOSITION_RESIZE_INVALID',
      'Composition has an invalid default note length',
    );
  }
  const numerator = meter.numerator * defaultDenominator;
  const denominator = meter.denominator * defaultNumerator;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(numerator, denominator);
  const n = numerator / d;
  const den = denominator / d;
  return den === 1 ? `z${String(n)} |` : `z${String(n)}/${String(den)} |`;
};

const editVoiceLines = (
  source: string,
  editor: (trackId: TrackId, body: string) => string,
): string => {
  let next = source;
  for (const trackId of TRACK_IDS) {
    const pattern = new RegExp(
      `^(\\[V:${trackId.replace('.', '\\.')}\\])\\s*(.*)$`,
      'm',
    );
    next = next.replace(
      pattern,
      (_match, marker: string, body: string) =>
        `${marker} ${editor(trackId, body).trim()}`,
    );
  }
  return canonicalizeExternalAbc(next);
};

export const resizeComposition = (
  compilation: CompositionCompilation,
  scope: TaskScope,
  targetMeasureCount: number,
): CompositionResizeResult => {
  if (scope.type !== 'wholeProject' || !hasAllTracks(scope.trackIds)) {
    return failCompositionValidation(
      'COMPOSITION_RESIZE_INVALID',
      'Composition resize requires a wholeProject Scope covering all six tracks',
    );
  }
  if (!Number.isSafeInteger(targetMeasureCount) || targetMeasureCount <= 0) {
    return failCompositionValidation(
      'COMPOSITION_RESIZE_INVALID',
      'targetMeasureCount must be a positive safe integer',
    );
  }
  if (
    !isScopeMappingCacheValid(
      compilation.scopeMapping,
      compilation.canonicalAbc,
    )
  ) {
    return failCompositionValidation(
      'SCOPE_MAPPING_STALE',
      'Scope Mapping cache does not match Canonical ABC',
    );
  }
  const measureTicks = ticksPerMeasure(compilation);
  if (compilation.totalTicks % measureTicks !== 0) {
    return failCompositionValidation(
      'COMPOSITION_RESIZE_INVALID',
      'Current composition length must end on a full Global Meter measure boundary before resize',
    );
  }
  const currentMeasureCount = compilation.totalTicks / measureTicks;
  if (targetMeasureCount === currentMeasureCount) {
    return {
      compilation,
      previousMeasureCount: currentMeasureCount,
      targetMeasureCount,
    };
  }
  const targetTicks = targetMeasureCount * measureTicks;
  if (!Number.isSafeInteger(targetTicks))
    return failCompositionValidation(
      'COMPOSITION_RESIZE_INVALID',
      'Requested composition length exceeds the safe Tick range',
    );

  if (targetMeasureCount > currentMeasureCount) {
    const rest = restTokenForMeasure(compilation);
    const count = targetMeasureCount - currentMeasureCount;
    const canonical = editVoiceLines(
      compilation.canonicalAbc,
      (_trackId, body) =>
        `${body.trim()} ${Array.from({ length: count }, () => rest).join(' ')}`,
    );
    return {
      compilation: compileComposition(canonical),
      previousMeasureCount: currentMeasureCount,
      targetMeasureCount,
    };
  }

  const offendingTracks = compilation.tracks
    .filter((track) =>
      track.events.some(
        (event) =>
          (event.startTick < targetTicks &&
            event.startTick + event.durationTick > targetTicks) ||
          (event.startTick >= targetTicks && event.type !== 'rest'),
      ),
    )
    .map((track) => track.trackId);
  const hasGlobalTail =
    compilation.tempoMap.slice(1).some((event) => event.tick >= targetTicks) ||
    compilation.keyMap.slice(1).some((event) => event.tick >= targetTicks);
  if (offendingTracks.length > 0 || hasGlobalTail) {
    return failCompositionValidation(
      'COMPOSITION_TRUNCATE_WOULD_DELETE_CONTENT',
      'Composition resize would delete existing musical content',
      {
        targetMeasureCount,
        targetTicks,
        affectedTracks: offendingTracks,
        hasGlobalTailEvents: hasGlobalTail,
      },
    );
  }

  const canonical = editVoiceLines(
    compilation.canonicalAbc,
    (trackId, body) => {
      const entries = compilation.scopeMapping.tracks[trackId];
      const firstRemoved = entries.find(
        (entry) => entry.startTick >= targetTicks,
      );
      if (firstRemoved === undefined) return body;
      const cut = Math.min(
        ...firstRemoved.abcSpans.map((span) => span.startChar),
      );
      const lineStart = compilation.canonicalAbc.indexOf(`[V:${trackId}]`);
      const bodyStart = compilation.canonicalAbc.indexOf(' ', lineStart) + 1;
      return compilation.canonicalAbc.slice(bodyStart, cut).trim();
    },
  );
  return {
    compilation: compileComposition(canonical),
    previousMeasureCount: currentMeasureCount,
    targetMeasureCount,
  };
};
