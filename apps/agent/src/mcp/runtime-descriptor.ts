import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  isMcpRuntimeDescriptor,
  type McpRuntimeDescriptor,
  type ProjectId,
} from '@agent-music/contracts';

export type RuntimeDescriptorErrorCode =
  | 'RUNTIME_DESCRIPTOR_NOT_FOUND'
  | 'RUNTIME_DESCRIPTOR_INVALID'
  | 'RUNTIME_DESCRIPTOR_IO_FAILED';

export class RuntimeDescriptorError extends Error {
  public constructor(
    public readonly code: RuntimeDescriptorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeDescriptorError';
  }
}

const isFileNotFound = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const defaultIsProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export class RuntimeDescriptorDiscovery {
  public constructor(
    private readonly runtimeDirectory: string,
    private readonly isProcessAlive: (
      pid: number,
    ) => boolean = defaultIsProcessAlive,
  ) {}

  public async read(projectId: ProjectId): Promise<McpRuntimeDescriptor> {
    try {
      const raw = await readFile(
        join(this.runtimeDirectory, `${projectId}.json`),
        'utf8',
      );
      const value: unknown = JSON.parse(raw);
      if (!isMcpRuntimeDescriptor(value) || value.projectId !== projectId) {
        throw new RuntimeDescriptorError(
          'RUNTIME_DESCRIPTOR_INVALID',
          'Music Core runtime descriptor is invalid',
        );
      }
      if (!this.isProcessAlive(value.pid)) {
        throw new RuntimeDescriptorError(
          'RUNTIME_DESCRIPTOR_INVALID',
          'Music Core runtime descriptor is stale',
        );
      }
      return value;
    } catch (error) {
      if (error instanceof RuntimeDescriptorError) {
        throw error;
      }
      if (isFileNotFound(error)) {
        throw new RuntimeDescriptorError(
          'RUNTIME_DESCRIPTOR_NOT_FOUND',
          'Music Core runtime descriptor is not available',
        );
      }
      if (error instanceof SyntaxError) {
        throw new RuntimeDescriptorError(
          'RUNTIME_DESCRIPTOR_INVALID',
          'Music Core runtime descriptor is invalid',
        );
      }
      throw new RuntimeDescriptorError(
        'RUNTIME_DESCRIPTOR_IO_FAILED',
        'Unable to read Music Core runtime descriptor',
      );
    }
  }
}
