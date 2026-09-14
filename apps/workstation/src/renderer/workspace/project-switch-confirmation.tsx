import type { ProjectId } from '@agent-music/contracts';

interface ProjectSwitchConfirmationProps {
  readonly source: ProjectId | null;
  readonly target: string;
  readonly sourceName?: string;
  readonly targetName?: string;
  readonly canSuspend?: boolean;
  readonly activeExecution: boolean;
  readonly activeTask: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export const ProjectSwitchConfirmation = ({
  source,
  target,
  sourceName,
  targetName,
  canSuspend = false,
  activeExecution,
  activeTask,
  onConfirm,
  onCancel,
}: ProjectSwitchConfirmationProps) => {
  const hasActiveWork = activeExecution || activeTask;
  const resolvedSourceName =
    sourceName ?? (source !== null ? String(source) : 'Current Project');
  const resolvedTargetName = targetName ?? target;

  return (
    <div
      className="workstation-modal-overlay"
      data-source-project={source ?? undefined}
      data-target-project={target}
    >
      <section
        className="settings-dialog"
        role="alertdialog"
        aria-labelledby="switch-dialog-title"
        aria-describedby="switch-dialog-description"
      >
        <header className="settings-dialog__header">
          <div>
            <span className="settings-dialog__eyebrow">
              Switching Workspace
            </span>
            <h2 id="switch-dialog-title">Switch Project?</h2>
          </div>
        </header>
        <p
          className="settings-dialog__description"
          id="switch-dialog-description"
        >
          {hasActiveWork
            ? canSuspend
              ? 'There is an active Agent or Task running in your current project. Switching projects will suspend the active work.'
              : 'There is an active Agent or Task running in your current project. Switching projects will cancel the active work in progress.'
            : 'Are you sure you want to open another project?'}
        </p>
        <div className="confirmation-dialog__details">
          <div className="confirmation-dialog__detail-row">
            <span className="confirmation-dialog__label">From:</span>
            <span className="confirmation-dialog__value">
              {resolvedSourceName}
            </span>
          </div>
          <div className="confirmation-dialog__detail-row">
            <span className="confirmation-dialog__label">To:</span>
            <span className="confirmation-dialog__value">
              {resolvedTargetName}
            </span>
          </div>
        </div>
        <footer
          className="settings-dialog__actions"
          style={{ marginTop: '24px' }}
        >
          <button type="button" className="ghost-action" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={hasActiveWork ? 'destructive-action' : 'primary-action'}
            onClick={onConfirm}
          >
            {hasActiveWork
              ? canSuspend
                ? 'Switch & Suspend'
                : 'Switch & Cancel Work'
              : 'Switch Project'}
          </button>
        </footer>
      </section>
    </div>
  );
};
