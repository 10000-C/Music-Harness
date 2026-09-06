import type {
  CoreBootstrapState,
  CoreEvent,
  RendererCommand,
} from '../b-contracts/index.js';
import type { WorkstationCoreClient } from '../core-client/workstation-core-client.js';
import {
  createWorkstationState,
  reduceWorkstationState,
  type WorkstationState,
} from './workstation-state.js';
import type { WorkstationUiAction } from './workstation-ui-state.js';

export type WorkstationStateListener = (state: WorkstationState) => void;

export interface WorkstationStore {
  getState(): WorkstationState;
  dispatch(action: WorkstationUiAction): void;
  execute(command: RendererCommand): Promise<void>;
  subscribe(listener: WorkstationStateListener): () => void;
  dispose(): void;
}

export interface ConnectWorkstationStoreOptions {
  readonly signal?: AbortSignal;
}

const CONNECTION_ABORTED_MESSAGE = 'Workstation store connection was aborted.';

const awaitBootstrapState = async (
  client: WorkstationCoreClient,
  signal: AbortSignal | undefined,
): Promise<CoreBootstrapState> => {
  if (signal?.aborted === true) {
    throw new Error(CONNECTION_ABORTED_MESSAGE);
  }

  const bootstrapState = client.getBootstrapState();
  if (signal === undefined) return bootstrapState;

  let onAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new Error(CONNECTION_ABORTED_MESSAGE));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    return await Promise.race([bootstrapState, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
};

const publishState = (
  listeners: ReadonlySet<WorkstationStateListener>,
  nextState: WorkstationState,
): void => {
  // New subscriptions begin with the next publication, while a listener
  // removed by an earlier callback is not invoked later in this publication.
  for (const listener of [...listeners]) {
    if (listeners.has(listener)) listener(nextState);
  }
};

/**
 * Connects the store without losing events that arrive while bootstrap is in
 * flight. The caller receives a ready store or the original bootstrap error.
 */
export const connectWorkstationStore = async (
  client: WorkstationCoreClient,
  options: ConnectWorkstationStoreOptions = {},
): Promise<WorkstationStore> => {
  const pendingEvents: CoreEvent[] = [];
  const listeners = new Set<WorkstationStateListener>();
  let state: WorkstationState | null = null;
  let disposed = false;

  const publishEvent = (event: CoreEvent): void => {
    if (disposed) return;
    if (state === null) {
      pendingEvents.push(event);
      return;
    }

    const nextState = reduceWorkstationState(state, {
      type: 'core/eventReceived',
      event,
    });
    if (nextState === state) return;

    state = nextState;
    publishState(listeners, nextState);
  };

  if (options.signal?.aborted === true) {
    throw new Error(CONNECTION_ABORTED_MESSAGE);
  }

  const unsubscribeFromCore = client.subscribe(publishEvent);

  try {
    state = createWorkstationState(
      await awaitBootstrapState(client, options.signal),
    );
    for (const event of pendingEvents) publishEvent(event);
    pendingEvents.length = 0;
  } catch (error) {
    disposed = true;
    pendingEvents.length = 0;
    unsubscribeFromCore();
    throw error;
  }

  const requireState = (): WorkstationState => {
    if (state === null) {
      throw new Error('Workstation store is not connected.');
    }
    return state;
  };

  return {
    getState: requireState,
    dispatch: (action) => {
      if (disposed) return;
      const currentState = requireState();
      const nextState = reduceWorkstationState(currentState, action);
      if (nextState === currentState) return;

      state = nextState;
      publishState(listeners, nextState);
    },
    execute: async (command) => {
      if (disposed) {
        throw new Error('Cannot execute a command after store disposal.');
      }
      await client.dispatch(command);
    },
    subscribe: (listener) => {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      pendingEvents.length = 0;
      unsubscribeFromCore();
    },
  };
};
