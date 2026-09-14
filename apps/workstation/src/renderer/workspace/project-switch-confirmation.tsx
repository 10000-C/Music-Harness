import type { ProjectId } from '@agent-music/contracts';

interface ProjectSwitchConfirmationProps {
  readonly source: ProjectId | null;
  readonly target: string;
  readonly activeExecution: boolean;
  readonly activeTask: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

export const ProjectSwitchConfirmation = ({
  source,
  target,
  activeExecution,
  activeTask,
  onConfirm,
  onCancel,
}: ProjectSwitchConfirmationProps) => (
  <div
    className="workstation-modal-overlay"
    data-source-project={source ?? undefined}
    data-target-project={target}
  >
    <section
      className="confirmation-dialog"
      role="alertdialog"
      aria-labelledby="switch-dialog-title"
      aria-describedby="switch-dialog-description"
    >
      <div className="confirmation-dialog__content">
        <h2 id="switch-dialog-title">Switch Project?</h2>
        <p id="switch-dialog-description">
          {activeExecution || activeTask
            ? 'There is an active Agent or Task running in your current project. Switching projects will suspend or lose the active work.'
            : 'Are you sure you want to open another project?'}
        </p>
      </div>
      <div className="confirmation-dialog__actions">
        <button type="button" className="ghost-action" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={activeExecution || activeTask ? 'destructive-action' : 'primary-action'}
          onClick={onConfirm}
        >
          {activeExecution || activeTask ? 'Switch & Suspend' : 'Switch Project'}
        </button>
      </div>
    </section>
  </div>
);
