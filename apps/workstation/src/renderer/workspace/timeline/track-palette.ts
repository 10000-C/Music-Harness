import type { TrackId } from '../../b-contracts/index.js';

export interface TrackPresentation {
  readonly label: string;
  readonly shortLabel: string;
  readonly color: string;
  readonly softColor: string;
}

export const trackPresentation: Readonly<Record<TrackId, TrackPresentation>> = {
  'track.drums': {
    label: 'Drums',
    shortLabel: 'D',
    color: '#ff6f7d',
    softColor: 'rgba(255, 111, 125, 0.48)',
  },
  'track.bass': {
    label: 'Bass',
    shortLabel: 'B',
    color: '#42d6b7',
    softColor: 'rgba(66, 214, 183, 0.46)',
  },
  'track.guitar': {
    label: 'Guitar',
    shortLabel: 'G',
    color: '#8a78ff',
    softColor: 'rgba(138, 120, 255, 0.5)',
  },
  'track.keys': {
    label: 'Piano',
    shortLabel: 'P',
    color: '#8b7cf6',
    softColor: 'rgba(139, 124, 246, 0.5)',
  },
  'track.strings': {
    label: 'Strings',
    shortLabel: 'S',
    color: '#dc6fb6',
    softColor: 'rgba(220, 111, 182, 0.48)',
  },
  'track.winds': {
    label: 'Winds',
    shortLabel: 'WD',
    color: '#f0a936',
    softColor: 'rgba(240, 169, 54, 0.5)',
  },
};
