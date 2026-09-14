import { useEffect, useState } from 'react';
import {
  FakeWorkstationCoreClient,
  getFakeCoreFixture,
  type FakeCoreFixtureName,
} from '../core-client/index.js';
import {
  connectWorkstationStore,
  type WorkstationState,
  type WorkstationStore,
} from './index.js';

export interface WorkstationDemoConnection {
  readonly state: WorkstationState | null;
  readonly store: WorkstationStore | null;
  readonly error: Error | null;
}

export const useWorkstationDemo = (
  fixtureName: FakeCoreFixtureName,
): WorkstationDemoConnection => {
  const [connection, setConnection] = useState<WorkstationDemoConnection>({
    state: null,
    store: null,
    error: null,
  });

  useEffect(() => {
    let active = true;
    let connectedStore: WorkstationStore | null = null;
    let unsubscribeFromStore: (() => void) | null = null;
    const abortController = new AbortController();
    const client = new FakeWorkstationCoreClient(
      getFakeCoreFixture(fixtureName),
    );

    setConnection({ state: null, store: null, error: null });

    void connectWorkstationStore(client, { signal: abortController.signal })
      .then((store) => {
        if (!active) {
          store.dispose();
          return;
        }
        connectedStore = store;
        setConnection({ state: store.getState(), store, error: null });
        unsubscribeFromStore = store.subscribe((state) => {
          if (active) setConnection((current) => ({ ...current, state }));
        });
      })
      .catch((error: unknown) => {
        if (active)
          setConnection({
            state: null,
            store: null,
            error:
              error instanceof Error
                ? error
                : new Error('The workstation could not be opened.'),
          });
      });

    return () => {
      active = false;
      abortController.abort();
      unsubscribeFromStore?.();
      connectedStore?.dispose();
    };
  }, [fixtureName]);

  return connection;
};
