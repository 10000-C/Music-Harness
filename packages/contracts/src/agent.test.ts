import { describe, expect, it } from 'vitest';

import {
  isAgentCommand,
  isAgentCommandResult,
  isAgentEvent,
  isAgentProcessCommand,
  isAgentProcessEvent,
} from './agent.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const executionId = '33333333-3333-4333-8333-333333333333';
const taskId = '44444444-4444-4444-8444-444444444444';
const candidateId = '55555555-5555-4555-8555-555555555555';

const expectValidCommand = (command: unknown): void => {
  expect(isAgentCommand(command)).toBe(true);
};

const expectValidEvent = (event: unknown): void => {
  expect(isAgentEvent(event)).toBe(true);
};

describe('Agent command contract', () => {
  it('accepts Project session lifecycle commands', () => {
    expectValidCommand({
      type: 'agent.session.list',
      requestId: 'request-1',
      projectId,
    });
    expectValidCommand({
      type: 'agent.session.create',
      requestId: 'request-2',
      projectId,
    });
    expectValidCommand({
      type: 'agent.session.open',
      requestId: 'request-3',
      projectId,
      sessionId,
    });
    expectValidCommand({
      type: 'agent.session.getActive',
      requestId: 'request-4',
      projectId,
    });
  });

  it('accepts message and cancel commands', () => {
    expectValidCommand({
      type: 'agent.message.send',
      requestId: 'request-5',
      projectId,
      sessionId,
      text: 'Make the bass line more syncopated.',
    });
    expectValidCommand({
      type: 'agent.message.send',
      requestId: 'request-5b',
      projectId,
      sessionId,
      task: { taskId, candidateId },
      text: 'Make the confirmed scoped change.',
    });
    expectValidCommand({
      type: 'agent.execution.cancel',
      requestId: 'request-6',
      projectId,
    });
  });

  it('rejects unknown, malformed, or empty commands', () => {
    expect(isAgentCommand({})).toBe(false);
    expect(
      isAgentCommand({
        type: 'agent.session.open',
        requestId: 'request-3',
        projectId,
        sessionId: 'not-a-uuid',
      }),
    ).toBe(false);
    expect(
      isAgentCommand({
        type: 'agent.message.send',
        requestId: 'request-5',
        projectId,
        sessionId,
        text: '',
      }),
    ).toBe(false);
    expect(
      isAgentCommand({
        type: 'agent.message.send',
        requestId: 'request-5b',
        projectId,
        sessionId,
        task: { taskId: 'not-a-uuid', candidateId },
        text: 'Make the confirmed scoped change.',
      }),
    ).toBe(false);
    expect(
      isAgentCommand({
        type: 'agent.unknown',
        requestId: 'request-7',
        projectId,
      }),
    ).toBe(false);
  });
});

describe('Agent command result contract', () => {
  it('accepts Session lifecycle and execution acknowledgement results', () => {
    expect(
      isAgentCommandResult({
        type: 'agent.session.listed',
        requestId: 'request-list',
        sessions: [
          { sessionId, projectId, createdAt: '2026-09-09T00:00:00.000Z' },
        ],
      }),
    ).toBe(true);
    expect(
      isAgentCommandResult({
        type: 'agent.session.opened',
        requestId: 'request-open',
        session: {
          sessionId,
          projectId,
          createdAt: '2026-09-09T00:00:00.000Z',
        },
        messages: [{ role: 'user', text: 'Tighten the bass line.' }],
      }),
    ).toBe(true);
    expect(
      isAgentCommandResult({
        type: 'agent.message.accepted',
        requestId: 'request-message',
        executionId,
      }),
    ).toBe(true);
    expect(
      isAgentCommandResult({
        type: 'agent.execution.cancelAccepted',
        requestId: 'request-cancel',
      }),
    ).toBe(true);
  });

  it('rejects malformed Session and execution acknowledgement results', () => {
    expect(
      isAgentCommandResult({
        type: 'agent.session.created',
        requestId: 'request-create',
        session: { sessionId: 'bad', projectId, createdAt: 'now' },
      }),
    ).toBe(false);
    expect(
      isAgentCommandResult({
        type: 'agent.session.active',
        requestId: 'request-active',
        messages: [{ role: 'tool', text: 'raw result' }],
      }),
    ).toBe(false);
    expect(
      isAgentCommandResult({
        type: 'agent.message.accepted',
        requestId: 'request-message',
        executionId: 'bad-execution-id',
      }),
    ).toBe(false);
  });
});

