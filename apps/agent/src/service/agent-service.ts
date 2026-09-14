import type {
  AgentCommand,
  AgentCommandResult,
  AgentConversationMessage,
  AgentEvent,
  AgentExecutionId,
  AgentSessionId,
  AgentSessionSummary,
  ProjectId,
} from '@agent-music/contracts';

import type {
  AgentEventSink,
  StartAgentExecutionInput,
} from '../workflow/index.js';

export type AgentServiceErrorCode =
  | 'SESSION_SWITCH_DURING_EXECUTION'
  | 'SESSION_NOT_ACTIVE'
  | 'AGENT_EXECUTION_BUSY';

export class AgentServiceError extends Error {
  public constructor(
    public readonly code: AgentServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentServiceError';
  }
}

export interface AgentServiceSessionPort {
  list(projectId: ProjectId): Promise<readonly AgentSessionSummary[]>;
  create(projectId: ProjectId): Promise<AgentSessionSummary>;
  open(
    projectId: ProjectId,
    sessionId: AgentSessionId,
  ): Promise<AgentSessionSummary>;
  getActive(projectId: ProjectId): Promise<AgentSessionSummary | undefined>;
}

export interface AgentServiceWorkflowPort {
  isRunning(projectId?: ProjectId): boolean;
  hasActiveTask(projectId?: ProjectId): boolean;
  startExecution(
    input: StartAgentExecutionInput,
    emit: AgentEventSink,
  ): AgentExecutionId;
  cancelCurrentExecution(projectId: ProjectId): Promise<void>;
  shutdown(): Promise<void>;
}

export type AgentConversationReader = (
  sessionId: AgentSessionId,
) => Promise<readonly AgentConversationMessage[]>;

export interface AgentServiceDependencies {
  readonly sessions: AgentServiceSessionPort;
  readonly workflow: AgentServiceWorkflowPort;
  readonly readConversation: AgentConversationReader;
}

export class AgentService {
  public constructor(private readonly dependencies: AgentServiceDependencies) {}

  public async handle(
    command: AgentCommand,
    emit: (event: AgentEvent) => void,
  ): Promise<AgentCommandResult> {
    switch (command.type) {
      case 'agent.session.list':
        return {
          type: 'agent.session.listed',
          requestId: command.requestId,
          sessions: await this.dependencies.sessions.list(command.projectId),
        };
      case 'agent.session.create': {
        this.assertSessionSwitchAllowed();
        const session = await this.dependencies.sessions.create(
          command.projectId,
        );
        return {
          type: 'agent.session.created',
          requestId: command.requestId,
          session,
        };
      }
      case 'agent.session.open': {
        this.assertSessionSwitchAllowed();
        const session = await this.dependencies.sessions.open(
          command.projectId,
          command.sessionId,
        );
        return {
          type: 'agent.session.opened',
          requestId: command.requestId,
          session,
          messages: await this.dependencies.readConversation(session.sessionId),
        };
      }
      case 'agent.session.getActive': {
        const session = await this.dependencies.sessions.getActive(
          command.projectId,
        );
        if (session === undefined) {
          return {
            type: 'agent.session.active',
            requestId: command.requestId,
          };
        }
        return {
          type: 'agent.session.active',
          requestId: command.requestId,
          session,
          messages: await this.dependencies.readConversation(session.sessionId),
        };
      }
      case 'agent.message.send':
        return this.sendMessage(command, emit);
      case 'agent.execution.cancel':
        await this.dependencies.workflow.cancelCurrentExecution(
          command.projectId,
        );
        return {
          type: 'agent.execution.cancelAccepted',
          requestId: command.requestId,
        };
      case 'agent.execution.state':
        return {
          type: 'agent.execution.stateReported',
          requestId: command.requestId,
          running: this.dependencies.workflow.isRunning(command.projectId),
          activeTask: this.dependencies.workflow.hasActiveTask(
            command.projectId,
          ),
        };
    }
  }

  public async shutdown(): Promise<void> {
    await this.dependencies.workflow.shutdown();
  }

  private assertSessionSwitchAllowed(): void {
    if (this.dependencies.workflow.isRunning()) {
      throw new AgentServiceError(
        'SESSION_SWITCH_DURING_EXECUTION',
        'Agent Session cannot be switched while execution is active',
      );
    }
  }

  private async sendMessage(
    command: Extract<AgentCommand, { readonly type: 'agent.message.send' }>,
    emit: AgentEventSink,
  ): Promise<AgentCommandResult> {
    if (this.dependencies.workflow.isRunning()) {
      throw new AgentServiceError(
        'AGENT_EXECUTION_BUSY',
        'Another Agent execution is already active',
      );
    }

    const active = await this.dependencies.sessions.getActive(
      command.projectId,
    );
    if (active?.sessionId !== command.sessionId) {
      throw new AgentServiceError(
        'SESSION_NOT_ACTIVE',
        'Agent message must target the active Project Session',
      );
    }

    const executionId = this.dependencies.workflow.startExecution(
      {
        projectId: command.projectId,
        sessionId: command.sessionId,
        ...(command.task === undefined ? {} : { task: command.task }),
        text: command.text,
      },
      emit,
    );
    return {
      type: 'agent.message.accepted',
      requestId: command.requestId,
      executionId,
    };
  }
}
