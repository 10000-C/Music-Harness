import {
  isAgentCommand,
  isAgentProcessCommand,
  type AgentCommand,
  type AgentCommandResult,
  type AgentEvent,
  type AgentProcessEvent,
} from '@agent-music/contracts';

export interface AgentProcessServicePort {
  handle(
    command: AgentCommand,
    emit: (event: AgentEvent) => void,
  ): Promise<AgentCommandResult>;
  shutdown(): Promise<void>;
}

export type AgentProcessEventSink = (event: AgentProcessEvent) => void;

const SAFE_COMMAND_ERROR_CODES = new Set([
  'SESSION_SWITCH_DURING_EXECUTION',
  'SESSION_NOT_ACTIVE',
  'AGENT_EXECUTION_BUSY',
  'SESSION_NOT_FOUND',
  'SESSION_INDEX_INVALID',
  'SESSION_INDEX_IO_FAILED',
]);

const isSafeCommandError = (
  error: unknown,
): error is Error & { readonly code: string } =>
  error instanceof Error &&
  'code' in error &&
  typeof error.code === 'string' &&
  SAFE_COMMAND_ERROR_CODES.has(error.code);

export class AgentProcessEntrypoint {
  private started = false;

  public constructor(
    private readonly service: AgentProcessServicePort,
    private readonly emit: AgentProcessEventSink,
  ) {}

  public start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.emit({ type: 'agent.process.ready' });
  }

  public async handle(message: unknown): Promise<void> {
    if (isAgentProcessCommand(message)) {
      if (message.type === 'agent.process.health') {
        this.emit({
          type: 'agent.process.healthy',
          requestId: message.requestId,
        });
        return;
      }
      await this.shutdown(message.requestId);
      return;
    }

    if (isAgentCommand(message)) {
      await this.handleAgentCommand(message);
      return;
    }

    this.emit({
      type: 'agent.process.fatal',
      code: 'AGENT_PROCESS_PROTOCOL_ERROR',
      message: 'Agent process received an invalid message',
    });
    throw new Error('Agent process protocol error');
  }

  private async handleAgentCommand(command: AgentCommand): Promise<void> {
    try {
      const result = await this.service.handle(command, (event) => {
        this.emit({ type: 'agent.process.agentEvent', event });
        if (
          event.type === 'agent.executionFailed' &&
          event.code === 'TASK_ROLLBACK_FAILED'
        ) {
          this.emit({
            type: 'agent.process.fatal',
            code: 'AGENT_TASK_ROLLBACK_FAILED',
            message: 'Agent Task rollback failed',
          });
        }
      });
      this.emit({ type: 'agent.process.commandResult', result });
    } catch (error) {
      this.emit({
        type: 'agent.process.commandFailed',
        requestId: command.requestId,
        code: isSafeCommandError(error) ? error.code : 'AGENT_COMMAND_FAILED',
        message: isSafeCommandError(error)
          ? error.message
          : 'Agent command failed',
      });
    }
  }

  private async shutdown(requestId: string): Promise<void> {
    try {
      await this.service.shutdown();
    } catch {
      this.emit({
        type: 'agent.process.fatal',
        code: 'AGENT_PROCESS_CLEANUP_FAILED',
        message: 'Agent process cleanup failed',
      });
      throw new Error('Agent process cleanup failed');
    }
    this.emit({ type: 'agent.process.stopped', requestId });
  }
}
