import type { ServiceKind, StructuredUiError } from '../b-contracts/index.js';
import { useState, type ReactElement } from 'react';
import type { ServiceFleetSnapshot } from '../../shared/service-status.js';
import {
  candidateAvailabilityMessage,
  currentSafetyMessage,
  restartableServices,
  restartDesktopServiceSafely,
  serviceLabel,
  type RestartDesktopService,
  type ServiceRestartFeedback,
} from './workstation-alert-model.js';

export const StructuredErrorNotice = ({
  error,
}: {
  readonly error: StructuredUiError;
}): ReactElement => (
  <section
    className="structured-error-notice"
    role="alert"
    aria-labelledby="workstation-error-title"
  >
    <header>
      <span>Action required</span>
      <strong id="workstation-error-title">{error.title}</strong>
      <small>{error.code}</small>
    </header>
    <p>{error.message}</p>
    <dl>
      <div>
        <dt>Current</dt>
        <dd>{currentSafetyMessage(error.currentSafety)}</dd>
      </div>
      <div>
        <dt>Candidate</dt>
        <dd>{candidateAvailabilityMessage(error.candidateAvailability)}</dd>
      </div>
    </dl>
    <footer>
      <strong>Next step</strong>
      <span>{error.nextAction}</span>
    </footer>
  </section>
);

export const ServiceHealthNotice = ({
  snapshot,
  restart,
}: {
  readonly snapshot: ServiceFleetSnapshot;
  readonly restart: RestartDesktopService;
}): ReactElement | null => {
  const [pending, setPending] = useState<ReadonlySet<ServiceKind>>(
    () => new Set(),
  );
  const [feedback, setFeedback] = useState<
    Partial<Readonly<Record<ServiceKind, ServiceRestartFeedback>>>
  >({});
  const services = restartableServices(snapshot);
  if (services.length === 0) return null;

  const requestRestart = (service: ServiceKind): void => {
    setPending((current) => new Set(current).add(service));
    void restartDesktopServiceSafely(restart, service).then((result) => {
      setPending((current) => {
        const next = new Set(current);
        next.delete(service);
        return next;
      });
      setFeedback((current) => ({ ...current, [service]: result }));
    });
  };

  return (
    <section
      className="service-health-notice"
      aria-labelledby="service-health-title"
      aria-live="polite"
    >
      <header>
        <strong id="service-health-title">
          Desktop service needs attention
        </strong>
        <small>Restarting a service does not modify the saved Current.</small>
      </header>
      <div className="service-health-notice__services">
        {services.map((service) => {
          const label = serviceLabel(service);
          const result = feedback[service];
          return (
            <div className="service-health-notice__service" key={service}>
              <span>
                <strong>{label}</strong>
                <small data-tone={snapshot[service]}>{snapshot[service]}</small>
              </span>
              <button
                type="button"
                className="secondary-action"
                disabled={pending.has(service)}
                onClick={() => {
                  requestRestart(service);
                }}
              >
                {pending.has(service) ? 'Restarting…' : `Restart ${label}`}
              </button>
              {result !== undefined && (
                <p
                  data-tone={result.tone}
                  role={result.tone === 'error' ? 'alert' : 'status'}
                >
                  {result.message}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
