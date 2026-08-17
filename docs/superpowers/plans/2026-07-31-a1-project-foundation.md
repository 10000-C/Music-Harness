# A1 Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement A1 Project Foundation so Music Core can create, open, explicitly recover, save as, and close a clean Current project while enforcing one in-process write stream and one writable application instance per project.

**Architecture:** A1 is a deep Music Core module with five project-lifecycle operations as its only Renderer-facing surface. Node filesystem, real Git, atomic project locking, clean-Current reads, and serialized writes remain internal; A3 and A5 later consume only the internal `ProjectAuthorityAccess` seam. Canonical ABC semantics remain in A2, while A1 creates a deterministic six-voice empty composition fixture through the required `createInitialComposition()` method.

**Tech Stack:** Node.js 24.18.1, pnpm 9.15.9, TypeScript 5.9.3, Vitest 4.1.10, Node `fs/promises`, Node `child_process.execFile`, real Git CLI.

**Approved requirements:** `docs/architecture/Agent Music Workstation System Architecture.md` V1.4 and `docs/devplan.md` V1.1.

## Global Constraints

- Work only inside A1 Project Foundation; do not implement A2 composition parsing/normalization, A3 Candidate transactions, A4 MCP/runtime descriptor, A5 persistence/export, Electron Main, or Renderer UI.
- Keep the Renderer-facing project interface limited to `createProject`, `openProject`, `recoverCurrent`, `saveProjectAs`, and `closeProject`.
- Do not expose raw filesystem, Git, lock acquisition, lock release, or generic write APIs through IPC contracts.
- Git authority files are exactly `project.json` and `composition.abc`.
- Current is exactly `main` HEAD; `project.json` must not store a Current SHA.
- A dirty Current must return `recoveryRequired` and remain fail-closed until explicit recovery from `main` HEAD.
- Recovery restores only `project.json` and `composition.abc`; it does not restore Candidate, Task, SQLite, cache, export, or UI state.
- All project-file and Current-Git writes must pass through one project-level in-process serial queue.
- The cross-instance lock lives under `.agent-music/locks/`; one project can have at most one writable application instance.
- A process that no longer owns the lock must fail before every subsequent write.
- Run Git with argument arrays, never shell-interpolated command strings, and set repository-local `core.longpaths=true`.
- Save As copies only the source Current `main` HEAD authority files, generates a new `projectId`, creates a new Git history with one Initial Current commit, and switches the active session only after the target succeeds.
- The empty ABC produced by A1 is a deterministic fixture only; A2 later replaces its musical semantics without changing the A1 lifecycle interface.
- Use TDD and make one reviewable commit per task.

---

## File Map

### Shared contracts

- `packages/contracts/src/project.ts`: Project manifest, lifecycle DTOs, command/event unions, error codes, and runtime guards.
- `packages/contracts/src/project.test.ts`: contract-level validation and public-surface tests.
- `packages/contracts/src/index.ts`: exports the A1 contracts.

### Workstation test configuration

- `apps/workstation/vitest.config.ts`: Node Vitest project for Music Core tests.
- `apps/workstation/tsconfig.json`: includes Core source and tests.
- `apps/workstation/package.json`: workstation `test` script and exact test dependencies.
- `vitest.config.ts`: discovers both package and app Vitest projects.

### A1 implementation

- `apps/workstation/src/core/project/project-error.ts`: typed internal errors mapped to public `ProjectErrorCode`.
- `apps/workstation/src/core/project/git-adapter.ts`: argument-array Git operations and clean-Current primitives.
- `apps/workstation/src/core/project/project-manifest.ts`: manifest creation, parsing, and deterministic serialization.
- `apps/workstation/src/core/project/initial-composition.ts`: required A1 `createInitialComposition()` fixture source.
- `apps/workstation/src/core/project/project-lock.ts`: cross-instance write-lock acquisition, stale-lock cleanup, ownership assertion, and release.
- `apps/workstation/src/core/project/project-write-coordinator.ts`: in-process FIFO write serialization.
- `apps/workstation/src/core/project/current-authority.ts`: clean `main` HEAD reader and explicit authority-file restore.
- `apps/workstation/src/core/project/project-authority-access.ts`: internal A3/A5 seam only.
- `apps/workstation/src/core/project/project-foundation.ts`: active-project lifecycle orchestration.
- `apps/workstation/src/core/project/project-ipc-handler.ts`: framework-neutral typed command handler for later B1 IPC binding.
- `apps/workstation/src/core/project/index.ts`: the module entry point; no lower-level implementation exports.

### A1 tests

- `apps/workstation/src/core/project/test-support.ts`: temporary directories, real-Git assertions, and deterministic test fixtures.
- `apps/workstation/src/core/project/git-adapter.test.ts`
- `apps/workstation/src/core/project/project-manifest.test.ts`
- `apps/workstation/src/core/project/project-lock.test.ts`
- `apps/workstation/src/core/project/project-write-coordinator.test.ts`
- `apps/workstation/src/core/project/current-authority.test.ts`
- `apps/workstation/src/core/project/project-foundation.test.ts`
- `apps/workstation/src/core/project/project-ipc-handler.test.ts`
- `apps/workstation/src/core/project/project-foundation.integration.test.ts`

---

### Task 1: Add A1 contracts and the workstation test boundary

**Files:**

- Create: `packages/contracts/src/project.test.ts`
- Create: `packages/contracts/src/project.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/workstation/vitest.config.ts`
- Modify: `apps/workstation/tsconfig.json`
- Modify: `apps/workstation/package.json`
- Modify: `vitest.config.ts`

**Interfaces:**

- Consumes: existing `ProjectId`, `TRACK_IDS`, and strict TypeScript policy.
- Produces: `ProjectManifest`, `ProjectOpenState`, `OpenedProject`, `ProjectCommand`, `ProjectEvent`, `ProjectErrorCode`, `PROJECT_FORMAT_VERSION`, `PROJECT_PPQ`, and `isProjectManifest` from `@agent-music/contracts`.

- [ ] **Step 1: Write failing Project contract tests**

