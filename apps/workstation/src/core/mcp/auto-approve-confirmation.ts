import type {
  GenerationPlanConfirmationPort,
  ScopeExtensionConfirmationPort,
} from './music-core-tool-host.js';

/**
 * Temporary auto-approve confirmation adapter. Generation plans and scope
 * extensions resolve immediately as approved so Agent execution can continue
 * without a Renderer confirmation channel. Replaced by the B-side UI bridge
 * when that seam is wired.
 */
export const createAutoApproveConfirmation = (): {
  readonly generationPlan: GenerationPlanConfirmationPort;
  readonly scopeExtension: ScopeExtensionConfirmationPort;
} => ({
  generationPlan: {
    request: () => Promise.resolve('approved' as const),
  },
  scopeExtension: {
    request: () => Promise.resolve('approved' as const),
  },
});
