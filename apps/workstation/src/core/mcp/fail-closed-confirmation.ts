import type {
  GenerationPlanConfirmationPort,
  ScopeExtensionConfirmationPort,
} from './music-core-tool-host.js';

/**
 * Fail-closed confirmation adapter for process compositions that have no
 * Renderer confirmation channel yet. Every confirmation request resolves
 * immediately as rejected, so plans never hang waiting for a human. The
 * B-side Renderer UI bridge replaces this by injecting its own ports; the
 * server code does not change.
 */
export const createFailClosedConfirmation = (): {
  readonly generationPlan: GenerationPlanConfirmationPort;
  readonly scopeExtension: ScopeExtensionConfirmationPort;
} => ({
  generationPlan: {
    request: () => Promise.resolve('rejected' as const),
  },
  scopeExtension: {
    request: () => Promise.resolve('rejected' as const),
  },
});
