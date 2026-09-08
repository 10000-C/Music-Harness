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
  'updateGlobalMeter',
  'finishTask',
] as const;

export type MusicCoreToolName = (typeof P0_MCP_TOOL_NAMES)[number];
export type GenerationPlanDecision = 'approved' | 'rejected' | 'cancelled';

export interface GenerationPlanConfirmationPort {
  request(input: {
    readonly projectId: ProjectId;
    readonly summary: string;
    readonly scope: TaskScope;
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

interface UpdateGlobalMeterInput {
  readonly envelope: TaskExecutionEnvelope;
  readonly numerator: number;
  readonly denominator: number;
}

export class MusicCoreToolHost {
  public constructor(
    private readonly dependencies: MusicCoreToolHostDependencies,
  ) {}

  public listTools(): typeof P0_MCP_TOOL_NAMES {
    return P0_MCP_TOOL_NAMES;
  }

  public async call(name: MusicCoreToolName, input: unknown): Promise<unknown> {
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
        return this.submitGenerationPlan(input as GenerationPlanInput);
      case 'requestScopeExtension':
        return this.dependencies.agent.requestScopeExtension(
          input as ScopeExtensionInput,
        );
      case 'replaceScopedMusic':
        return this.dependencies.agent.applyScopedMusicChange(
          input as ReplaceScopedMusicInput,
        );
      case 'updateGlobalMeter':
        return this.dependencies.agent.updateGlobalMeter(
          input as UpdateGlobalMeterInput,
        );
      case 'finishTask':
        return this.dependencies.agent.finishTask(
          input as TaskExecutionEnvelope,
        );
    }
  }

  private async submitGenerationPlan(
    input: GenerationPlanInput,
  ): Promise<unknown> {
    const decision = await this.dependencies.confirmation.request(input);
    if (decision !== 'approved') {
      return { approved: false, decision };
    }

    const task = await this.dependencies.control.startTask({
      projectId: input.projectId,
      scope: input.scope,
    });
    return { approved: true, task };
  }
}
