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
    color: '#b65c68',
    softColor: 'rgba(182, 92, 104, 0.4)',
  },
  'track.bass': {
    label: 'Bass',
    shortLabel: 'B',
    color: '#5a9b8e',
    softColor: 'rgba(90, 155, 142, 0.4)',
  },
  'track.guitar': {
    label: 'Guitar',
    shortLabel: 'G',
    color: '#756e9c',
    softColor: 'rgba(117, 110, 156, 0.4)',
  },
  'track.keys': {
    label: 'Piano',
    shortLabel: 'P',
    color: '#6a668c',
    softColor: 'rgba(106, 102, 140, 0.4)',
  },
  'track.strings': {
    label: 'Strings',
    shortLabel: 'S',
    color: '#a9708f',
    softColor: 'rgba(169, 112, 143, 0.4)',
  },
  'track.winds': {
    label: 'Winds',
    shortLabel: 'WD',
    color: '#b38e5d',
    softColor: 'rgba(179, 142, 93, 0.4)',
  },
};
