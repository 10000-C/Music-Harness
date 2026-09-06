import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/ArrowCounterClockwise';
import { DownloadSimpleIcon } from '@phosphor-icons/react/DownloadSimple';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/SlidersHorizontal';
import { WaveSineIcon } from '@phosphor-icons/react/WaveSine';
import { VinylRecordIcon } from '@phosphor-icons/react/VinylRecord';
import projectCover from '../assets/midnight-sketch.png';

export type WorkspaceView = 'studio' | 'export' | 'recovery' | 'settings';

interface ProjectSidebarProps {
  readonly activeView: WorkspaceView;
  readonly projectName: string;
  readonly currentLabel: string;
  readonly onViewChange: (view: WorkspaceView) => void;
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
  onViewChange,
}: ProjectSidebarProps) => (
  <aside className="project-sidebar" aria-label="Project navigation">
    <div className="brand-lockup">
      <span className="brand-lockup__mark" aria-hidden="true">
        <WaveSineIcon weight="bold" size={20} />
      </span>
      <span>
        <strong>MUSE</strong>
        <small>Agent Music</small>
      </span>
    </div>

    <div className="sidebar-section">
      <span className="sidebar-eyebrow">Project</span>
      <button
        type="button"
        className="project-card"
        onClick={() => {
          onViewChange('studio');
        }}
      >
        <img src={projectCover} alt="" />
        <span>
          <strong>{projectName}</strong>
          <small>{currentLabel}</small>
        </span>
      </button>
    </div>

    <nav className="sidebar-section sidebar-navigation" aria-label="Workspace">
      <span className="sidebar-eyebrow">Workspace</span>
      {navigation.map(({ view, label, icon: Icon }) => (
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

    <div className="workspace-profile">
      <span className="workspace-profile__avatar">L</span>
      <span>
        <strong>Local user</strong>
        <small>Local workspace</small>
      </span>
    </div>
  </aside>
);