Create `packages/contracts/src/project.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  PROJECT_FORMAT_VERSION,
  PROJECT_PPQ,
  TRACK_IDS,
  isProjectManifest,
} from './index.js';

describe('ProjectManifest', () => {
  const validManifest = {
    formatVersion: PROJECT_FORMAT_VERSION,
    projectId: 'f31dd9a5-2f55-4bd0-8cf6-f684c41314cc',
    timebase: { ppq: PROJECT_PPQ },
    tracks: TRACK_IDS,
  };

  it('accepts the exact P0 manifest shape', () => {
    expect(isProjectManifest(validManifest)).toBe(true);
  });

  it('rejects a Current SHA, changed PPQ, reordered tracks, and extra fields', () => {
    expect(isProjectManifest({ ...validManifest, currentRevision: 'abc' })).toBe(
      false,
    );
    expect(
      isProjectManifest({ ...validManifest, timebase: { ppq: 480 } }),
    ).toBe(false);
    expect(
      isProjectManifest({
        ...validManifest,
        tracks: [...TRACK_IDS].reverse(),
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run the contract test and verify the missing exports fail**

Run:

```bash
pnpm --filter @agent-music/contracts test -- src/project.test.ts
```

Expected: FAIL because the Project contract exports do not exist.

- [ ] **Step 3: Implement the exact public A1 contracts**

Create `packages/contracts/src/project.ts`:

```ts
import { TRACK_IDS, type ProjectId } from './domain.js';

export const PROJECT_FORMAT_VERSION = 1 as const;
export const PROJECT_PPQ = 960 as const;

export interface ProjectManifest {
  readonly formatVersion: typeof PROJECT_FORMAT_VERSION;
  readonly projectId: ProjectId;
  readonly timebase: {
    readonly ppq: typeof PROJECT_PPQ;
  };
  readonly tracks: typeof TRACK_IDS;
}

export type ProjectOpenState = 'ready' | 'recoveryRequired';

export interface OpenedProject {
  readonly projectId: ProjectId;
  readonly projectPath: string;
  readonly currentRevision: string;
  readonly state: ProjectOpenState;
  readonly manifest: ProjectManifest;
}

export type ProjectErrorCode =
  | 'PROJECT_ALREADY_OPEN'
  | 'PROJECT_NOT_OPEN'
  | 'PROJECT_DIRECTORY_NOT_EMPTY'
  | 'PROJECT_INVALID'
  | 'PROJECT_WRITE_LOCKED'
  | 'PROJECT_WRITE_LOCK_LOST'
  | 'CURRENT_WORKTREE_DIRTY'
  | 'GIT_OPERATION_FAILED'
  | 'PROJECT_INTERNAL_ERROR';

interface ProjectCommandBase {
  readonly requestId: string;
}

export type ProjectCommand =
  | (ProjectCommandBase & {
      readonly type: 'project.create';
      readonly projectPath: string;
    })
  | (ProjectCommandBase & {
      readonly type: 'project.open';
      readonly projectPath: string;
    })
  | (ProjectCommandBase & { readonly type: 'project.recoverCurrent' })
  | (ProjectCommandBase & {
      readonly type: 'project.saveAs';
      readonly targetPath: string;
    })
  | (ProjectCommandBase & { readonly type: 'project.close' });

export type ProjectEvent =
  | {
      readonly type: 'project.opened';
      readonly requestId: string;
      readonly sequence: number;
      readonly project: OpenedProject;
    }
  | {
      readonly type: 'project.closed';
      readonly requestId: string;
      readonly sequence: number;
    }
  | {
      readonly type: 'project.failed';
      readonly requestId: string;
      readonly sequence: number;
      readonly code: ProjectErrorCode;
      readonly message: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isProjectManifest = (value: unknown): value is ProjectManifest => {
  if (!isRecord(value) || Object.keys(value).length !== 4) {
    return false;
  }

  if (
    value.formatVersion !== PROJECT_FORMAT_VERSION ||
    typeof value.projectId !== 'string' ||
    value.projectId.length === 0 ||
    !isRecord(value.timebase) ||
    Object.keys(value.timebase).length !== 1 ||
    value.timebase.ppq !== PROJECT_PPQ ||
    !Array.isArray(value.tracks) ||
    value.tracks.length !== TRACK_IDS.length
  ) {
    return false;
  }

  return TRACK_IDS.every((trackId, index) => value.tracks?.[index] === trackId);
};
```

Export these values and types from `packages/contracts/src/index.ts`.

- [ ] **Step 4: Enable workstation tests without adding application runtime libraries**

Create `apps/workstation/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

Change `apps/workstation/tsconfig.json` to:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node", "vitest/globals"]
  },
  "include": ["src/**/*.ts", "vitest.config.ts"]
}
```

Add to `apps/workstation/package.json`:

```json
{
  "scripts": {
    "typecheck": "tsc --project tsconfig.json",
    "test": "vitest run --config vitest.config.ts"
  },
  "devDependencies": {
    "@types/node": "24.10.1",
    "typescript": "5.9.3",
    "vitest": "4.1.10"
  }
}
```

Preserve the existing package metadata and `@agent-music/contracts` dependency. Change root `vitest.config.ts` projects to:

```ts
projects: ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts'],
```

Run `pnpm install` to update the lockfile.

- [ ] **Step 5: Verify contracts, typecheck, and workspace test discovery**

Run:

```bash
pnpm --filter @agent-music/contracts test -- src/project.test.ts
pnpm --filter @agent-music/workstation typecheck
pnpm test
```

Expected: all commands PASS; the root test command discovers both Contracts and Workstation projects.

- [ ] **Step 6: Commit the contract and test-boundary change**

```bash
git add packages/contracts apps/workstation/package.json apps/workstation/tsconfig.json apps/workstation/vitest.config.ts vitest.config.ts pnpm-lock.yaml
git commit -m "feat(core): define project foundation contracts"
```

---

### Task 2: Implement the real Git adapter

**Files:**

- Create: `apps/workstation/src/core/project/project-error.ts`
- Create: `apps/workstation/src/core/project/test-support.ts`
- Create: `apps/workstation/src/core/project/git-adapter.test.ts`
- Create: `apps/workstation/src/core/project/git-adapter.ts`

**Interfaces:**

- Consumes: `ProjectErrorCode`.
- Produces: `GitAdapter.init`, `commitAuthorityFiles`, `statusPorcelain`, `mainRevision`, `readMainFile`, `restoreAuthorityFiles`, and `revisionCount`.

- [ ] **Step 1: Add a typed internal Project error**

Create `project-error.ts`:

```ts
import type { ProjectErrorCode } from '@agent-music/contracts';

