import { CheckCircleIcon } from '@phosphor-icons/react/CheckCircle';
import { CirclesFourIcon } from '@phosphor-icons/react/CirclesFour';
import type { CoreBootstrapState } from '../b-contracts/index.js';
import {
  currentSafetyMessage,
  selectWorkstationError,
} from './workstation-alert-model.js';

interface StatusStripProps {
  readonly state: CoreBootstrapState;
  readonly scopeLabel: string;
  readonly blankCurrentOverride: boolean;
}

export const StatusStrip = ({
  state,
  scopeLabel,
  blankCurrentOverride,
}: StatusStripProps) => {
  const isBlank = blankCurrentOverride;
  const busy =
    state.task.status === 'active' && state.task.stage !== 'candidate_ready';
  const candidate = state.candidate.status === 'ready';
  const structuredError = selectWorkstationError(state);
  const title = structuredError
    ? structuredError.title
    : busy
      ? 'Candidate remains separate from Current'
      : candidate
        ? 'Candidate is ready for listening review'
        : isBlank
          ? 'Blank Current'
          : 'Current is stable and ready';

  return (
    <footer className="status-strip">
      <span className="status-strip__icon">
        {structuredError !== null || busy || candidate ? (
          <CirclesFourIcon size={18} weight="fill" />
        ) : (
          <CheckCircleIcon size={19} weight="fill" />
        )}
      </span>
      <span className="status-strip__message">
        <strong>{title}</strong>
        <small>
          {structuredError
            ? currentSafetyMessage(structuredError.currentSafety)
            : isBlank
              ? 'This empty Current is saved and recoverable.'
              : `Selected scope: ${scopeLabel}`}
        </small>
      </span>
      <span className="status-strip__shortcuts">
        <kbd>Space</kbd> Play / pause <i>·</i> <kbd>Esc</kbd> Clear selection
      </span>
    </footer>
  );
};