describe('Agent event contract', () => {
  it('accepts text delta and terminal events', () => {
    expectValidEvent({
      type: 'agent.textDelta',
      projectId,
      sessionId,
      executionId,
      text: 'Updating ',
    });
    expectValidEvent({
      type: 'agent.executionCompleted',
      projectId,
      sessionId,
      executionId,
    });
    expectValidEvent({
      type: 'agent.executionFailed',
      projectId,
      sessionId,
      executionId,
      code: 'AGENT_EXECUTION_FAILED',
      message: 'Agent execution failed',
    });
    expectValidEvent({
      type: 'agent.executionCancelled',
      projectId,
      sessionId,
      executionId,
    });
  });

  it('rejects forbidden extra fields on otherwise valid transport variants', () => {
    expect(
      isAgentEvent({
        type: 'agent.textDelta',
        projectId,
        sessionId,
        executionId,
        text: 'ok',
        rawToolResult: { private: true },
      }),
    ).toBe(false);
    expect(
      isAgentCommand({
        type: 'agent.message.send',
        requestId: 'request-extra-scope',
        projectId,
        sessionId,
        text: 'Make the scoped edit.',
        scope: { type: 'wholeProject' },
      }),
    ).toBe(false);
    expect(
      isAgentCommandResult({
        type: 'agent.session.opened',
        requestId: 'request-extra-snapshot',
        session: {
          sessionId,
          projectId,
          createdAt: '2026-09-09T00:00:00.000Z',
        },
        messages: [
          {
            role: 'assistant',
            text: 'ok',
            snapshot: { internal: true },
          },
        ],
      }),
    ).toBe(false);
  });

  it('rejects raw tool-result shaped events and malformed text events', () => {
    expect(
      isAgentEvent({
        type: 'agent.toolResult',
        projectId,
        sessionId,
        executionId,
        result: { secret: 'raw-tool-result' },
      }),
    ).toBe(false);
    expect(
      isAgentEvent({
        type: 'agent.textDelta',
        projectId,
        sessionId,
        executionId: 'bad-execution-id',
        text: 'delta',
      }),
    ).toBe(false);
  });
});

describe('Agent process lifecycle contract', () => {
  it('accepts health and process shutdown commands', () => {
    expect(
      isAgentProcessCommand({
        type: 'agent.process.health',
        requestId: 'health-1',
      }),
    ).toBe(true);
    expect(
      isAgentProcessCommand({
        type: 'agent.process.shutdown',
        requestId: 'close-1',
      }),
    ).toBe(true);
  });

  it('accepts ready, healthy, stopped, command result, agent event, and fatal events', () => {
    expect(isAgentProcessEvent({ type: 'agent.process.ready' })).toBe(true);
    expect(
      isAgentProcessEvent({
        type: 'agent.process.healthy',
        requestId: 'health-1',
      }),
    ).toBe(true);
    expect(
      isAgentProcessEvent({
        type: 'agent.process.stopped',
        requestId: 'close-1',
      }),
    ).toBe(true);
    expect(
      isAgentProcessEvent({
        type: 'agent.process.commandResult',
        result: {
          type: 'agent.execution.cancelAccepted',
          requestId: 'cancel-1',
        },
      }),
    ).toBe(true);
    expect(
      isAgentProcessEvent({
        type: 'agent.process.agentEvent',
        event: {
          type: 'agent.executionCompleted',
          projectId,
          sessionId,
          executionId,
        },
      }),
    ).toBe(true);
    expect(
      isAgentProcessEvent({
        type: 'agent.process.fatal',
        code: 'AGENT_PROCESS_FAILED',
        message: 'Agent process failed',
      }),
    ).toBe(true);
  });

  it('rejects malformed process lifecycle messages', () => {
    expect(
      isAgentProcessCommand({ type: 'agent.process.health', requestId: '' }),
    ).toBe(false);
    expect(
      isAgentProcessEvent({
        type: 'agent.process.commandResult',
        result: {
          type: 'agent.message.accepted',
          requestId: 'r',
          executionId: 'bad',
        },
      }),
    ).toBe(false);
    expect(
      isAgentProcessEvent({
        type: 'agent.process.fatal',
        code: '',
        message: 'details',
      }),
    ).toBe(false);
  });
});
