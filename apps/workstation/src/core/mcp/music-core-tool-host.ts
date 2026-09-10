import type {
  ProjectId,
  TaskExecutionEnvelope,
  TaskId,
  TaskScope,
} from '@agent-music/contracts';

import type { TrackReplacement } from '../composition/index.js';
import type {
  CandidateAgentPort,
  CandidateControlPort,
} from '../candidate/index.js';

export const P0_MCP_TOOL_NAMES = [
  'getTaskContext',
  'getScopedComposition',
  'submitGenerationPlan',
  'requestScopeExtension',
  'replaceScopedMusic',
  'updateMusicalProperties',
  'finishTask',
] as const;

export type MusicCoreToolName = (typeof P0_MCP_TOOL_NAMES)[number];
export type GenerationPlanDecision = 'approved' | 'rejected' | 'cancelled';

export interface GenerationPlanConfirmationPort {
  request(input: {
    readonly projectId: ProjectId;
    readonly summary: string;
    readonly scope: TaskScope;
    readonly signal?: AbortSignal;
  }): Promise<GenerationPlanDecision>;
}

interface MusicCoreToolHostDependencies {
  readonly agent: CandidateAgentPort;
  readonly control: CandidateControlPort;
  readonly confirmation: GenerationPlanConfirmationPort;
}

interface GenerationPlanInput {
  readonly projectId: ProjectId;
  readonly summary: string;
  readonly scope: TaskScope;
}

interface ScopeExtensionInput {
  readonly envelope: TaskExecutionEnvelope;
  readonly requestedScope: TaskScope;
}

interface ReplaceScopedMusicInput {
  readonly envelope: TaskExecutionEnvelope;
  readonly replacements: readonly TrackReplacement[];
}

const isAborted = (signal?: AbortSignal): boolean => signal?.aborted === true;

interface UpdateMusicalPropertiesInput {
  readonly envelope: TaskExecutionEnvelope;
  readonly meter?: { readonly numerator: number; readonly denominator: number };
  readonly tempo?: { readonly bpm: number };
}

export class MusicCoreToolHost {
  public constructor(
    private readonly dependencies: MusicCoreToolHostDependencies,
  ) {}

  public listTools(): typeof P0_MCP_TOOL_NAMES {
    return P0_MCP_TOOL_NAMES;
  }

  public async call(
    name: MusicCoreToolName,
    input: unknown,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<unknown> {
    switch (name) {
      case 'getTaskContext': {
        const { taskId } = input as { readonly taskId: TaskId };
        return this.dependencies.agent.getTaskContext(taskId);
      }
      case 'getScopedComposition':
        return this.dependencies.agent.getScopedComposition(
          input as TaskExecutionEnvelope,
        );
      case 'submitGenerationPlan':
        return this.submitGenerationPlan(
          input as GenerationPlanInput,
          options.signal,
        );
      case 'requestScopeExtension':
        return this.dependencies.agent.requestScopeExtension(
          input as ScopeExtensionInput,
        );
      case 'replaceScopedMusic':
        return this.dependencies.agent.applyScopedMusicChange(
          input as ReplaceScopedMusicInput,
        );
      case 'updateMusicalProperties':
        return this.dependencies.agent.updateMusicalProperties(
          input as UpdateMusicalPropertiesInput,
        );
      case 'finishTask':
        return this.dependencies.agent.finishTask(
          input as TaskExecutionEnvelope,
        );
    }
  }

  private async submitGenerationPlan(
    input: GenerationPlanInput,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (isAborted(signal)) {
      return { approved: false, decision: 'cancelled' };
    }

    const decision = await this.waitForGenerationPlanDecision(input, signal);
    if (decision !== 'approved' || isAborted(signal)) {
      return {
        approved: false,
        decision: isAborted(signal) ? 'cancelled' : decision,
      };
    }

    const task = await this.dependencies.control.startTask({
      projectId: input.projectId,
      scope: input.scope,
    });
    return { approved: true, task };
  }

  private async waitForGenerationPlanDecision(
    input: GenerationPlanInput,
    signal?: AbortSignal,
  ): Promise<GenerationPlanDecision> {
    const confirmation = this.dependencies.confirmation.request({
      ...input,
      ...(signal === undefined ? {} : { signal }),
    });
    if (signal === undefined) {
      return confirmation;
    }

    return new Promise<GenerationPlanDecision>((resolve, reject) => {
      const onAbort = (): void => {
        resolve('cancelled');
      };
      signal.addEventListener('abort', onAbort, { once: true });
      confirmation.then(resolve, reject).finally(() => {
        signal.removeEventListener('abort', onAbort);
      });
    });
  }
}