export class ProjectError extends Error {
  readonly code: ProjectErrorCode;

  constructor(code: ProjectErrorCode, message: string) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
  }
}
```

- [ ] **Step 2: Write failing real-Git adapter tests**

Create `test-support.ts`:

```ts
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const createTemporaryDirectory = (prefix: string): Promise<string> =>
  mkdtemp(join(tmpdir(), prefix));

export const removeTemporaryDirectory = (path: string): Promise<void> =>
  rm(path, { recursive: true, force: true });
```

Create `git-adapter.test.ts` with independent setup in each test:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { GitAdapter } from './git-adapter.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from './test-support.js';

const roots: string[] = [];
const makeRoot = async (): Promise<string> => {
  const root = await createTemporaryDirectory('a1-git-');
  roots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTemporaryDirectory));
});

describe('GitAdapter', () => {
  it('initializes main, commits only authority files, and reads main HEAD', async () => {
    const root = await makeRoot();
    await writeFile(join(root, 'project.json'), '{"formatVersion":1}\n');
    await writeFile(join(root, 'composition.abc'), 'X:1\n');

    const git = new GitAdapter();
    await git.init(root);
    await git.commitAuthorityFiles(root, 'Initial Current');

    expect(await git.statusPorcelain(root)).toBe('');
    expect(await git.revisionCount(root)).toBe(1);
    expect(await git.readMainFile(root, 'composition.abc')).toBe('X:1\n');
  });

  it('restores only the two authority files from main', async () => {
    const root = await makeRoot();
    const git = new GitAdapter();
    await writeFile(join(root, 'project.json'), '{"formatVersion":1}\n');
    await writeFile(join(root, 'composition.abc'), 'X:1\n');
    await git.init(root);
    await git.commitAuthorityFiles(root, 'Initial Current');

    await writeFile(join(root, 'project.json'), 'changed');
    await writeFile(join(root, 'composition.abc'), 'changed');
    await writeFile(join(root, 'untracked.txt'), 'keep');
    await git.restoreAuthorityFiles(root);

    expect(await readFile(join(root, 'untracked.txt'), 'utf8')).toBe('keep');
    expect(await readFile(join(root, 'composition.abc'), 'utf8')).toBe('X:1\n');
  });
});
```

- [ ] **Step 3: Run the Git tests and verify they fail**

Run:

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/git-adapter.test.ts
```

Expected: FAIL because `GitAdapter` does not exist.

- [ ] **Step 4: Implement argument-array Git operations**

Create `git-adapter.ts` with this public shape:

```ts
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { ProjectError } from './project-error.js';

const execFileAsync = promisify(execFile);
const AUTHORITY_FILES = ['project.json', 'composition.abc'] as const;

export class GitAdapter {
  async init(repositoryPath: string): Promise<void> {
    await this.run(repositoryPath, ['init', '-b', 'main']);
    await writeFile(
      join(repositoryPath, '.git', 'info', 'exclude'),
      '.agent-music/\nexports/\n',
      'utf8',
    );
    await this.run(repositoryPath, ['config', 'user.name', 'Agent Music Workstation']);
    await this.run(repositoryPath, [
      'config',
      'user.email',
      'agent-music@localhost',
    ]);
    await this.run(repositoryPath, ['config', 'core.longpaths', 'true']);
  }

  async commitAuthorityFiles(
    repositoryPath: string,
    message: string,
  ): Promise<void> {
    await this.run(repositoryPath, ['add', '--', ...AUTHORITY_FILES]);
    await this.run(repositoryPath, ['commit', '-m', message]);
  }

  async statusPorcelain(repositoryPath: string): Promise<string> {
    return (await this.run(repositoryPath, ['status', '--porcelain'])).trim();
  }

  async mainRevision(repositoryPath: string): Promise<string> {
    return (await this.run(repositoryPath, ['rev-parse', 'main'])).trim();
  }

  async readMainFile(
    repositoryPath: string,
    relativePath: (typeof AUTHORITY_FILES)[number],
  ): Promise<string> {
    return this.run(repositoryPath, ['show', `main:${relativePath}`]);
  }

  async restoreAuthorityFiles(repositoryPath: string): Promise<void> {
    await this.run(repositoryPath, [
      'restore',
      '--source',
      'main',
      '--staged',
      '--worktree',
      '--',
      ...AUTHORITY_FILES,
    ]);
  }

  async revisionCount(repositoryPath: string): Promise<number> {
    const output = await this.run(repositoryPath, [
      'rev-list',
      '--count',
      'main',
    ]);
    return Number.parseInt(output.trim(), 10);
  }

  private async run(
    repositoryPath: string,
    arguments_: readonly string[],
  ): Promise<string> {
    try {
      const result = await execFileAsync('git', ['-C', repositoryPath, ...arguments_], {
        encoding: 'utf8',
        windowsHide: true,
      });
      return result.stdout;
    } catch {
      throw new ProjectError(
        'GIT_OPERATION_FAILED',
        `Git operation failed: git ${arguments_.join(' ')}`,
      );
    }
  }
}
```

- [ ] **Step 5: Run focused and package checks**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/git-adapter.test.ts
pnpm --filter @agent-music/workstation typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit the Git adapter**

```bash
git add apps/workstation/src/core/project
git commit -m "feat(core): add current git adapter"
```

---

### Task 3: Implement manifest creation and the required initial-composition method

**Files:**

- Create: `apps/workstation/src/core/project/project-manifest.test.ts`
- Create: `apps/workstation/src/core/project/project-manifest.ts`
- Create: `apps/workstation/src/core/project/initial-composition.ts`

**Interfaces:**

- Consumes: `ProjectManifest`, `ProjectId`, `PROJECT_FORMAT_VERSION`, `PROJECT_PPQ`, and `TRACK_IDS`.
- Produces: `createProjectManifest`, `parseProjectManifest`, `serializeProjectManifest`, `INITIAL_COMPOSITION_FIXTURE`, and `createInitialComposition`.

- [ ] **Step 1: Write failing manifest and fixture tests**

Create tests that assert:

```ts
it('creates and round-trips the exact P0 manifest', () => {
  const manifest = createProjectManifest(
    'f31dd9a5-2f55-4bd0-8cf6-f684c41314cc' as ProjectId,
  );

  expect(parseProjectManifest(serializeProjectManifest(manifest))).toEqual(
    manifest,
  );
  expect(serializeProjectManifest(manifest).endsWith('\n')).toBe(true);
});

