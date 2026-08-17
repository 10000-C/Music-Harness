import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const createTemporaryDirectory = (prefix: string): Promise<string> =>
  mkdtemp(join(tmpdir(), prefix));

export const removeTemporaryDirectory = (path: string): Promise<void> =>
  rm(path, { recursive: true, force: true });
