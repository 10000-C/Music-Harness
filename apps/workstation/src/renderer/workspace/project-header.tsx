import { CaretLeftIcon } from '@phosphor-icons/react/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/CaretRight';
import { PauseIcon } from '@phosphor-icons/react/Pause';
import { PlayIcon } from '@phosphor-icons/react/Play';
import { RepeatIcon } from '@phosphor-icons/react/Repeat';
import { StopIcon } from '@phosphor-icons/react/Stop';

export type ProjectStatusTone = 'stable' | 'blank' | 'working' | 'warning';

export interface MasterTransportProps {
  readonly playing: boolean;
  readonly playDisabled: boolean;
  readonly elapsedLabel?: string;
  readonly durationLabel?: string;
  readonly tempo: number;
  readonly meter: string;
  readonly keyName?: string;
  readonly loopEnabled?: boolean;
  readonly canLoop?: boolean;
  readonly onTogglePlayback: () => void;
  readonly onStop?: () => void;
  readonly onPrevious?: () => void;
  readonly onNext?: () => void;
  readonly onToggleLoop?: () => void;
}

export interface ProjectHeaderProps {
  readonly projectName: string;
  readonly projectOpen?: boolean;
  readonly statusLabel: string;
  readonly statusTone: ProjectStatusTone;
  readonly onExport: () => void;
  readonly transport?: MasterTransportProps;
  // Legacy / fallback props
  readonly tempo?: number;
  readonly keyName?: string;
  readonly meter?: string;
  readonly playing?: boolean;
  readonly playDisabled?: boolean;
  readonly onTogglePlayback?: () => void;
}

const noopTogglePlayback = (): void => {
  // Legacy callers may omit transport controls while the project is loading.
};

export const ProjectHeader = ({
  projectName,
  projectOpen = true,
  statusLabel,
  statusTone,
  onExport,
  transport,
  tempo = 120,
  keyName = 'C',
  meter = '4/4',
  playing = false,
  playDisabled = false,
  onTogglePlayback = noopTogglePlayback,
}: ProjectHeaderProps) => {
  const t: MasterTransportProps = transport ?? {
    tempo,
    keyName,
    meter,
    playing,
    playDisabled,
    onTogglePlayback,
  };

  return (
    <header className="project-header" data-project-open={projectOpen}>
      <div className="project-header__brand">
        <strong>Music Harness</strong>
        <span title={projectName}>{projectName}</span>
      </div>
      {projectOpen ? (
        <>
          <div
            className="master-transport-island"
            aria-label="Master Transport"
          >
            {/* Step back & Stop */}
            <div className="master-transport-island__cluster">
              {t.onPrevious && (
                <button
                  type="button"
                  className="master-transport-island__btn"
                  aria-label="Previous section"
                  disabled={t.playDisabled}
                  onClick={t.onPrevious}
                >
                  <CaretLeftIcon size={14} weight="bold" />
                </button>
              )}
              {t.onStop && (
                <button
                  type="button"
                  className="master-transport-island__btn"
                  aria-label="Stop playback"
                  disabled={t.playDisabled}
                  onClick={t.onStop}
                >
                  <StopIcon size={11} weight="fill" />
                </button>
              )}
            </div>

            {/* The One True Play Button: Luminous Orb */}
            <button
              className="master-transport-island__play"
              type="button"
              disabled={t.playDisabled}
              aria-label={t.playing ? 'Pause' : 'Play'}
              aria-pressed={t.playing}
              onClick={t.onTogglePlayback}
            >
              {t.playing ? (
                <PauseIcon size={16} weight="fill" />
              ) : (
                <PlayIcon size={16} weight="fill" />
              )}
            </button>

            {/* Step next & Loop */}
            <div className="master-transport-island__cluster">
              {t.onNext && (
                <button
                  type="button"
                  className="master-transport-island__btn"
                  aria-label="Next section"
                  disabled={t.playDisabled}
                  onClick={t.onNext}
                >
                  <CaretRightIcon size={14} weight="bold" />
                </button>
              )}
              {t.onToggleLoop && (
                <button
                  type="button"
                  className={`master-transport-island__btn ${t.loopEnabled ? 'is-active' : ''}`}
                  aria-label={
                    t.loopEnabled ? 'Disable loop' : 'Loop selected scope'
                  }
                  aria-pressed={t.loopEnabled}
                  disabled={t.playDisabled || !t.canLoop}
                  onClick={t.onToggleLoop}
                >
                  <RepeatIcon
                    size={13}
                    weight={t.loopEnabled ? 'bold' : 'regular'}
                  />
                </button>
              )}
            </div>

            <div className="master-transport-island__divider" />

            {/* Time readout & Tempo/Meter */}
            <div className="master-transport-island__readout">
              {t.elapsedLabel && t.durationLabel ? (
                <div className="master-transport-island__time">
                  <strong>{t.elapsedLabel}</strong>
                  <small>/ {t.durationLabel}</small>
                </div>
              ) : null}
              <div className="master-transport-island__metric">
                <span
                  className={`master-transport-island__beat ${t.playing ? 'is-beating' : ''}`}
                  title="Beat pulse"
                />
                <span className="master-transport-island__bpm">
                  {t.tempo} BPM
                </span>
                <span className="master-transport-island__meter">
                  {t.meter}
                </span>
              </div>
            </div>
          </div>

          <div className="project-header__actions">
            <span data-tone={statusTone}>{statusLabel}</span>
            <button type="button" onClick={onExport}>
              Export
            </button>
          </div>
        </>
      ) : null}
    </header>
  );
};