it('creates a deterministic non-empty six-voice ABC fixture', () => {
  const first = createInitialComposition();
  const second = createInitialComposition();

  expect(first).toBe(second);
  expect(first).toContain('V:track.drums');
  expect(first).toContain('V:track.winds');
});
```

- [ ] **Step 2: Run tests and verify missing implementations fail**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-manifest.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement deterministic manifest handling**

Create `project-manifest.ts`:

```ts
import {
  PROJECT_FORMAT_VERSION,
  PROJECT_PPQ,
  TRACK_IDS,
  isProjectManifest,
  type ProjectId,
  type ProjectManifest,
} from '@agent-music/contracts';

import { ProjectError } from './project-error.js';

export const createProjectManifest = (projectId: ProjectId): ProjectManifest => ({
  formatVersion: PROJECT_FORMAT_VERSION,
  projectId,
  timebase: { ppq: PROJECT_PPQ },
  tracks: TRACK_IDS,
});

export const parseProjectManifest = (source: string): ProjectManifest => {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new ProjectError('PROJECT_INVALID', 'project.json is not valid JSON');
  }

  if (!isProjectManifest(value)) {
    throw new ProjectError('PROJECT_INVALID', 'project.json has an invalid format');
  }

  return value;
};

export const serializeProjectManifest = (manifest: ProjectManifest): string =>
  `${JSON.stringify(manifest, null, 2)}\n`;
```

- [ ] **Step 4: Implement the required A1 initial-composition fixture**

Create `initial-composition.ts`:

```ts
export const INITIAL_COMPOSITION_FIXTURE = `X:1
T:Untitled
M:4/4
L:1/4
Q:1/4=120
K:C
V:track.drums
V:track.bass
V:track.guitar
V:track.keys
V:track.strings
V:track.winds
[V:track.drums] z4 |
[V:track.bass] z4 |
[V:track.guitar] z4 |
[V:track.keys] z4 |
[V:track.strings] z4 |
[V:track.winds] z4 |
`;

export const createInitialComposition = (): string =>
  INITIAL_COMPOSITION_FIXTURE;
```

This fixture gives A1 a functioning project-creation path. A2 may replace the body while preserving the function name and A1 lifecycle behavior.

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-manifest.test.ts
pnpm --filter @agent-music/workstation typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit manifest and initial composition support**

```bash
git add apps/workstation/src/core/project/project-manifest.ts apps/workstation/src/core/project/project-manifest.test.ts apps/workstation/src/core/project/initial-composition.ts
git commit -m "feat(core): add project authority fixtures"
```

---

### Task 4: Implement the cross-instance project write lock

**Files:**

- Create: `apps/workstation/src/core/project/project-lock.test.ts`
- Create: `apps/workstation/src/core/project/project-lock.ts`

**Interfaces:**

- Consumes: `ProjectId` and `.agent-music/locks/` project layout.
- Produces: `ProjectWriteLock.acquire`, `assertOwned`, and `release`.

- [ ] **Step 1: Write failing ownership, contention, stale-lock, and lost-lock tests**

Use an injected process probe with explicit test setup:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectId } from '@agent-music/contracts';

import { ProjectWriteLock } from './project-lock.js';
import {
  createTemporaryDirectory,
  removeTemporaryDirectory,
} from './test-support.js';

const projectId = 'f31dd9a5-2f55-4bd0-8cf6-f684c41314cc' as ProjectId;
let root: string;
let lockPath: string;

beforeEach(async () => {
  root = await createTemporaryDirectory('a1-lock-');
  lockPath = join(root, '.agent-music', 'locks', 'project-write.lock');
  await mkdir(join(root, '.agent-music', 'locks'), { recursive: true });
});

afterEach(async () => removeTemporaryDirectory(root));

describe('ProjectWriteLock', () => {
  it('rejects a second live owner', async () => {
    const first = await ProjectWriteLock.acquire(root, projectId, () => 'alive');

    await expect(
      ProjectWriteLock.acquire(root, projectId, () => 'alive'),
    ).rejects.toMatchObject({ code: 'PROJECT_WRITE_LOCKED' });

    await first.release();
  });

  it('replaces a stale lock once', async () => {
    await writeFile(
      lockPath,
      JSON.stringify({
        version: 1,
        projectId,
        instanceId: 'stale',
        pid: 999999,
        acquiredAt: new Date(0).toISOString(),
      }),
    );

    const lock = await ProjectWriteLock.acquire(root, projectId, () => 'dead');
    await expect(lock.assertOwned()).resolves.toBeUndefined();
  });

  it('fails closed after its lock token is replaced', async () => {
    const lock = await ProjectWriteLock.acquire(root, projectId, () => 'alive');
    const record = JSON.parse(await readFile(lockPath, 'utf8')) as Record<
      string,
      unknown
    >;
    await writeFile(
      lockPath,
      JSON.stringify({ ...record, instanceId: 'different-owner' }),
    );

    await expect(lock.assertOwned()).rejects.toMatchObject({
      code: 'PROJECT_WRITE_LOCK_LOST',
    });
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-lock.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement atomic lock acquisition with `open(..., 'wx')`**

Use this record and API:

```ts
interface ProjectLockRecord {
  readonly version: 1;
  readonly projectId: ProjectId;
  readonly instanceId: string;
  readonly pid: number;
  readonly acquiredAt: string;
}

export type ProcessState = 'alive' | 'dead';
export type ProcessProbe = (pid: number) => ProcessState;

export class ProjectWriteLock {
  static async acquire(
    projectPath: string,
    projectId: ProjectId,
    processProbe: ProcessProbe = defaultProcessProbe,
  ): Promise<ProjectWriteLock>;

