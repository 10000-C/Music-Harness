import { CaretLeftIcon } from '@phosphor-icons/react/CaretLeft';
import { CaretRightIcon } from '@phosphor-icons/react/CaretRight';
import { PauseIcon } from '@phosphor-icons/react/Pause';
import { PlayIcon } from '@phosphor-icons/react/Play';
import { RepeatIcon } from '@phosphor-icons/react/Repeat';
import { StopIcon } from '@phosphor-icons/react/Stop';

interface TransportBarProps {
  readonly playing: boolean;
  readonly elapsedLabel: string;
  readonly durationLabel: string;
  readonly scopeLabel: string;
  readonly loopEnabled: boolean;
  readonly canLoop: boolean;
  readonly disabled?: boolean;
  readonly onTogglePlayback: () => void;
  readonly onStop: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onToggleLoop: () => void;
}

export const TransportBar = ({
  playing,
  elapsedLabel,
  durationLabel,
  scopeLabel,
  loopEnabled,
  canLoop,
  disabled = false,
  onTogglePlayback,
  onStop,
  onPrevious,
  onNext,
  onToggleLoop,
}: TransportBarProps) => (
  <div className="transport-bar" aria-label="Transport controls">
    <div className="transport-bar__controls">
      <button
        type="button"
        className="transport-bar__step"
        aria-label="Previous section"
        disabled={disabled}
        onClick={onPrevious}
      >
        <CaretLeftIcon size={16} weight="bold" />
      </button>
      <button
        type="button"
        className="transport-bar__step"
        aria-label="Stop and return to start"
        disabled={disabled}
        onClick={onStop}
      >
        <StopIcon size={12} weight="fill" />
      </button>
      <button
        type="button"
        className="transport-bar__play"
        aria-label={playing ? 'Pause' : 'Play'}
        aria-pressed={playing}
        disabled={disabled}
        onClick={onTogglePlayback}
      >
        {playing ? (
          <PauseIcon size={17} weight="fill" />
        ) : (
          <PlayIcon size={17} weight="fill" />
        )}
      </button>
      <button
        type="button"
        className="transport-bar__step"
        aria-label="Next section"
        disabled={disabled}
        onClick={onNext}
      >
        <CaretRightIcon size={16} weight="bold" />
      </button>
      <button
        type="button"
        className="transport-bar__step"
        aria-label={loopEnabled ? 'Disable loop' : 'Loop selected scope'}
        aria-pressed={loopEnabled}
        disabled={disabled || !canLoop}
        onClick={onToggleLoop}
      >
        <RepeatIcon size={15} weight={loopEnabled ? 'bold' : 'regular'} />
      </button>
    </div>
    <div className="transport-bar__time">
      <strong>{elapsedLabel}</strong>
      <small>/ {durationLabel}</small>
    </div>
    <div className="transport-bar__scope" title={scopeLabel}>
      {scopeLabel}
    </div>
  </div>
);
