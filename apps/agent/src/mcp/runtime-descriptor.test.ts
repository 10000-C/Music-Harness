import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RuntimeDescriptorDiscovery } from './runtime-descriptor.js';

const tempDirectories: string[] = [];

const makeRuntimeDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-runtime-descriptor-'));
  tempDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('RuntimeDescriptorDiscovery', () => {
  it('returns the validated Core-process-scoped descriptor', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const descriptor = {
      endpoint: 'http://127.0.0.1:43127/mcp',
      instanceToken: 'test-token',
      pid: 1234,
    };
    await writeFile(
      join(runtimeDirectory, 'core.json'),
      JSON.stringify(descriptor),
      'utf8',
    );

    await expect(
      new RuntimeDescriptorDiscovery(runtimeDirectory, () => true).read(),
    ).resolves.toEqual(descriptor);
  });

  it('returns a stable not-found error without exposing filesystem internals', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();

    await expect(
      new RuntimeDescriptorDiscovery(runtimeDirectory).read(),
    ).rejects.toMatchObject({
      code: 'RUNTIME_DESCRIPTOR_NOT_FOUND',
      message: 'Music Core runtime descriptor is not available',
    });
  });

  it('rejects a descriptor whose Core process is no longer alive', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    const descriptor = {
      endpoint: 'http://127.0.0.1:43127/mcp',
      instanceToken: 'test-token',
      pid: 1234,
    };
    await writeFile(
      join(runtimeDirectory, 'core.json'),
      JSON.stringify(descriptor),
      'utf8',
    );

    await expect(
      new RuntimeDescriptorDiscovery(runtimeDirectory, () => false).read(),
    ).rejects.toMatchObject({
      code: 'RUNTIME_DESCRIPTOR_INVALID',
      message: 'Music Core runtime descriptor is stale',
    });
  });

  it('rejects malformed or legacy Project-scoped descriptor content', async () => {
    const runtimeDirectory = await makeRuntimeDirectory();
    await mkdir(runtimeDirectory, { recursive: true });
    await writeFile(
      join(runtimeDirectory, 'core.json'),
      JSON.stringify({
        projectId: '22222222-2222-4222-8222-222222222222',
        endpoint: 'http://127.0.0.1:43127/mcp',
        instanceToken: 'test-token',
        pid: 1234,
      }),
      'utf8',
    );

    await expect(
      new RuntimeDescriptorDiscovery(runtimeDirectory).read(),
    ).rejects.toMatchObject({
      code: 'RUNTIME_DESCRIPTOR_INVALID',
      message: 'Music Core runtime descriptor is invalid',
    });
  });
});