  assertOwned(): Promise<void>;
  release(): Promise<void>;
}
```

Implementation rules:

1. Create `.agent-music/locks` recursively.
2. Generate `instanceId` with `randomUUID()`.
3. Open `project-write.lock` with flags `'wx'` and mode `0o600`.
4. On `EEXIST`, parse the existing record and probe its PID.
5. Treat `ESRCH` as dead and `EPERM` as alive in the default probe.
6. If alive, throw `PROJECT_WRITE_LOCKED`.
7. If dead or malformed, unlink the stale file and retry acquisition exactly once.
8. `assertOwned()` rereads the file and compares `projectId`, `instanceId`, and `pid`.
9. `release()` deletes only a lock still owned by the instance; a replaced lock is left untouched.

- [ ] **Step 4: Run lock tests and typecheck**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-lock.test.ts
pnpm --filter @agent-music/workstation typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the cross-instance lock**

```bash
git add apps/workstation/src/core/project/project-lock.ts apps/workstation/src/core/project/project-lock.test.ts
git commit -m "feat(core): enforce single project writer"
```

---

### Task 5: Implement serialized writes and clean Current authority access

**Files:**

- Create: `apps/workstation/src/core/project/project-write-coordinator.test.ts`
- Create: `apps/workstation/src/core/project/project-write-coordinator.ts`
- Create: `apps/workstation/src/core/project/current-authority.test.ts`
- Create: `apps/workstation/src/core/project/current-authority.ts`
- Create: `apps/workstation/src/core/project/project-authority-access.ts`

**Interfaces:**

- Consumes: `GitAdapter`, `ProjectWriteLock`, and manifest parser.
- Produces: `ProjectWriteCoordinator.run`, internal `ProjectLockOwnership`, `CurrentAuthorityReader.readCleanCurrent`, `restoreCurrent`, `CurrentAuthoritySnapshot`, and internal `ProjectAuthorityAccess`.

- [ ] **Step 1: Write failing FIFO and failure-continuation tests**

Create `project-write-coordinator.test.ts` with a structural fake lock:

```ts
import { describe, expect, it, vi } from 'vitest';

import { ProjectWriteCoordinator } from './project-write-coordinator.js';

describe('ProjectWriteCoordinator', () => {
  it('runs project writes strictly in FIFO order', async () => {
    const assertOwned = vi.fn(async () => undefined);
    const order: string[] = [];
    let releaseGate: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const coordinator = new ProjectWriteCoordinator({ assertOwned });

    const first = coordinator.run(async () => {
      order.push('first:start');
      await gate;
      order.push('first:end');
    });
    const second = coordinator.run(async () => {
      order.push('second');
    });

    releaseGate();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second']);
    expect(assertOwned).toHaveBeenCalledTimes(2);
  });

  it('continues the queue after a failed write', async () => {
    const coordinator = new ProjectWriteCoordinator({
      assertOwned: async () => undefined,
    });

    await expect(
      coordinator.run(async () => {
        throw new Error('injected');
      }),
    ).rejects.toThrow('injected');

    await expect(coordinator.run(async () => 'next')).resolves.toBe('next');
  });
});
```

- [ ] **Step 2: Implement the write coordinator**

Create `project-write-coordinator.ts`:

```ts
export interface ProjectLockOwnership {
  assertOwned(): Promise<void>;
}

export class ProjectWriteCoordinator {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly lock: ProjectLockOwnership) {}

  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(async () => {
      await this.lock.assertOwned();
      return operation();
    });

    this.tail = result.then(
      () => undefined,
      () => undefined,
    );

    return result;
  }
}
```

- [ ] **Step 3: Write failing clean-Current read and recovery tests**

Create a real temporary Git repository, commit valid authority files, then test:

```ts
it('reads both authority files from main HEAD when the worktree is clean', async () => {
  const snapshot = await reader.readCleanCurrent(root);

  expect(snapshot.currentRevision).toMatch(/^[0-9a-f]{40}$/);
  expect(snapshot.manifest.projectId).toBe(projectId);
  expect(snapshot.compositionSource).toContain('V:track.drums');
});

it('rejects dirty Current without adopting the worktree', async () => {
  await writeFile(join(root, 'composition.abc'), 'external change');

  await expect(reader.readCleanCurrent(root)).rejects.toMatchObject({
    code: 'CURRENT_WORKTREE_DIRTY',
  });
});

it('explicitly restores only authority files from main HEAD', async () => {
  await reader.restoreCurrent(root);
  expect(await git.statusPorcelain(root)).toBe('');
});
```

Because an untracked file keeps `git status --porcelain` dirty, recovery must remove untracked authority-independent files only when they are under A1-owned runtime paths; arbitrary user files remain and therefore keep the project fail-closed. The focused recovery test should dirty only the two authority files.

- [ ] **Step 4: Implement Current authority access**

Create `current-authority.ts`:

```ts
import type { ProjectManifest } from '@agent-music/contracts';

import { GitAdapter } from './git-adapter.js';
import { parseProjectManifest } from './project-manifest.js';
import { ProjectError } from './project-error.js';

export interface CurrentAuthoritySnapshot {
  readonly currentRevision: string;
  readonly manifest: ProjectManifest;
  readonly compositionSource: string;
}

export class CurrentAuthorityReader {
  constructor(private readonly git: GitAdapter) {}

  async readCleanCurrent(projectPath: string): Promise<CurrentAuthoritySnapshot> {
    if ((await this.git.statusPorcelain(projectPath)) !== '') {
      throw new ProjectError(
        'CURRENT_WORKTREE_DIRTY',
        'Current worktree contains uncommitted changes',
      );
    }

    const [currentRevision, manifestSource, compositionSource] =
      await Promise.all([
        this.git.mainRevision(projectPath),
        this.git.readMainFile(projectPath, 'project.json'),
        this.git.readMainFile(projectPath, 'composition.abc'),
      ]);

    return {
      currentRevision,
      manifest: parseProjectManifest(manifestSource),
      compositionSource,
    };
  }

  async restoreCurrent(projectPath: string): Promise<void> {
    await this.git.restoreAuthorityFiles(projectPath);
  }
}
```

Create `project-authority-access.ts`:

```ts
import type { CurrentAuthoritySnapshot } from './current-authority.js';

