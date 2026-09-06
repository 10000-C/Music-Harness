export interface CandidateChangeItem {
  readonly track: string;
  readonly detail: string;
}

export interface CandidateReviewDetails {
  readonly title: string;
  readonly changes: readonly CandidateChangeItem[];
}

export const competitionCandidatePianoPatch = {
  instrument: { from: 'Grand Piano', to: 'Electric Piano' },
  brightness: { from: 60, to: 42 },
  reverb: { from: 22, to: 36 },
  chorus: { from: 10, to: 20 },
} as const;

const signedDelta = (from: number, to: number): string => {
  const delta = to - from;
  return `${delta >= 0 ? '+' : '−'}${String(Math.abs(delta))}`;
};

/** Explicit content for the `?fixture=` visual demo. Never used as project history. */
export const competitionCandidateDetails: CandidateReviewDetails = {
  title: 'Warmer keys, wider guitar',
  changes: [
    {
      track: 'Piano',
      detail: `${competitionCandidatePianoPatch.instrument.from} → ${competitionCandidatePianoPatch.instrument.to}`,
    },
    {
      track: 'Piano',
      detail: `Brightness ${signedDelta(competitionCandidatePianoPatch.brightness.from, competitionCandidatePianoPatch.brightness.to)} · Reverb ${signedDelta(competitionCandidatePianoPatch.reverb.from, competitionCandidatePianoPatch.reverb.to)}`,
    },
    { track: 'Guitar', detail: 'Stronger chorus accents' },
    { track: 'Guitar', detail: 'Wider velocity contour' },
  ],
};
