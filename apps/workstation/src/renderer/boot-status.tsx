import type { ServiceFleetSnapshot } from '../shared/service-status.js';
export const BootStatus = ({
  snapshot,
  restart,
}: {
  snapshot: ServiceFleetSnapshot;
  restart: (service: 'core' | 'agent') => void;
}) => (
  <main>
    <h1>Music Harness</h1>
    <p>Main: running</p>
    {(['core', 'agent'] as const).map((service) => (
      <section key={service}>
        <strong>{service}</strong>: {snapshot[service]}
        {(['degraded', 'failed'] as string[]).includes(snapshot[service]) && (
          <button
            onClick={() => {
              restart(service);
            }}
          >
            Restart
          </button>
        )}
      </section>
    ))}
  </main>
);
