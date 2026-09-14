import { CheckCircleIcon } from '@phosphor-icons/react/CheckCircle';
import { useEffect, useRef } from 'react';
import { getTrappedTabIndex } from './a11y-keyboard.js';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusableElements = (container: HTMLElement): readonly HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.hidden &&
      element.getAttribute('aria-hidden') !== 'true',
  );

interface ConfirmationDialogProps {
  readonly open: boolean;
  readonly blankCurrent: boolean;
  readonly confirmDisabled: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export const ConfirmationDialog = ({
  open,
  blankCurrent,
  confirmDisabled,
  onCancel,
  onConfirm,
}: ConfirmationDialogProps) => {
  const dialog = useRef<HTMLElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const cancelCallback = useRef(onCancel);

  useEffect(() => {
    cancelCallback.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    if (!open) return undefined;
    previousFocus.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const focusInsideDialog = (): void => {
      const dialogElement = dialog.current;
      if (dialogElement === null) return;
      const focusableElements = getFocusableElements(dialogElement);
      const preferredElement =
        confirmButton.current?.disabled === false
          ? confirmButton.current
          : focusableElements[0];
      (preferredElement ?? dialogElement).focus();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cancelCallback.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const dialogElement = dialog.current;
      if (dialogElement === null) return;
      const focusableElements = getFocusableElements(dialogElement);
      event.preventDefault();
      if (focusableElements.length === 0) {
        dialogElement.focus();
        return;
      }

      const currentIndex = focusableElements.findIndex(
        (element) => element === document.activeElement,
      );
      const nextIndex = getTrappedTabIndex(
        currentIndex,
        focusableElements.length,
        event.shiftKey,
      );
      focusableElements[nextIndex]?.focus();
    };
    const onFocusIn = (event: FocusEvent): void => {
      const dialogElement = dialog.current;
      if (
        dialogElement !== null &&
        event.target instanceof Node &&
        !dialogElement.contains(event.target)
      ) {
        focusInsideDialog();
      }
    };
    const frame = window.requestAnimationFrame(focusInsideDialog);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('focusin', onFocusIn);
      if (previousFocus.current?.isConnected === true) {
        previousFocus.current.focus();
      }
      previousFocus.current = null;
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="confirmation-backdrop"
      role="presentation"
      onMouseDown={onCancel}
    >
      <section
        ref={dialog}
        className="confirmation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-description confirmation-safety"
        tabIndex={-1}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
      >
        <span className="confirmation-dialog__eyebrow">Confirmation</span>
        <h2 id="confirmation-title">
          {blankCurrent
            ? 'Create the first Candidate?'
            : 'Create this Candidate?'}
        </h2>
        <p id="confirmation-description">
          The Agent will create an arrangement from the confirmed plan and
          selected scope.
        </p>
        <div id="confirmation-safety" className="confirmation-dialog__safety">
          <CheckCircleIcon size={34} weight="fill" aria-hidden="true" />
          <span>
            <strong>Current remains safe</strong>
            <small>
              {blankCurrent ? 'The blank Current' : 'Your current arrangement'}{' '}
              stays unchanged until you accept the Candidate.
            </small>
          </span>
        </div>
        <footer>
          <button type="button" className="secondary-action" onClick={onCancel}>
            Edit plan
          </button>
          <button
            ref={confirmButton}
            type="button"
            className="primary-action"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            Create Candidate
          </button>
        </footer>
      </section>
    </div>
  );
};
