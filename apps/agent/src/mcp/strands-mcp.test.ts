import type { McpRuntimeDescriptor } from '@agent-music/contracts';
import { describe, expect, it } from 'vitest';

import { createStrandsMcpClient } from './strands-mcp.js';

const descriptor: McpRuntimeDescriptor = {
  endpoint: 'http://127.0.0.1:43127/mcp',
  instanceToken: 'test-instance-token',
  pid: 1234,
};

describe('createStrandsMcpClient', () => {
  it('creates a disconnected Strands MCP client from the Core descriptor', () => {
    const client = createStrandsMcpClient(descriptor);

    expect(client.connectionState).toBe('disconnected');
    expect(client.clientName).toBe('agent-music-workstation-agent');
  });
});
