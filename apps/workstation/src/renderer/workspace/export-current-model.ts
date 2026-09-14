export type ExportCurrentFormat = 'abc' | 'midi' | 'wav';

export type ExportCurrentReadiness = 'unavailable' | 'preparing';

export interface ExportCurrentAvailabilityInput {
  readonly currentReady: boolean;
  readonly playbackInputReady: boolean;
}

export const getExportCurrentReadiness = ({
  currentReady,
  playbackInputReady,
}: ExportCurrentAvailabilityInput): ExportCurrentReadiness => {
  if (!currentReady || !playbackInputReady) return 'unavailable';
  // A5 is intentionally the only authority that can make an export runnable.
  return 'preparing';
};

export const exportCurrentFormatLabel = (format: ExportCurrentFormat): string =>
  format.toUpperCase();

export const exportCurrentSuggestedName = (
  projectName: string,
  format: ExportCurrentFormat,
): string => {
  const stem = projectName.trim().replace(/[<>:"/\\|?*]/gu, '') || 'untitled';
  return `${stem}.${format}`;
};
