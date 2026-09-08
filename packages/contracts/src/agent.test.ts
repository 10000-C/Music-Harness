import { describe, expect, it } from 'vitest';

import { isAgentCommand, isAgentEvent } from './agent.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const executionId = '33333333-3333-4333-8333-333333333333';

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
        type: 'agent.unknown',
        requestId: 'request-7',
        projectId,
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
