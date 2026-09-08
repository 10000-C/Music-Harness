import { describe, expect, it } from 'vitest';

import { isMcpRuntimeDescriptor } from './mcp.js';

const projectId = '11111111-1111-4111-8111-111111111111';

describe('MCP runtime descriptor contract', () => {
  it('accepts a loopback Streamable HTTP descriptor', () => {
    expect(
      isMcpRuntimeDescriptor({
        projectId,
        endpoint: 'http://127.0.0.1:43127/mcp',
        instanceToken: 'high-entropy-token',
        pid: 12345,
      }),
    ).toBe(true);
  });

  it('rejects non-loopback or malformed descriptors', () => {
    expect(
      isMcpRuntimeDescriptor({
        projectId,
        endpoint: 'https://example.com/mcp',
        instanceToken: 'token',
        pid: 12345,
      }),
    ).toBe(false);
    expect(
      isMcpRuntimeDescriptor({
        projectId,
        endpoint: 'http://127.0.0.1:43127/not-mcp',
        instanceToken: 'token',
        pid: 12345,
      }),
    ).toBe(false);
    expect(
      isMcpRuntimeDescriptor({
        projectId: 'not-a-uuid',
        endpoint: 'http://127.0.0.1:43127/mcp',
        instanceToken: 'token',
        pid: 12345,
      }),
    ).toBe(false);
    expect(
      isMcpRuntimeDescriptor({
        projectId,
        endpoint: 'http://127.0.0.1:43127/mcp',
        instanceToken: '',
        pid: 12345,
      }),
    ).toBe(false);
    expect(
      isMcpRuntimeDescriptor({
        projectId,
        endpoint: 'http://127.0.0.1:43127/mcp',
        instanceToken: 'token',
        pid: 0,
      }),
    ).toBe(false);
  });
});
