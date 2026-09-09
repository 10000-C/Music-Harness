export type ProjectStatusTone = 'stable' | 'blank' | 'working' | 'warning';

interface ProjectHeaderProps {
  readonly projectName: string;
  readonly tempo: number;
  readonly keyName: string;
  readonly meter: string;
  readonly statusLabel: string;
  readonly statusTone: ProjectStatusTone;
  readonly playing: boolean;
  readonly playDisabled: boolean;
  readonly onTogglePlayback: () => void;
  readonly onExport: () => void;
}

export const ProjectHeader = ({
  projectName,
  tempo,
  keyName,
  meter,
  statusLabel,
  statusTone,
  playing,
  playDisabled,
  onTogglePlayback,
  onExport,
}: ProjectHeaderProps) => (
  <header className="project-header">
    <div className="project-header__brand">
      <strong>AMW</strong>
      <span title={projectName}>{projectName}</span>
    </div>
    <div className="project-header__transport" aria-label="Transport">
      <button
        className="project-header__play"
        type="button"
        disabled={playDisabled}
        aria-label={playing ? 'Pause playback' : 'Play Current'}
        aria-pressed={playing}
        onClick={onTogglePlayback}
      >
        {playing ? 'Ⅱ' : '▶'}
      </button>
      <span>{tempo} BPM</span>
      <i />
      <span>{meter}</span>
      <span className="sr-only">{keyName}</span>
    </div>
    <div className="project-header__actions">
      <span data-tone={statusTone}>{statusLabel}</span>
      <button type="button" onClick={onExport}>
        Export
      </button>
    </div>
  </header>
);
