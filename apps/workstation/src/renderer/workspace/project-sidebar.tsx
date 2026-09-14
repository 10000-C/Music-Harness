import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/ArrowCounterClockwise';
import { CaretUpDownIcon } from '@phosphor-icons/react/CaretUpDown';
import { DownloadSimpleIcon } from '@phosphor-icons/react/DownloadSimple';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/SlidersHorizontal';
import logoImg from '../logo.png';
import { VinylRecordIcon } from '@phosphor-icons/react/VinylRecord';
import projectCover from '../assets/midnight-sketch.png';
import { GearSixIcon } from '@phosphor-icons/react/dist/csr/GearSix';

export type WorkspaceView = 'studio' | 'export' | 'recovery' | 'settings';

interface ProjectSidebarProps {
  readonly activeView: WorkspaceView;
  readonly projectName: string;
  readonly currentLabel: string;
  readonly projectOpen?: boolean;
  readonly busy?: boolean;
  readonly isSettingsConfigured?: boolean;
  readonly onViewChange: (view: WorkspaceView) => void;
  readonly onSwitchProject?: () => void;
  readonly onOpenSettings?: () => void;
  /** Hide routes whose product surface has not reached the live shell yet. */
  readonly availableViews?: readonly WorkspaceView[];
}

const navigation = [
  { view: 'studio', label: 'Studio', icon: VinylRecordIcon },
  { view: 'export', label: 'Export Current', icon: DownloadSimpleIcon },
  { view: 'recovery', label: 'Recovery', icon: ArrowCounterClockwiseIcon },
  { view: 'settings', label: 'Settings', icon: SlidersHorizontalIcon },
] as const;

export const ProjectSidebar = ({
  activeView,
  projectName,
  currentLabel,
  projectOpen = true,
  busy = false,
  isSettingsConfigured = false,
  onViewChange,
  onSwitchProject,
  onOpenSettings,
  availableViews,
}: ProjectSidebarProps) => (
  <aside className="project-sidebar" aria-label="Project navigation">
    <div className="brand-lockup">
      <span className="brand-lockup__mark" aria-hidden="true">
        <img src={logoImg} alt="" className="brand-lockup__logo" />
      </span>
      <span>
        <strong>Music Harness</strong>
      </span>
    </div>

    {projectOpen && (
      <div className="sidebar-section">
        <span className="sidebar-eyebrow">Project</span>
        <button
          type="button"
          className="project-card"
          disabled={busy}
          onClick={() => {
            if (onSwitchProject) {
              onSwitchProject();
            } else {
              onViewChange('studio');
            }
          }}
          title="Switch or open project"
          aria-label={`Switch project: ${projectName}`}
        >
          <img src={projectCover} alt="" width={48} height={48} />
          <span className="project-card__info">
            <strong>{projectName}</strong>
            <small>{currentLabel}</small>
          </span>
          <span className="project-card__action" aria-hidden="true">
            <CaretUpDownIcon size={14} weight="bold" />
          </span>
        </button>
      </div>
    )}

    <nav className="sidebar-section sidebar-navigation" aria-label="Workspace">
      <span className="sidebar-eyebrow">Workspace</span>
      {navigation
        .filter(({ view }) => availableViews?.includes(view) ?? true)
        .map(({ view, label, icon: Icon }) => (
          <button
            type="button"
            key={view}
            className="sidebar-navigation__item"
            data-active={activeView === view ? 'true' : 'false'}
            aria-current={activeView === view ? 'page' : undefined}
            onClick={() => {
              onViewChange(view);
            }}
          >
            <Icon size={16} weight={activeView === view ? 'fill' : 'regular'} />
            <span>{label}</span>
          </button>
        ))}
    </nav>

    <button
      type="button"
      className="workspace-settings-trigger"
      onClick={onOpenSettings}
    >
      <span className="workspace-settings-trigger__icon">
        <GearSixIcon size={18} weight="duotone" />
      </span>
      <span className="workspace-settings-trigger__info">
        <strong>Settings</strong>
        <small>
          {isSettingsConfigured ? 'Agent configured' : 'API Key required'}
        </small>
      </span>
      <div
        className={`workspace-settings-trigger__status ${
          isSettingsConfigured
            ? 'workspace-settings-trigger__status--ready'
            : 'workspace-settings-trigger__status--missing'
        }`}
        title={isSettingsConfigured ? 'Agent is ready' : 'API Key is missing'}
      />
    </button>
  </aside>
);
