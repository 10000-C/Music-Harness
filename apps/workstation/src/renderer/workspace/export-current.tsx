import {
  ArrowRightIcon,
  CheckCircleIcon,
  FileAudioIcon,
  FileTextIcon,
  LockKeyIcon,
} from '@phosphor-icons/react';
import {
  exportCurrentFormatLabel,
  exportCurrentSuggestedName,
  getExportCurrentReadiness,
  type ExportCurrentFormat,
} from './export-current-model.js';

export type ExportDeliveryState = 'preparing' | 'exporting' | 'completed' | 'failed' | 'cancelled';

interface ExportCurrentViewProps {
  readonly projectName: string;
  readonly currentRevision: string | null;
  readonly currentReady: boolean;
  readonly playbackInputReady: boolean;
  readonly selectedPaths: Readonly<
    Partial<Record<ExportCurrentFormat, string>>
  >;
  readonly exportStates?: Readonly<
    Partial<Record<ExportCurrentFormat, ExportDeliveryState>>
  >;
  readonly onChoosePath: (format: ExportCurrentFormat) => void;
  readonly onStartExport?: (format: ExportCurrentFormat) => void;
}

const FORMATS: ReadonlyArray<{
  readonly format: ExportCurrentFormat;
  readonly title: string;
  readonly detail: string;
  readonly icon: typeof FileAudioIcon;
}> = [
  {
    format: 'midi',
    title: 'Standard MIDI',
    detail: 'Six-track MIDI with tempo and meter preserved.',
    icon: FileTextIcon,
  },
  {
    format: 'wav',
    title: 'Full mix WAV',
    detail: 'A finished offline render with its tail intact.',
    icon: FileAudioIcon,
  },
];

export const ExportCurrentView = ({
  projectName,
  currentRevision,
  currentReady,
  playbackInputReady,
  selectedPaths,
  exportStates = {},
  onChoosePath,
  onStartExport,
}: ExportCurrentViewProps) => {
  const readiness = getExportCurrentReadiness({
    currentReady,
    playbackInputReady,
  });
  const sourceLabel = currentRevision
    ? `Current ${currentRevision.slice(0, 8)}`
    : 'Current unavailable';
  const inputDescription = !currentReady
    ? 'Open a saved Current to prepare export inputs.'
    : !playbackInputReady
      ? 'Current is saved, but its playback input is still preparing.'
      : 'Export is ready. Choose a destination to save your arrangement.';

  return (
    <section className="export-current" aria-labelledby="export-current-title">
      <div className="export-current__intro">
        <span className="utility-view__eyebrow">Delivery</span>
        <h1 id="export-current-title">Export Current</h1>
        <p>
          Choose a format for the saved arrangement. Candidate work is never
          included in a formal export.
        </p>
      </div>

      <div className="export-current__source" aria-label="Export source">
        <div>
          <span className="export-current__source-label">Source</span>
          <strong>{sourceLabel}</strong>
        </div>
        <span
          className="export-current__source-status"
          data-state={currentReady ? 'ready' : 'unavailable'}
        >
          <CheckCircleIcon size={15} weight="fill" aria-hidden="true" />
          {currentReady ? 'Current only' : 'Waiting for Current'}
        </span>
      </div>

      <div
        className="export-current__notice"
        data-state={readiness}
        role="status"
      >
        <LockKeyIcon size={17} weight="duotone" aria-hidden="true" />
        <div>
          <strong>
            {readiness === 'preparing'
              ? 'Export preparation is coming next'
              : 'Export is waiting for Current'}
          </strong>
          <p>{inputDescription}</p>
        </div>
      </div>

      <div className="export-current__formats">
        {FORMATS.map(({ format, title, detail, icon: Icon }) => {
          const selectedPath = selectedPaths[format];
          const canChoosePath = currentReady && playbackInputReady;
          const status = exportStates[format];
          const isBusy = status === 'preparing' || status === 'exporting';
          
          return (
            <article className="export-current__format" key={format}>
              <div className="export-current__format-icon" data-format={format}>
                <Icon size={21} weight="duotone" aria-hidden="true" />
              </div>
              <div className="export-current__format-copy">
                <span>{exportCurrentFormatLabel(format)}</span>
                <h2>{title}</h2>
                <p>{detail}</p>
                {status !== undefined && (
                  <p className={`export-status export-status--${status}`} style={{ marginTop: '8px', fontSize: '11px', fontWeight: 'bold' }}>
                    Status: {status.charAt(0).toUpperCase() + status.slice(1)}
                  </p>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button
                  type="button"
                  className="export-current__choose"
                  disabled={!canChoosePath || isBusy}
                  onClick={() => {
                    onChoosePath(format);
                  }}
                >
                  {selectedPath === undefined
                    ? 'Choose destination'
                    : 'Change destination'}
                  <ArrowRightIcon size={15} aria-hidden="true" />
                </button>
                {selectedPath !== undefined && onStartExport !== undefined && (
                  <button
                    type="button"
                    className="primary-action"
                    disabled={isBusy}
                    onClick={() => {
                      onStartExport(format);
                    }}
                  >
                    Start Export
                  </button>
                )}
              </div>
              <small className="export-current__path" title={selectedPath}>
                {selectedPath ??
                  `Suggested: ${exportCurrentSuggestedName(projectName, format)}`}
              </small>
            </article>
          );
        })}
      </div>
    </section>
  );
};