export interface ProjectAuthorityAccess {
  readCleanCurrent(): Promise<CurrentAuthoritySnapshot>;
  runSerializedWrite<T>(operation: () => Promise<T>): Promise<T>;
}
```

This interface is internal to Music Core and must not be exported from `@agent-music/contracts`.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-write-coordinator.test.ts src/core/project/current-authority.test.ts
pnpm --filter @agent-music/workstation typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit authority coordination**

```bash
git add apps/workstation/src/core/project/project-write-coordinator.ts apps/workstation/src/core/project/project-write-coordinator.test.ts apps/workstation/src/core/project/current-authority.ts apps/workstation/src/core/project/current-authority.test.ts apps/workstation/src/core/project/project-authority-access.ts
git commit -m "feat(core): serialize current authority access"
```

---

### Task 6: Implement create, open, explicit recovery, and close

**Files:**

- Create: `apps/workstation/src/core/project/project-foundation.test.ts`
- Create: `apps/workstation/src/core/project/project-foundation.ts`

**Interfaces:**

- Consumes: manifest/fixture creation, `GitAdapter`, `ProjectWriteLock`, `ProjectWriteCoordinator`, and `CurrentAuthorityReader`.
- Produces: `ProjectFoundation.createProject`, `openProject`, `recoverCurrent`, `closeProject`, `readCleanCurrent`, and `runSerializedWrite`.

- [ ] **Step 1: Write failing project-lifecycle tests**

Test these cases with real Git and temporary directories:

```ts
it('creates a clean Initial Current and returns a ready project', async () => {
  const opened = await foundation.createProject(projectPath);

  expect(opened.state).toBe('ready');
  expect(await git.revisionCount(projectPath)).toBe(1);
  expect(await git.statusPorcelain(projectPath)).toBe('');
  expect(await readFile(join(projectPath, 'project.json'), 'utf8')).toContain(
    opened.projectId,
  );
});

it('opens a dirty project as recoveryRequired without changing files', async () => {
  await foundation.createProject(projectPath);
  await foundation.closeProject();
  await writeFile(join(projectPath, 'composition.abc'), 'external change');

  const reopened = await foundation.openProject(projectPath);

  expect(reopened.state).toBe('recoveryRequired');
  expect(await readFile(join(projectPath, 'composition.abc'), 'utf8')).toBe(
    'external change',
  );
});

it('recovers only after explicit recoverCurrent', async () => {
  const recovered = await foundation.recoverCurrent();
  expect(recovered.state).toBe('ready');
  expect(await git.statusPorcelain(projectPath)).toBe('');
});

it('releases the lock on close', async () => {
  await foundation.closeProject();
  await expect(otherFoundation.openProject(projectPath)).resolves.toMatchObject({
    state: 'ready',
  });
});
```

Also test `PROJECT_ALREADY_OPEN`, `PROJECT_DIRECTORY_NOT_EMPTY`, `PROJECT_INVALID`, and `PROJECT_NOT_OPEN`.

- [ ] **Step 2: Run lifecycle tests and verify failure**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-foundation.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement active-session orchestration**

Use this internal session shape:

```ts
interface ProjectSession {
  readonly projectPath: string;
  readonly lock: ProjectWriteLock;
  readonly writes: ProjectWriteCoordinator;
  state: ProjectOpenState;
}
```

Create `ProjectFoundation` with constructor-injected defaults:

```ts
export class ProjectFoundation implements ProjectAuthorityAccess {
  private session: ProjectSession | undefined;

  constructor(
    private readonly git = new GitAdapter(),
    private readonly authority = new CurrentAuthorityReader(git),
  ) {}

  createProject(projectPath: string): Promise<OpenedProject>;
  openProject(projectPath: string): Promise<OpenedProject>;
  recoverCurrent(): Promise<OpenedProject>;
  closeProject(): Promise<void>;
  readCleanCurrent(): Promise<CurrentAuthoritySnapshot>;
  runSerializedWrite<T>(operation: () => Promise<T>): Promise<T>;

  private createInitialComposition(): string {
    return createInitialComposition();
  }
}
```

`createProject` sequence:

1. Reject if another project is active.
2. Resolve the absolute target path.
3. Create the target when absent; when it already exists, require it to be an empty directory or throw `PROJECT_DIRECTORY_NOT_EMPTY`.
4. Create `exports`, `.agent-music/cache`, and `.agent-music/locks`; Git ignores these runtime paths through `.git/info/exclude` rather than a third tracked authority file.
5. Generate a UUID `ProjectId` and acquire the target write lock.
6. Write `project.json` and `composition.abc` with UTF-8 and mode `0o600`.
7. Initialize Git and commit `Initial Current`.
8. Verify clean Current through `CurrentAuthorityReader`.
9. Store the active session and return `state: 'ready'`.
10. On failure before session activation, release the lock; remove the target only when A1 created it, and leave a caller-provided empty directory empty.

`openProject` sequence:

1. Reject if another project is active.
2. Resolve the path and read `project.json` from `main` through `GitAdapter.readMainFile`.
3. Parse the manifest and acquire the project write lock.
4. Create the coordinator and session.
5. If `statusPorcelain()` is empty, return a ready snapshot.
6. If dirty, do not alter files; return `state: 'recoveryRequired'` with the `main` revision and manifest.
7. On invalid repository or manifest, release any acquired lock and throw `PROJECT_INVALID`.

`recoverCurrent` sequence:

1. Require an active session.
2. Run through `ProjectWriteCoordinator`.
3. Restore the two authority files from `main`.
4. Read and validate clean Current.
5. Change session state to `ready` and return the project DTO.

`readCleanCurrent` and `runSerializedWrite` require an active session. `closeProject` is idempotent, releases an owned lock, and clears the session.

- [ ] **Step 4: Run lifecycle tests and typecheck**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-foundation.test.ts
pnpm --filter @agent-music/workstation typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit core project lifecycle support**

```bash
git add apps/workstation/src/core/project/project-foundation.ts apps/workstation/src/core/project/project-foundation.test.ts
git commit -m "feat(core): add project lifecycle foundation"
```

---

### Task 7: Implement Save As with a new project identity and history

**Files:**

- Modify: `apps/workstation/src/core/project/project-foundation.test.ts`
- Modify: `apps/workstation/src/core/project/project-foundation.ts`

**Interfaces:**

- Consumes: active clean Current authority snapshot.
- Produces: `ProjectFoundation.saveProjectAs(targetPath): Promise<OpenedProject>`.

- [ ] **Step 1: Write failing Save As tests**

Add tests that assert:

```ts
it('copies only main authority files into one new Initial Current', async () => {
  const source = await foundation.createProject(sourcePath);
  await writeFile(join(sourcePath, 'exports', 'old.wav'), 'not copied');

  const target = await foundation.saveProjectAs(targetPath);

  expect(target.projectId).not.toBe(source.projectId);
  expect(await git.revisionCount(targetPath)).toBe(1);
  expect(await git.statusPorcelain(targetPath)).toBe('');
  await expect(access(join(targetPath, 'exports', 'old.wav'))).rejects.toThrow();
});

