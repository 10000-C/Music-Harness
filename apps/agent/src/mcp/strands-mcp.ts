import { McpClient } from '@strands-agents/sdk';
import type { McpRuntimeDescriptor } from '@agent-music/contracts';

export const createStrandsMcpClient = (
  descriptor: McpRuntimeDescriptor,
): McpClient =>
  new McpClient({
    applicationName: 'agent-music-workstation-agent',
    applicationVersion: '1.0.0',
    url: descriptor.endpoint,
    headers: {
      Authorization: `Bearer ${descriptor.instanceToken}`,
    },
  });
