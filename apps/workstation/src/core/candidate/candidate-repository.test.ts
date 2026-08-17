import type { CandidateId } from '@agent-music/contracts';
import { win32 } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  open: vi.fn<
    (
      path: string,
      flags: string,
      mode: number,
    ) => Promise<{
      writeFile: (source: string, encoding: string) => Promise<void>;
      sync: () => Promise<void>;
      close: () => Promise<void>;
    }>
  >(),
  rename: vi.fn(() => Promise.resolve()),
}));

vi.mock('node:path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:path')>();
  return {
    ...actual,
    basename: (path: string, suffix?: string) =>
      actual.win32.basename(path, suffix),
    dirname: (path: string) => actual.win32.dirname(path),
    join: (...paths: string[]) => actual.win32.join(...paths),
  };
});

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: fsMocks.open,
    rename: fsMocks.rename,
  };
});

import {
  CandidateGitRepository,
  type CandidateWorkspace,
} from './candidate-repository.js';

const candidateId = '00000000-0000-4000-8000-000000000031' as CandidateId;

describe('CandidateGitRepository Windows file writes', () => {
  it('creates the atomic temporary file as a sibling with only the target basename', async () => {
    fsMocks.open.mockResolvedValueOnce({
      writeFile: vi.fn(() => Promise.resolve()),
      sync: vi.fn(() => Promise.resolve()),
      close: vi.fn(() => Promise.resolve()),
    });
    const workspace: CandidateWorkspace = {
      candidateId,
      branchName: `candidate/${candidateId}`,
      worktreePath: `C:\\Music\\Demo\\.agent-music\\worktrees\\${candidateId}`,
      baseRevision: 'C0',
    };
    const repository = new CandidateGitRepository();

    await repository.writeComposition(workspace, 'X:1\nK:C\nC\n');

    const temporaryPath = fsMocks.open.mock.calls[0]?.[0];
    if (temporaryPath === undefined) {
      throw new Error('Expected atomic write to open a temporary file');
    }
    expect(win32.dirname(temporaryPath)).toBe(workspace.worktreePath);
    expect(win32.basename(temporaryPath)).toMatch(
      /^\.composition\.abc\.[0-9a-f-]+\.tmp$/iu,
    );
  });
});