it('keeps the source active when target creation fails', async () => {
  const source = await foundation.createProject(sourcePath);
  await mkdir(targetPath, { recursive: true });
  await writeFile(join(targetPath, 'occupied.txt'), 'occupied');
  await expect(foundation.saveProjectAs(targetPath)).rejects.toMatchObject({
    code: 'PROJECT_DIRECTORY_NOT_EMPTY',
  });
  await expect(foundation.readCleanCurrent()).resolves.toMatchObject({
    manifest: { projectId: source.projectId },
  });
});

it('switches the active lock to the successful target', async () => {
  await foundation.createProject(sourcePath);
  await foundation.saveProjectAs(targetPath);

  const sourceProbe = new ProjectFoundation();
  await expect(sourceProbe.openProject(sourcePath)).resolves.toBeDefined();
  await sourceProbe.closeProject();

  const targetProbe = new ProjectFoundation();
  await expect(targetProbe.openProject(targetPath)).rejects.toMatchObject({
    code: 'PROJECT_WRITE_LOCKED',
  });
});
```

- [ ] **Step 2: Run Save As tests and verify failure**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-foundation.test.ts -t "Save As"
```

Expected: FAIL because `saveProjectAs` is absent.

- [ ] **Step 3: Implement Save As as an atomic session switch**

Add:

```ts
async saveProjectAs(targetPath: string): Promise<OpenedProject> {
  const sourceSession = this.requireSession();
  const sourceSnapshot = await this.readCleanCurrent();
  const targetAbsolutePath = resolve(targetPath);

  const targetProjectId = randomUUID() as ProjectId;
  const targetManifest = createProjectManifest(targetProjectId);

  const targetSession = await this.createRepositoryFromAuthority(
    targetAbsolutePath,
    targetManifest,
    sourceSnapshot.compositionSource,
  );

  await sourceSession.lock.release();
  this.session = targetSession;
  return this.toOpenedProject(targetSession, await this.authority.readCleanCurrent(targetAbsolutePath));
}
```

`createRepositoryFromAuthority` must:

1. Create an absent target or require an existing target to be empty.
2. Create the target `exports`, cache, and lock directories.
3. Acquire the target lock.
4. Write the new manifest and source `main` composition.
5. Initialize Git and commit `Initial Current`.
6. Verify one clean revision.
7. Return a ready target session.
8. On any failure, release the target lock; delete the target only when A1 created it, otherwise return a caller-provided directory to its original empty state.

Do not copy source `.git`, `.agent-music/cache`, exports, Candidate worktrees, SQLite, or any files other than the two authority files.

- [ ] **Step 4: Run lifecycle and Save As tests**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-foundation.test.ts
pnpm --filter @agent-music/workstation typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Save As**

```bash
git add apps/workstation/src/core/project/project-foundation.ts apps/workstation/src/core/project/project-foundation.test.ts
git commit -m "feat(core): add project save as"
```

---

### Task 8: Add the minimal framework-neutral Project IPC handler

**Files:**

- Create: `apps/workstation/src/core/project/project-ipc-handler.test.ts`
- Create: `apps/workstation/src/core/project/project-ipc-handler.ts`
- Create: `apps/workstation/src/core/project/index.ts`

**Interfaces:**

- Consumes: the five `ProjectCommand` variants and a `ProjectFoundationPort` with the five lifecycle methods.
- Produces: one ordered `ProjectEvent` per command and the A1 module entry point.

- [ ] **Step 1: Write failing command-routing and error-normalization tests**

Create a fake port and assert:

```ts
it('routes only the five approved project commands', async () => {
  const event = await handler.handle({
    type: 'project.create',
    requestId: 'request-1',
    projectPath: 'C:/music/demo',
  });

  expect(fake.createProject).toHaveBeenCalledWith('C:/music/demo');
  expect(event).toMatchObject({
    type: 'project.opened',
    requestId: 'request-1',
    sequence: 1,
  });
});

it('increments event sequence and preserves structured Project errors', async () => {
  fake.openProject.mockRejectedValue(
    new ProjectError('PROJECT_WRITE_LOCKED', 'Project is already writable elsewhere'),
  );

  const failed = await handler.handle({
    type: 'project.open',
    requestId: 'request-2',
    projectPath: 'C:/music/demo',
  });

  expect(failed).toEqual({
    type: 'project.failed',
    requestId: 'request-2',
    sequence: 2,
    code: 'PROJECT_WRITE_LOCKED',
    message: 'Project is already writable elsewhere',
  });
});
```

- [ ] **Step 2: Run handler tests and verify failure**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-ipc-handler.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement the five-method port and exhaustive command handler**

Create `project-ipc-handler.ts`:

