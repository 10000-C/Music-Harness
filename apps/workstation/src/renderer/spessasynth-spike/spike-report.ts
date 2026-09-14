import type {
  SpikeMidiEvidence,
  SpikeSoundFontEvidence,
} from './spike-fixtures.js';

export type SpessaSynthSpikeStatus = 'running' | 'passed' | 'failed';

export type SpessaSynthSpikePhase =
  | 'boot'
  | 'midi'
  | 'soundfont'
  | 'audio-worklet'
  | 'controls'
  | 'playback'
  | 'adapter'
  | 'cleanup'
  | 'complete';

export interface SpessaSynthSpikeCheck {
  readonly id: string;
  readonly status: 'passed' | 'failed';
  readonly detail: string;
}

export interface SpessaSynthRuntimeEvidence {
  readonly audioContextState: AudioContextState;
  readonly analyserPeak: number;
  readonly editedAnalyserPeak: number;
  readonly maxVoiceCount: number;
  readonly channelVoiceCounts: readonly number[];
  readonly switchedPrograms: readonly number[];
  readonly channelGain: number;
  readonly channelPan: number;
  readonly controllers: Readonly<Record<string, number>>;
  readonly muteTransition: readonly [boolean, boolean];
  readonly originalPlaybackSeconds: number;
  readonly editedPlaybackSeconds: number;
  readonly adapterAnalyserPeak: number;
  readonly adapterMutedPeak: number;
  readonly adapterSoloPeak: number;
  readonly adapterPositionTick: number;
  readonly adapterLoopPositionTick: number;
  readonly adapterDisposed: boolean;
}

export interface SpessaSynthSpikeReport {
  readonly schemaVersion: 1;
  readonly mode: 'generated' | 'imported';
  readonly status: SpessaSynthSpikeStatus;
  readonly phase: SpessaSynthSpikePhase;
  readonly checks: readonly SpessaSynthSpikeCheck[];
  readonly midi?: SpikeMidiEvidence;
  readonly editedMidi?: SpikeMidiEvidence;
  readonly soundFont?: SpikeSoundFontEvidence;
  readonly runtime?: SpessaSynthRuntimeEvidence;
  readonly error?: string;
}

export const createRunningSpikeReport = (
  mode: SpessaSynthSpikeReport['mode'],
): SpessaSynthSpikeReport => ({
  schemaVersion: 1,
  mode,
  status: 'running',
  phase: 'boot',
  checks: [],
});

export const normalizeSpikeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);
