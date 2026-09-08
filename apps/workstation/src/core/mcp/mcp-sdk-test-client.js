import { URL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export const connectMcpTestClient = async (endpoint, instanceToken) => {
  const client = new Client({ name: 'a4-test-client', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: { Authorization: `Bearer ${instanceToken}` },
    },
  });
  await client.connect(transport);
  return {
    listTools: () => client.listTools(),
    callTool: (params) => client.callTool(params),
    close: () => client.close(),
  };
};