```ts
import type {
  OpenedProject,
  ProjectCommand,
  ProjectEvent,
} from '@agent-music/contracts';

import { ProjectError } from './project-error.js';

export interface ProjectFoundationPort {
  createProject(projectPath: string): Promise<OpenedProject>;
  openProject(projectPath: string): Promise<OpenedProject>;
  recoverCurrent(): Promise<OpenedProject>;
  saveProjectAs(targetPath: string): Promise<OpenedProject>;
  closeProject(): Promise<void>;
}

export class ProjectIpcHandler {
  private sequence = 0;

  constructor(private readonly foundation: ProjectFoundationPort) {}

  async handle(command: ProjectCommand): Promise<ProjectEvent> {
    const sequence = ++this.sequence;

    try {
      switch (command.type) {
        case 'project.create':
          return this.opened(
            command.requestId,
            sequence,
            await this.foundation.createProject(command.projectPath),
          );
        case 'project.open':
          return this.opened(
            command.requestId,
            sequence,
            await this.foundation.openProject(command.projectPath),
          );
        case 'project.recoverCurrent':
          return this.opened(
            command.requestId,
            sequence,
            await this.foundation.recoverCurrent(),
          );
        case 'project.saveAs':
          return this.opened(
            command.requestId,
            sequence,
            await this.foundation.saveProjectAs(command.targetPath),
          );
        case 'project.close':
          await this.foundation.closeProject();
          return { type: 'project.closed', requestId: command.requestId, sequence };
      }
    } catch (error: unknown) {
      const normalized =
        error instanceof ProjectError
          ? error
          : new ProjectError('PROJECT_INTERNAL_ERROR', 'Unexpected project failure');

      return {
        type: 'project.failed',
        requestId: command.requestId,
        sequence,
        code: normalized.code,
        message: normalized.message,
      };
    }
  }

  private opened(
    requestId: string,
    sequence: number,
    project: OpenedProject,
  ): ProjectEvent {
    return { type: 'project.opened', requestId, sequence, project };
  }
}
```

Create `index.ts` exporting only:

```ts
export { ProjectFoundation } from './project-foundation.js';
export { ProjectIpcHandler } from './project-ipc-handler.js';
export type { ProjectFoundationPort } from './project-ipc-handler.js';
export type { ProjectAuthorityAccess } from './project-authority-access.js';
```

Do not export `GitAdapter`, `ProjectWriteLock`, `ProjectWriteCoordinator`, or raw file helpers from the module entry point.

- [ ] **Step 4: Run handler tests and the complete A1 unit suite**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project
pnpm --filter @agent-music/workstation typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit the Project IPC seam**

```bash
git add apps/workstation/src/core/project/project-ipc-handler.ts apps/workstation/src/core/project/project-ipc-handler.test.ts apps/workstation/src/core/project/index.ts
git commit -m "feat(core): expose project lifecycle commands"
```

---

### Task 9: Add A1 real-Git integration and fault regression coverage

**Files:**

- Create: `apps/workstation/src/core/project/project-foundation.integration.test.ts`
- Modify: `apps/workstation/src/core/project/test-support.ts`

**Interfaces:**

- Consumes: the complete public A1 surface and real Git CLI.
- Produces: regression evidence for TG-005/TG-006-derived A1 behavior.

- [ ] **Step 1: Add real filesystem and Git integration cases**

Create tests covering all of these scenarios:

1. Create/open/close/reopen under a path containing Chinese characters and spaces.
2. Create under a nested path whose total path length exceeds 300 characters on the current CI platform.
3. Dirty `project.json` returns `recoveryRequired`; explicit recovery restores the committed manifest.
4. Dirty `composition.abc` returns `recoveryRequired`; explicit recovery restores the committed fixture.
5. A second `ProjectFoundation` cannot open a live-locked project.
6. A stale lock with a dead PID is replaced and the project opens.
7. Replacing the active lock token causes `runSerializedWrite` to fail with `PROJECT_WRITE_LOCK_LOST` before the callback runs.
8. Three concurrent writes execute in FIFO order.
9. Save As creates a new project ID, one commit, no old Git history, no exports, and no cache.
10. A failed Save As leaves the source lock and source Current usable.
11. Recovery never reads SQLite, cache, Candidate, or export data.
12. `git status --porcelain` is empty after successful create, recovery, and Save As.

Use `describe.sequential` because the tests exercise process-level locks and real Git repositories.

- [ ] **Step 2: Run integration tests alone**

```bash
pnpm --filter @agent-music/workstation test -- src/core/project/project-foundation.integration.test.ts
```

Expected: PASS with real Git available.

- [ ] **Step 3: Run complete repository verification**

```bash
pnpm install --frozen-lockfile
pnpm check
git diff --check
git status --short
```

Expected:

- install exits 0 without lockfile changes;
- formatting, lint, typecheck, and all tests pass;
- `git diff --check` exits 0;
- `git status --short` lists only the intended A1 implementation files before commit.

- [ ] **Step 4: Inspect the final A1 dependency surface**

Run:

```bash
rg "child_process|fs/promises|GitAdapter|ProjectWriteLock" packages/contracts apps/workstation/src/core/project/index.ts
```

Expected:

- no Node filesystem or Git implementation appears in `packages/contracts`;
- `index.ts` does not export `GitAdapter` or `ProjectWriteLock`;
- the five lifecycle methods remain the only Renderer-facing project operations.

- [ ] **Step 5: Commit A1 integration coverage**

```bash
git add apps/workstation/src/core/project/project-foundation.integration.test.ts apps/workstation/src/core/project/test-support.ts
git commit -m "test(core): cover project foundation recovery"
```

---

## A1 Completion Gate

A1 is complete only when all of the following are demonstrated by tests and repository inspection:

- `createProject()` creates `project.json`, `composition.abc`, `exports`, `.agent-music/cache`, `.agent-music/locks`, `.git`, `main`, and one Initial Current commit while keeping runtime paths ignored through `.git/info/exclude`.
- `createInitialComposition()` exists inside the A1 creation path and produces the deterministic A1 fixture.
- `openProject()` validates `main` and returns either `ready` or `recoveryRequired` without automatically adopting dirty files.
- `recoverCurrent()` restores only the two authority files from `main` HEAD.
- `saveProjectAs()` produces a new `projectId`, a new one-commit Git history, and no old ephemeral data.
- `closeProject()` releases only its owned project lock and is safe to call repeatedly.
- The in-process write coordinator serializes writes and continues after failed operations.
- The cross-instance lock blocks a second live writer, cleans stale locks, and detects ownership loss before writes.
- A3/A5 can later depend on `ProjectAuthorityAccess` without importing A1 filesystem, Git, or lock internals.
- The Project IPC seam exposes exactly five commands and structured ordered events.
- `pnpm check`, real-Git integration tests, `git diff --check`, and the public-surface inspection all pass.
