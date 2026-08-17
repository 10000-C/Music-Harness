# A3 Candidate Transaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement A3 Candidate Transaction as the single owner of Candidate/Task authorization, Git/worktree transaction semantics, Scope Extension, checkpoint, Cancel/Reject, Accept, cleanup recovery, and stable Candidate Command/Event contracts without moving A4 Agent workflow or A2 music-domain logic into A3.

**Architecture:** A3 is a deep module with two role-oriented interfaces backed by one transaction implementation: an Agent-facing interface for Task-bound reads/writes/`finishTask`, and a Renderer/Core control interface for Task creation, cancellation, Scope Extension approval, Accept/Reject, and project-open reconciliation. Candidate Git/worktree and cleanup-marker details stay internal. A3 depends on A1 for current project path, clean Current reads, and serialized Current writes; it delegates all musical transformation/validation to A2 `CompositionPipeline`.

**Tech Stack:** TypeScript 5.9, Node.js 24.18.1, pnpm 9.15.9, Vitest 4.1, Node `fs/promises`, native Git CLI via `execFile`, existing A1 Project Foundation and A2 Composition Pipeline.

## Global Constraints

- Work on branch `feat/a3`; do not merge or push unless explicitly requested.
- Runtime baseline is Node.js `24.18.1`; repository engine is `>=24 <25`. Before executing tests, `node --version` must report a Node 24 build.
- Do not add runtime dependencies for A3. Use native Git CLI and Node standard library.
- P0 has at most one **business Active Candidate** per project; PendingCleanup/orphan resources do not count as business Candidates.
- One Candidate uses exactly one `candidate/<candidateId>` branch and one `.agent-music/worktrees/<candidateId>/` linked worktree. Multiple Tasks reuse that worktree.
- Formal A3 Task/TaskContext is created only after user confirmation. `planning`, `awaiting_confirmation`, model configuration, and repair policy belong to A4.
- `Candidate.baseRevision` is immutable for the Candidate lifetime. `Task.taskBaseCheckpoint` is a separate rollback pointer.
- `taskId`, `candidateId`, and Scope Extension request IDs are globally unique UUIDs.
- Except for `getTaskContext({ taskId })`, every Task-bound Agent call carries `taskId/projectId/candidateId/baseRevision/expectedScopeRevision`.
- Scope Extension may only expand the current Scope. A3 alone mutates `scope` and `scopeRevision`; a pending extension blocks writes, `finishTask`, and another extension request.
- `allowedOperations` is derived from current Scope and P0 capability; it is never persisted as an independent authority field.
- Ordinary Candidate mutations are not queued. If one is active, a new ordinary mutation fails with `TASK_BUSY`.
- Cancel/Reject invalidate authorization immediately and are not rejected by `TASK_BUSY`. They may await an already-entered final write before applying rollback/cleanup so the final visible state still reflects Cancel/Reject.
- P0 Candidate business changes may affect only `composition.abc`. `project.json` must equal the Candidate base revision. Other non-ignored changes fail closed.
- Every successful Task creates a unique checkpoint commit with `--allow-empty`, staging only `composition.abc`.
- Every successful Accept creates a unique new `main` commit with `--allow-empty`.
- Accept linearizes at successful new `main` commit. Pre-commit failure preserves the old Current and Candidate; cleanup failure after commit does not roll Current back.
- Reject linearizes when Candidate/Task authorization is invalidated and the Candidate business object ends. Physical cleanup failure does not make Reject fail.
- Automatic cleanup requires `.agent-music/candidate-cleanup/<candidateId>.json` with a valid marker. Branch/worktree paths are derived from `candidateId`; marker paths are never trusted.
- Project open does not recover an unfinished Candidate or Task. A resource without a cleanup marker is reported as orphan and is neither restored nor automatically deleted.
- A3 exposes stable error codes plus structured details. Raw Git stderr, filesystem error strings, and parser exception text do not cross the A3 interface.
- Tests exercise agreed seams: `packages/contracts` runtime guards, `ProjectFoundation`/`ProjectAuthorityAccess`, `CandidateRepository` as the real Git adapter seam, `CandidateTransaction` as the primary business seam, cleanup reconciliation, and `CandidateIpcHandler`. Do not test private methods directly.
- Follow red → green vertically: one behavioral test, observe failure, add the minimum implementation, rerun, then commit. Do not write all tests before implementation.

---

## File Structure

### Shared contracts

- Create `packages/contracts/src/candidate.ts` — Candidate/Task product states, execution envelope, Scope Extension request ID, stable A3 error codes, Candidate Command/Event, runtime guards for data that crosses process/MCP seams.
- Create `packages/contracts/src/candidate.test.ts` — contract/guard behavior.
- Modify `packages/contracts/src/index.ts` — export the new A3 contracts.

### A1 seam adjustment

- Modify `apps/workstation/src/core/project/project-authority-access.ts` — add Core-internal `getProjectPath(): string`.
- Modify `apps/workstation/src/core/project/project-foundation.ts` — implement `getProjectPath()` from the active session.
- Modify `apps/workstation/src/core/project/project-foundation.test.ts` — prove path exposure requires an open project and returns the canonical active path.

### A3 implementation

- Create `apps/workstation/src/core/candidate/candidate-error.ts` — stable error object and lower-level error mapping.
- Create `apps/workstation/src/core/candidate/candidate-repository.ts` — real Git/worktree adapter; candidate creation, authority reads, atomic composition write, change inspection, checkpoint/reset, Current commit, resource listing/removal.
- Create `apps/workstation/src/core/candidate/candidate-repository.integration.test.ts` — actual Git behavior including `.agent-music` worktree, allow-empty checkpoint, reset, Current commit rollback before linearization.
- Create `apps/workstation/src/core/candidate/candidate-cleanup.ts` — cleanup marker registry and reconciliation using reserved paths derived from Candidate ID.
- Create `apps/workstation/src/core/candidate/candidate-cleanup.integration.test.ts` — marker persistence, authorized cleanup, orphan preservation.
- Create `apps/workstation/src/core/candidate/candidate-transaction.ts` — deep A3 module; Candidate/Task state, both role interfaces, baseline/envelope guards, Scope Extension, mutation lease, A2 calls, `finishTask`, Cancel/Reject, Accept.
- Create `apps/workstation/src/core/candidate/candidate-transaction.test.ts` — primary A3 business behavior through the public A3 interfaces with fakes at A1/A2/repository/cleanup seams.
- Create `apps/workstation/src/core/candidate/candidate-transaction.integration.test.ts` — real A1 + real A2 + real Git lifecycle tracer bullets.
- Create `apps/workstation/src/core/candidate/candidate-ipc-handler.ts` — Renderer/Core Candidate Command → A3 control interface adapter and Candidate Event mapping.
- Create `apps/workstation/src/core/candidate/candidate-ipc-handler.test.ts` — stable product events/errors without Git implementation fields.
- Create `apps/workstation/src/core/candidate/index.ts` — only supported A3 exports.

### Existing modules intentionally not expanded

- Do **not** add Candidate lifecycle methods to `apps/workstation/src/core/project/git-adapter.ts`; A1 remains Current/Project Foundation.
- Do **not** move `replaceScopedMusic`, `updateGlobalMeter`, parser, Scope Mapping, meter consistency, or MIDI logic out of `apps/workstation/src/core/composition/`.
- Do **not** implement MCP transport, Provider/Mastra loop, planning, confirmation orchestration, or repair limits in A3; those are A4.
- Do **not** introduce RuntimeSnapshot/openDAW dependencies into A3.

---

## Target A3 Interfaces

The implementation may keep supporting types private, but callers must see no more than these role-oriented capabilities.

```ts
export interface CandidateAgentPort {
  getTaskContext(taskId: TaskId): Promise<TaskContextView>;
  getScopedComposition(
    envelope: TaskExecutionEnvelope,
  ): Promise<ScopedComposition>;
  requestScopeExtension(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly requestedScope: TaskScope;
  }): Promise<PendingScopeExtensionView>;
  applyScopedMusicChange(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly replacements: readonly TrackReplacement[];
  }): Promise<CompositionCompilation>;
  updateGlobalMeter(input: {
    readonly envelope: TaskExecutionEnvelope;
    readonly numerator: number;
    readonly denominator: number;
  }): Promise<CompositionCompilation>;
  finishTask(
    envelope: TaskExecutionEnvelope,
  ): Promise<FinishTaskResult>;
}

export interface CandidateControlPort {
  startTask(input: {
    readonly projectId: ProjectId;
    readonly scope: TaskScope;
  }): Promise<TaskContextView>;
  cancelTask(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
    readonly taskId: TaskId;
  }): Promise<CandidateView | undefined>;
  approveScopeExtension(input: {
    readonly taskId: TaskId;
    readonly requestId: ScopeExtensionRequestId;
  }): Promise<TaskContextView>;
  rejectScopeExtension(input: {
    readonly taskId: TaskId;
    readonly requestId: ScopeExtensionRequestId;
  }): Promise<TaskContextView>;
  acceptCandidate(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
  }): Promise<CurrentCommittedResult>;
  rejectCandidate(input: {
    readonly projectId: ProjectId;
    readonly candidateId: CandidateId;
  }): Promise<void>;
  reconcileProjectResources(): Promise<CandidateRecoveryReport>;
}
```

A4 maps MCP name `replaceScopedMusic` to A3 `applyScopedMusicChange`; A2 retains its existing `CompositionPipeline.replaceScopedMusic`. This avoids making A3 and A2 appear to own the same operation.

---

### Task 1: Freeze Candidate/Task Contracts

**Files:**
- Create: `packages/contracts/src/candidate.ts`
- Create: `packages/contracts/src/candidate.test.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: existing `ProjectId`, `TaskId`, `CandidateId`, `TaskScope`, `TrackId` from `packages/contracts/src/domain.ts`.
- Produces: `ScopeExtensionRequestId`, `CandidateState`, `TaskState`, `CandidateOperation`, `TaskExecutionEnvelope`, `TaskContextView`, `CandidateView`, `PendingScopeExtensionView`, `FinishTaskResult`, `CurrentCommittedResult`, `CandidateRecoveryReport`, `CandidateErrorCode`, `CandidateCommand`, `CandidateEvent`, and runtime guards used by A3/A4/B4.

- [ ] **Step 1: Write the failing contract tests**

Create tests that pin the execution envelope and prohibit accidental acceptance of missing/stale routing fields:

```ts
import { describe, expect, it } from 'vitest';
import {
  isTaskExecutionEnvelope,
  type TaskExecutionEnvelope,
} from './candidate.js';

describe('TaskExecutionEnvelope', () => {
  it('requires the complete task/candidate/base/scope revision tuple', () => {
    const envelope: TaskExecutionEnvelope = {
      taskId: '00000000-0000-4000-8000-000000000001' as never,
      projectId: '00000000-0000-4000-8000-000000000002' as never,
      candidateId: '00000000-0000-4000-8000-000000000003' as never,
      baseRevision: '0123456789abcdef',
      expectedScopeRevision: 3,
    };

    expect(isTaskExecutionEnvelope(envelope)).toBe(true);
    expect(
      isTaskExecutionEnvelope({
        ...envelope,
        expectedScopeRevision: -1,
      }),
    ).toBe(false);
    const { candidateId: _candidateId, ...missingCandidate } = envelope;
    expect(isTaskExecutionEnvelope(missingCandidate)).toBe(false);
  });
});
```

Also assert the stable error-code set contains at least:

```ts
TASK_BUSY
TASK_NOT_ACTIVE
TASK_PROJECT_MISMATCH
TASK_CANDIDATE_MISMATCH
TASK_BASE_REVISION_MISMATCH
TASK_SCOPE_EXTENSION_PENDING
STALE_SCOPE_REVISION
STALE_SCOPE_EXTENSION_REQUEST
SCOPE_EXTENSION_NOT_SUPERSET
OPERATION_NOT_ALLOWED
CANDIDATE_NOT_FOUND
CANDIDATE_NOT_READY
CANDIDATE_STALE
CURRENT_NOT_CLEAN
CANDIDATE_BASELINE_CHANGED
UNEXPECTED_CANDIDATE_CHANGE
VALIDATION_FAILED
CANDIDATE_TRANSACTION_FAILED
ORPHAN_CANDIDATE_RESOURCE
```

- [ ] **Step 2: Run the contract test and confirm red**

Run:

```bash
pnpm exec vitest run --config vitest.config.ts packages/contracts/src/candidate.test.ts
```

Expected: FAIL because `candidate.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimum contract module**

Define the canonical states exactly:

```ts
export type CandidateState = 'active' | 'ready' | 'accepting' | 'stale';
export type TaskState = 'editing' | 'validating';
export type CandidateOperation = 'replaceScopedMusic' | 'updateGlobalMeter';

export interface TaskExecutionEnvelope {
  readonly taskId: TaskId;
  readonly projectId: ProjectId;
  readonly candidateId: CandidateId;
  readonly baseRevision: string;
  readonly expectedScopeRevision: number;
}
```

`TaskContextView` exposes current `scopeRevision`, not `expectedScopeRevision`; callers copy the current value into the next request envelope. `CandidateView` must contain product state only and must not contain `branchName`, `worktreePath`, `latestCheckpoint`, or cleanup paths.

Define Renderer control commands for:

```text
candidate.startTask
candidate.cancelTask
candidate.approveScopeExtension
candidate.rejectScopeExtension
candidate.accept
candidate.reject
```

Define Core events for:

```text
candidate.changed
task.changed
candidate.scopeExtensionRequested
candidate.validationResult
candidate.currentCommitted
candidate.invalidated
candidate.failed
```

- [ ] **Step 4: Run contract tests and the existing contracts suite**

```bash
pnpm exec vitest run --config vitest.config.ts \
  packages/contracts/src/candidate.test.ts \
  packages/contracts/src/domain.test.ts \
  packages/contracts/src/project.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the contract slice**

```bash
git add packages/contracts/src/candidate.ts \
  packages/contracts/src/candidate.test.ts \
  packages/contracts/src/index.ts
git commit -m "feat(contracts): add candidate transaction contracts"
```

---

### Task 2: Add the A1 Project-Path Seam

**Files:**
- Modify: `apps/workstation/src/core/project/project-authority-access.ts`
- Modify: `apps/workstation/src/core/project/project-foundation.ts`
- Modify: `apps/workstation/src/core/project/project-foundation.test.ts`

**Interfaces:**
- Consumes: existing active `ProjectSession` owned by `ProjectFoundation`.
- Produces: `ProjectAuthorityAccess.getProjectPath(): string` for Core-internal A3 use. No Renderer/Agent contract changes.

- [ ] **Step 1: Write the failing ProjectFoundation tests**

Add behavior through `ProjectFoundation`:

```ts
it('exposes the active canonical project path to Core modules', async () => {
  const projectPath = await createTemporaryProjectPath();
  const foundation = new ProjectFoundation();
  await foundation.createProject(projectPath);

  expect(foundation.getProjectPath()).toBe(resolve(projectPath));
});

it('does not expose a project path when no project is open', () => {
  const foundation = new ProjectFoundation();
  expect(() => foundation.getProjectPath()).toThrowError(
    expect.objectContaining({ code: 'PROJECT_NOT_OPEN' }),
  );
});
```

Use the existing test support helpers in the file rather than introducing a second temporary-project helper.

- [ ] **Step 2: Run the focused A1 test and confirm red**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/project/project-foundation.test.ts
```

Expected: FAIL because `getProjectPath` is missing.

- [ ] **Step 3: Implement the minimum seam**

In `ProjectAuthorityAccess` add:

```ts
getProjectPath(): string;
```

In `ProjectFoundation` implement:

```ts
getProjectPath(): string {
  return this.requireSession().projectPath;
}
```

Do not expose the Project write lock, `GitAdapter`, or `ProjectWriteCoordinator`.

- [ ] **Step 4: Run A1 regression tests**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/project/project-foundation.test.ts \
  apps/workstation/src/core/project/project-foundation.integration.test.ts \
  apps/workstation/src/core/project/current-authority.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the A1 seam**

```bash
git add apps/workstation/src/core/project/project-authority-access.ts \
  apps/workstation/src/core/project/project-foundation.ts \
  apps/workstation/src/core/project/project-foundation.test.ts
git commit -m "feat(core): expose active project path internally"
```

---

### Task 3: Implement the Candidate Git Repository Adapter

**Files:**
- Create: `apps/workstation/src/core/candidate/candidate-repository.ts`
- Create: `apps/workstation/src/core/candidate/candidate-repository.integration.test.ts`

**Interfaces:**
- Consumes: a project repository path and generated `CandidateId`; native Git and filesystem.
- Produces: an internal `CandidateRepository` interface that hides branch/worktree commands from `CandidateTransaction`.

Use this internal shape:

```ts
interface CandidateWorkspace {
  readonly candidateId: CandidateId;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly baseRevision: string;
}

interface CandidateAuthoritySnapshot {
  readonly projectManifestSource: string;
  readonly compositionSource: string;
}

interface CandidateChangeSet {
  readonly compositionChanged: boolean;
  readonly projectJsonChangedFromBase: boolean;
  readonly unexpectedPaths: readonly string[];
}

interface CandidateRepository {
  create(
    projectPath: string,
    candidateId: CandidateId,
    baseRevision: string,
  ): Promise<CandidateWorkspace>;
  readAuthority(workspace: CandidateWorkspace): Promise<CandidateAuthoritySnapshot>;
  writeComposition(
    workspace: CandidateWorkspace,
    compositionSource: string,
  ): Promise<void>;
  inspectChanges(workspace: CandidateWorkspace): Promise<CandidateChangeSet>;
  createCheckpoint(
    workspace: CandidateWorkspace,
    message: string,
  ): Promise<string>;
  resetTo(workspace: CandidateWorkspace, revision: string): Promise<void>;
  commitCompositionToCurrent(
    projectPath: string,
    workspace: CandidateWorkspace,
    message: string,
  ): Promise<string>;
  remove(workspace: CandidateWorkspace): Promise<void>;
  listCandidateResourceIds(projectPath: string): Promise<readonly CandidateId[]>;
}
```

- [ ] **Step 1: Write the first real-Git integration test for Candidate creation**

Test against a temporary repository created through `ProjectFoundation` and use a path containing both a space and Chinese characters. Assert:

```ts
const workspace = await repository.create(
  projectPath,
  candidateId,
  current.currentRevision,
);

expect(workspace.branchName).toBe(`candidate/${candidateId}`);
expect(workspace.worktreePath).toBe(
  join(projectPath, '.agent-music', 'worktrees', candidateId),
);
expect(await gitStatus(projectPath)).toBe('');
```

Also read `composition.abc` through `readAuthority` and assert it equals the Current source.

- [ ] **Step 2: Run the Candidate repository test and confirm red**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-repository.integration.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement `create`, `readAuthority`, and atomic `writeComposition`**

Create the linked worktree with argument arrays, never shell-string concatenation:

```text
git -C <project> worktree add -b candidate/<id> <worktreePath> <baseRevision>
```

For composition writes:

```text
write temporary sibling file
→ fsync/close through writeFile completion
→ rename temp over composition.abc
```

Use a unique temporary filename in the same directory so rename remains on the same filesystem.

- [ ] **Step 4: Add red/green tests for change inspection and checkpoint/reset**

Pin these behaviors:

1. Editing only `composition.abc` yields `compositionChanged=true`, `projectJsonChangedFromBase=false`, no unexpected paths.
2. Editing `project.json` is visible as `projectJsonChangedFromBase=true`.
3. Committing a changed `project.json` inside the Candidate branch is **still** `projectJsonChangedFromBase=true`; the check is against `workspace.baseRevision:project.json`, not only `git status`.
4. Adding or committing `rogue.txt` appears in `unexpectedPaths`; inspect the effective Candidate tree/worktree against `baseRevision`, then merge non-ignored untracked paths from `git status --porcelain --untracked-files=all`.
5. `createCheckpoint` stages only `composition.abc` and uses `git commit --allow-empty`, so two unchanged checkpoints have different SHA values.
6. `resetTo` restores worktree/index to the requested checkpoint.

The checkpoint command must be equivalent to:

```text
git add -- composition.abc
git commit --allow-empty -m <message>
```

- [ ] **Step 5: Add red/green tests for Current commit pre-linearization rollback**

Install a temporary `.git/hooks/pre-commit` hook that exits non-zero. Call `commitCompositionToCurrent` and assert:

```text
main SHA unchanged
main worktree clean
authority files restored
Candidate branch/worktree still exist
```

Remove the hook and retry; assert a new `main` SHA is produced. The method must return immediately after the `main` commit and must not perform Candidate cleanup.

Implementation sequence:

```text
copy Candidate composition.abc into main worktree
→ git add -- composition.abc
→ git commit --allow-empty
→ rev-parse main
```

On any failure before commit success:

```text
git restore --source main --staged --worktree -- project.json composition.abc
```

then rethrow a repository error.

- [ ] **Step 6: Run the repository integration test**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-repository.integration.test.ts
```

Expected: PASS and root Current worktree remains clean after every case.

- [ ] **Step 7: Commit the repository adapter**

```bash
git add apps/workstation/src/core/candidate/candidate-repository.ts \
  apps/workstation/src/core/candidate/candidate-repository.integration.test.ts
git commit -m "feat(core): add candidate git repository"
```

---

### Task 4: Add Cleanup Markers and Safe Reconciliation

**Files:**
- Create: `apps/workstation/src/core/candidate/candidate-cleanup.ts`
- Create: `apps/workstation/src/core/candidate/candidate-cleanup.integration.test.ts`

**Interfaces:**
- Consumes: `CandidateRepository.remove/listCandidateResourceIds`, project path, Candidate ID.
- Produces: cleanup authorization marker persistence and `reconcileProjectResources()` data for A3.

Use marker format exactly:

```ts
interface CandidateCleanupMarker {
  readonly version: 1;
  readonly candidateId: CandidateId;
  readonly cleanupAllowed: true;
}
```

Marker path:

```text
.agent-music/candidate-cleanup/<candidateId>.json
```

Never read branch/worktree paths from marker JSON. Derive them from Candidate ID.

- [ ] **Step 1: Write the marker persistence test**

Assert `authorizeCleanup(projectPath, candidateId)` writes a marker atomically and `listAuthorized` returns only valid version-1 UUID markers with `cleanupAllowed === true`.

Malformed JSON, wrong version, `cleanupAllowed:false`, or a non-UUID filename must not authorize deletion.

- [ ] **Step 2: Run the cleanup test and confirm red**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-cleanup.integration.test.ts
```

Expected: FAIL because cleanup support is missing.

- [ ] **Step 3: Implement marker persistence and clearing**

Write `candidate-cleanup.ts` with a small internal registry:

```ts
class CandidateCleanupRegistry {
  authorize(projectPath: string, candidateId: CandidateId): Promise<void>;
  listAuthorized(projectPath: string): Promise<readonly CandidateId[]>;
  clear(projectPath: string, candidateId: CandidateId): Promise<void>;
}

interface CandidateCleanupManager {
  authorizeAndAttempt(
    projectPath: string,
    workspace: CandidateWorkspace,
  ): Promise<void>;
  reconcile(projectPath: string): Promise<CandidateRecoveryReport>;
}
```

`authorizeAndAttempt` writes the marker **before** calling `CandidateRepository.remove`; successful removal clears the marker, while failure leaves it pending. Use temp-file + rename for marker writes.

- [ ] **Step 4: Write the reconciliation behavior test**

Arrange three resource IDs:

```text
A: resource + valid marker
B: resource + valid marker, repository.remove throws
C: resource without marker
```

Expected report:

```ts
{
  cleanedCandidateIds: [A],
  pendingCandidateIds: [B],
  orphanCandidateIds: [C],
}
```

Marker A is deleted after successful cleanup; marker B remains; C is untouched.

- [ ] **Step 5: Implement `CandidateCleanupManager.reconcile`**

The manager must only call repository removal for authorized IDs. `orphanCandidateIds` is the set difference `resourceIds - markerIds`. Cleanup failures are collected as pending rather than thrown as a project-open failure.

- [ ] **Step 6: Run cleanup and Candidate repository integration tests together**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-cleanup.integration.test.ts \
  apps/workstation/src/core/candidate/candidate-repository.integration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit cleanup infrastructure**

```bash
git add apps/workstation/src/core/candidate/candidate-cleanup.ts \
  apps/workstation/src/core/candidate/candidate-cleanup.integration.test.ts
git commit -m "feat(core): add candidate cleanup markers"
```

---

### Task 5: Implement Candidate/Task Lifecycle and Stable Errors

**Files:**
- Create: `apps/workstation/src/core/candidate/candidate-error.ts`
- Create: `apps/workstation/src/core/candidate/candidate-transaction.ts`
- Create: `apps/workstation/src/core/candidate/candidate-transaction.test.ts`
- Create: `apps/workstation/src/core/candidate/index.ts`

**Interfaces:**
- Consumes: `ProjectAuthorityAccess`, `CandidateRepository`, `CandidateCleanupManager`, `CompositionPipeline`-compatible port, UUID/time factories.
- Produces: `CandidateAgentPort` and `CandidateControlPort` from the Target A3 Interfaces section.

Use dependency injection so unit tests can hold Git/A2 at the seam:

```ts
interface CandidateTransactionDependencies {
  readonly project: ProjectAuthorityAccess;
  readonly composition: Pick<
    CompositionPipeline,
    | 'compileCanonical'
    | 'getScopedComposition'
    | 'replaceScopedMusic'
    | 'updateGlobalMeter'
    | 'validateFinalMeterConsistency'
  >;
  readonly repository: CandidateRepository;
  readonly cleanup: CandidateCleanupManager;
  readonly createId: () => string;
  readonly now: () => string;
}
```

- [ ] **Step 1: Write a red tracer test for first Task creation**

Arrange A1 `readCleanCurrent()` returning:

```ts
{
  currentRevision: 'C0',
  manifest: validManifest,
  compositionSource: initialAbc,
}
```

Call:

```ts
const task = await transaction.startTask({
  projectId: validManifest.projectId,
  scope: wholeProjectScope,
});
```

Assert:

```text
repository.create(projectPath, generatedCandidateId, C0) called once
Candidate state = active
Task state = editing
Task scopeRevision = 0
Candidate baseRevision = C0
taskBaseCheckpoint = C0
```

No `userIntent`, model configuration, repair counter, worktree path, or checkpoint SHA appears in the returned `TaskContextView`.

- [ ] **Step 2: Run and confirm red**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts
```

Expected: FAIL because `CandidateTransaction` is missing.

- [ ] **Step 3: Implement minimal in-memory Candidate/Active Task state**

Use a private Candidate record equivalent to:

```ts
interface CandidateRecord {
  readonly candidateId: CandidateId;
  readonly projectId: ProjectId;
  readonly baseRevision: string;
  readonly workspace: CandidateWorkspace;
  state: CandidateState;
  latestCheckpoint?: string;
  activeTask?: ActiveTask;
}
```

Do not persist completed/cancelled TaskContext objects in A3.

- [ ] **Step 4: Add red/green behavior for Ready Candidate reuse**

Using a test-only fake repository, arrange a Candidate with `latestCheckpoint='P1'` and state `ready`, then call `startTask` again. Assert no new Candidate/worktree is created and the new Task uses `taskBaseCheckpoint='P1'` with a new globally unique Task ID.

Attempting `startTask` while Candidate is `active`, `accepting`, or `stale` must return a stable Candidate error rather than create another Candidate.

- [ ] **Step 5: Add red/green Cancel behavior**

Case A — first Task, no successful checkpoint:

```text
cancelTask
→ active Task authorization removed immediately
→ repository.resetTo(C0)
→ Candidate business object removed
→ cleanup marker authorized
→ best-effort cleanup
→ returned CandidateView is undefined
```

Case B — later Task with `latestCheckpoint=P1`:

```text
cancelTask
→ authorization removed
→ repository.resetTo(P1)
→ Candidate state ready
→ Candidate remains
```

- [ ] **Step 6: Add red/green strong Reject behavior**

Reject must be callable with an Active Task. Assert Task/Candidate authorization disappears before cleanup is attempted. If cleanup removal throws, `rejectCandidate` still resolves successfully and the cleanup marker remains pending.

- [ ] **Step 7: Implement `CandidateError` and lower-level mapping**

Use:

```ts
export class CandidateError extends Error {
  constructor(
    readonly code: CandidateErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}
```

Map A1 `CURRENT_WORKTREE_DIRTY` to `CURRENT_NOT_CLEAN`. Do not place raw lower-level exception messages into public `details`.

- [ ] **Step 8: Run the lifecycle tests**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit the lifecycle slice**

```bash
git add apps/workstation/src/core/candidate/candidate-error.ts \
  apps/workstation/src/core/candidate/candidate-transaction.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts \
  apps/workstation/src/core/candidate/index.ts
git commit -m "feat(core): add candidate task lifecycle"
```

---

### Task 6: Add Execution-Envelope and Scope-Extension Authorization

**Files:**
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.ts`
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.test.ts`

**Interfaces:**
- Consumes: `TaskExecutionEnvelope`, current Active Task/Candidate, `TaskScope`.
- Produces: envelope guard, derived operations, Scope Extension request/approve/reject behavior.

- [ ] **Step 1: Write the envelope mismatch table test**

For one active task, mutate one field at a time:

```text
wrong taskId        → TASK_NOT_ACTIVE
wrong projectId     → TASK_PROJECT_MISMATCH
wrong candidateId   → TASK_CANDIDATE_MISMATCH
wrong baseRevision  → TASK_BASE_REVISION_MISMATCH
old scope revision  → STALE_SCOPE_REVISION
```

The test must assert the repository/A2 mutation collaborator is not called after a failed guard.

- [ ] **Step 2: Implement the shared Task-bound guard**

Guard order:

```text
resolve Active Task by taskId
→ compare projectId; mismatch => TASK_PROJECT_MISMATCH
→ compare candidateId; mismatch => TASK_CANDIDATE_MISMATCH
→ compare request baseRevision with Candidate.baseRevision;
     mismatch => TASK_BASE_REVISION_MISMATCH without mutating Candidate state
→ read clean Current from A1
→ if Current dirty: CURRENT_NOT_CLEAN, Candidate remains usable after recovery
→ if main revision != Candidate.baseRevision:
     state = stale
     activeTask = undefined
     return CANDIDATE_BASELINE_CHANGED
→ compare expectedScopeRevision
→ enforce operation-specific Candidate/Task state
```

Subsequent calls on the stale Candidate return `CANDIDATE_STALE`; only Reject is accepted.

- [ ] **Step 3: Write derived-operation tests**

Expected behavior:

```text
timeRange scope                    → replaceScopedMusic
wholeProject with subset tracks    → replaceScopedMusic
wholeProject covering all 6 tracks → replaceScopedMusic + updateGlobalMeter
```

`getTaskContext(taskId)` returns these computed values without storing them in the Active Task record.

- [ ] **Step 4: Write Scope Extension red tests**

Cover:

1. expanding track set is accepted;
2. expanding time range is accepted;
3. timeRange → wholeProject with a superset of tracks is accepted;
4. shrinking track set is rejected with `SCOPE_EXTENSION_NOT_SUPERSET`;
5. moving to a disjoint time range is rejected;
6. second request while pending returns `TASK_SCOPE_EXTENSION_PENDING`;
7. writes and `finishTask` while pending return `TASK_SCOPE_EXTENSION_PENDING`;
8. `getScopedComposition` is still allowed read-only with the current scope/revision while approval is pending;
9. stale approval request ID returns `STALE_SCOPE_EXTENSION_REQUEST`;
10. approval whose `fromScopeRevision` is no longer current is stale;
11. approval increments `scopeRevision` exactly once; rejection leaves it unchanged.

- [ ] **Step 5: Implement Scope superset and Pending request logic**

For track authorization, require every old track ID to exist in the requested scope. For time authorization:

```text
old wholeProject → requested must be wholeProject
old timeRange + requested timeRange
  → requested.startTick <= old.startTick
  → requested.endTick >= old.endTick
old timeRange + requested wholeProject → time dimension is a superset
```

A3 creates the `ScopeExtensionRequestId` and stores `fromScopeRevision` with the request.

- [ ] **Step 6: Run authorization tests**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit authorization**

```bash
git add apps/workstation/src/core/candidate/candidate-transaction.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts
git commit -m "feat(core): enforce candidate task authorization"
```

---

### Task 7: Add A2-Backed Reads/Writes and `TASK_BUSY`

**Files:**
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.ts`
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.test.ts`

**Interfaces:**
- Consumes: existing A2 methods `compileCanonical`, `getScopedComposition`, `replaceScopedMusic`, `updateGlobalMeter`; Candidate repository authority reads/writes.
- Produces: Agent-facing scoped read and Candidate mutation operations with no duplicated music-domain implementation.

- [ ] **Step 1: Write the scoped-read tracer test**

Arrange repository authority source `S0`, compile it through an A2 fake/real fixture, and assert:

```text
getScopedComposition(envelope)
→ reads Candidate source
→ calls CompositionPipeline.compileCanonical(S0)
→ calls CompositionPipeline.getScopedComposition(compilation, task.scope)
→ returns A2 result unchanged
```

Do not copy Scope Mapping logic into A3.

- [ ] **Step 2: Write the scoped-music write tracer test**

Expected A3 sequence:

```text
begin ordinary mutation lease
→ guard execution envelope/baseline/state
→ read Candidate composition source
→ A2 compileCanonical
→ A2 replaceScopedMusic(compilation, task.scope, replacements)
→ re-check Task/Candidate authorization
→ repository.writeComposition(result.compilation.canonicalAbc)
→ end lease
```

Assert A3 uses `result.compilation.canonicalAbc`; it must not reserialize or manipulate ABC itself.

- [ ] **Step 3: Add `updateGlobalMeter` behavior**

Use the same mutation skeleton and call:

```ts
composition.updateGlobalMeter(compilation, task.scope, {
  numerator,
  denominator,
});
```

If current Scope does not derive `updateGlobalMeter`, fail `OPERATION_NOT_ALLOWED` before A2 mutation.

- [ ] **Step 4: Add the concurrent-mutation test with a deferred A2 fake**

Hold the first A2 call unresolved, then start a second ordinary mutation. The second must reject immediately:

```ts
await expect(secondMutation).rejects.toMatchObject({ code: 'TASK_BUSY' });
```

Do not create a queue or wait list.

- [ ] **Step 5: Implement a single ordinary mutation lease**

The lease stores the active Task ID and a settlement promise. `finally` always clears it. Reads do not take the ordinary mutation lease.

- [ ] **Step 6: Add Cancel/Reject race tests**

Case A: Cancel while A2 computation is still running.

```text
cancelTask invoked
→ Active Task removed immediately
→ current mutation later reaches commit re-check and does not write
→ cancel reset completes
```

Case B: Cancel/Reject after mutation has already entered the short repository-write phase.

```text
Cancel/Reject invalidates authorization
→ awaits current mutation settlement instead of returning TASK_BUSY
→ applies reset/cleanup afterward
→ final Candidate state reflects Cancel/Reject
```

This prevents an already-started filesystem rename from resurrecting a cancelled result.

- [ ] **Step 7: Map A2 validation failures to stable A3 errors**

Catch `CompositionValidationError` and return `CandidateError('VALIDATION_FAILED', ...)` with the A2 `ValidationReport` as structured details. Do not include parser exception stacks/messages in the cross-process payload.

- [ ] **Step 8: Run transaction and A2 regression tests**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts \
  apps/workstation/src/core/composition/composition-service.test.ts \
  apps/workstation/src/core/composition/scoped-replacement.test.ts \
  apps/workstation/src/core/composition/global-meter.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit A2-backed Candidate mutations**

```bash
git add apps/workstation/src/core/candidate/candidate-transaction.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts
git commit -m "feat(core): apply candidate music mutations"
```

---

### Task 8: Implement Full `finishTask` and Unique Checkpoints

**Files:**
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.ts`
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.test.ts`
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.integration.test.ts` (create in this task)

**Interfaces:**
- Consumes: envelope/baseline guard, Candidate change inspection, A2 final validation, Candidate repository checkpoint.
- Produces: `finishTask` transition `editing → validating → ready` or `editing → validating → editing` on validation failure.

- [ ] **Step 1: Write the failing successful-finish test**

Assert exact sequence/observable behavior:

```text
active Task editing
→ finishTask(envelope)
→ Task validating
→ Candidate authority/change-set checks
→ A2 compileCanonical
→ A2 validateFinalMeterConsistency
→ repository.createCheckpoint(...)
→ Active Task removed
→ Candidate ready
→ latestCheckpoint = returned SHA
```

The public result includes Candidate/validation product data but not the checkpoint SHA.

- [ ] **Step 2: Implement the minimum successful path**

A valid finish requires:

```text
full execution envelope match
no pending Scope Extension
Current clean
main HEAD == Candidate.baseRevision
repository.inspectChanges reports projectJsonChangedFromBase=false
repository.inspectChanges reports no unexpected Candidate paths
A2 canonical compilation valid
A2 final meter consistency report valid
```

Use one Candidate repository checkpoint call that stages only `composition.abc` and allows an empty commit.

- [ ] **Step 3: Write failure-retention tests**

For A2 final validation failure:

```text
no checkpoint created
Candidate source unchanged
Active Task remains
Task state returns to editing
Candidate remains active
```

For `project.json` change or unexpected path:

```text
UNEXPECTED_CANDIDATE_CHANGE
no checkpoint
Task remains editing so the invalid filesystem state can be diagnosed/rejected
```

For base-revision drift:

```text
Candidate becomes stale
Active Task is destroyed
only Reject remains legal
```

- [ ] **Step 4: Write the empty-checkpoint integration tracer**

With real ProjectFoundation + real CandidateRepository + real A2:

```text
create project C0
→ start first Task without changing composition
→ finishTask
→ Candidate checkpoint P1 exists and P1 != C0
→ start second Task
→ finishTask without changes
→ checkpoint P2 exists and P2 != P1
```

This proves `1 successful Task = 1 unique checkpoint SHA` without relying on implementation mocks.

- [ ] **Step 5: Run finishTask tests**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts \
  apps/workstation/src/core/candidate/candidate-transaction.integration.test.ts \
  apps/workstation/src/core/composition/meter-consistency.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit finishTask**

```bash
git add apps/workstation/src/core/candidate/candidate-transaction.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts \
  apps/workstation/src/core/candidate/candidate-transaction.integration.test.ts
git commit -m "feat(core): finish candidate tasks with checkpoints"
```

---

### Task 9: Implement Accept Linearization and Post-Commit Cleanup

**Files:**
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.ts`
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.test.ts`
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.integration.test.ts`

**Interfaces:**
- Consumes: A1 `runSerializedWrite`, A1 clean Current reader, Candidate repository `commitCompositionToCurrent`, cleanup manager.
- Produces: `acceptCandidate` with a single explicit business linearization point and retry-safe cleanup semantics.

- [ ] **Step 1: Write the Ready-only Accept test**

Assert Active Candidate or Candidate with Active Task returns `CANDIDATE_NOT_READY`. A `stale` Candidate returns `CANDIDATE_STALE` and cannot be accepted.

- [ ] **Step 2: Write the successful Accept tracer**

Arrange a Ready Candidate P1 based on C0. Assert:

```text
final Candidate validation passes
→ ProjectAuthorityAccess.runSerializedWrite entered
→ clean Current/baseRevision rechecked inside serialized write
→ repository.commitCompositionToCurrent called
→ returns C1
→ Candidate business object removed immediately
→ cleanup marker authorized
→ best-effort cleanup called
→ result.currentRevision = C1
```

A new `startTask` after this result is allowed even if old cleanup remains pending.

- [ ] **Step 3: Implement the Accept success path**

Set Candidate state `accepting` before the serialized Current write. If anything fails before the repository returns a new `main` revision, restore state to `ready` and keep Candidate/Task-free Ready state available for retry.

After the repository returns C1, never recreate the old Candidate business object.

Accept/Reject arbitration is linearization-based: while Candidate is `accepting`, Reject may still invalidate authorization and abort the Current write until the repository has successfully advanced `main`. If `main` advances first, Accept wins and the old Candidate is already gone; if Reject wins first, Accept fails and Current stays at the old revision.

- [ ] **Step 4: Write the pre-commit failure behavior test**

Use a repository fake that rejects `commitCompositionToCurrent`. Assert:

```text
accept rejects with stable A3 error
Candidate remains ready
Current revision unchanged
cleanup is not authorized
```

The real Git rollback is already covered by Task 3's pre-commit-hook integration test.

- [ ] **Step 5: Write the post-commit cleanup failure behavior test**

Make `commitCompositionToCurrent` return C1, marker authorization succeed, and physical cleanup fail. Assert:

```text
accept resolves successfully with C1
Candidate no longer exists in A3 business state
marker remains pending
new Task can create a new Candidate
old resource is not considered the Active Candidate
```

- [ ] **Step 6: Add the empty-Accept integration tracer**

Use the real stack:

```text
C0
→ first Task finish with empty checkpoint P1
→ Accept
→ main revision becomes C1
→ tree(C1) == tree(C0)
→ C1 != C0
```

This pins `1 successful Accept = 1 unique Current Revision` even with no content diff.

- [ ] **Step 7: Run Accept/Git tests**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts \
  apps/workstation/src/core/candidate/candidate-transaction.integration.test.ts \
  apps/workstation/src/core/candidate/candidate-repository.integration.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Accept**

```bash
git add apps/workstation/src/core/candidate/candidate-transaction.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts \
  apps/workstation/src/core/candidate/candidate-transaction.integration.test.ts
git commit -m "feat(core): accept candidate into current"
```

---

### Task 10: Add Renderer/Core Command/Event Adapter and Project-Open Reconciliation

**Files:**
- Create: `apps/workstation/src/core/candidate/candidate-ipc-handler.ts`
- Create: `apps/workstation/src/core/candidate/candidate-ipc-handler.test.ts`
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.ts`
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.test.ts`
- Modify: `apps/workstation/src/core/candidate/index.ts`

**Interfaces:**
- Consumes: `CandidateCommand`, `CandidateEvent`, A3 `CandidateControlPort`, cleanup reconciliation.
- Produces: stable Renderer/Core product events and a Core-internal project-open reconciliation hook. A4 still calls `CandidateAgentPort` directly through its later MCP adapter.

- [ ] **Step 1: Write Candidate IPC handler red tests**

Follow the existing `ProjectIpcHandler` style. Test at least:

```text
candidate.startTask → task.changed + candidate.changed
candidate.approveScopeExtension → task.changed
candidate.rejectScopeExtension → task.changed
candidate.accept → candidate.currentCommitted
candidate.reject → candidate.invalidated/candidate.changed-to-none
A3 error → candidate.failed with stable code/details
```

Assert serialized events do **not** contain:

```text
branchName
worktreePath
latestCheckpoint
cleanup path
raw git command/stderr
```

- [ ] **Step 2: Run handler test and confirm red**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-ipc-handler.test.ts
```

Expected: FAIL because the handler is missing.

- [ ] **Step 3: Implement CandidateIpcHandler**

Use monotonically increasing event `sequence` and preserve the incoming command `requestId`, matching the Project IPC pattern. Map only stable A3 product states/errors.

- [ ] **Step 4: Write project-open reconciliation tests through `CandidateControlPort`**

Call `reconcileProjectResources()` with:

```text
authorized stale resource A → cleanup attempted
authorized resource B cleanup fails → pending report
resource C no marker → orphan report only
```

Assert this method does not create a Candidate or Task and does not read/modify Candidate content as a recovered business object.

- [ ] **Step 5: Implement reconciliation event/report mapping**

`CandidateRecoveryReport` contains IDs/status only. Orphans produce `ORPHAN_CANDIDATE_RESOURCE` diagnostics but do not make Current invalid when A1 Current itself is clean.

- [ ] **Step 6: Export only supported A3 entry points**

`apps/workstation/src/core/candidate/index.ts` should export the transaction interfaces/class, handler, and stable A3 error type. Do not export `CandidateRepository` paths/workspace records or cleanup marker implementation as product interfaces.

- [ ] **Step 7: Run A3 suite**

```bash
pnpm exec vitest run --config vitest.config.ts \
  apps/workstation/src/core/candidate/candidate-ipc-handler.test.ts \
  apps/workstation/src/core/candidate/candidate-transaction.test.ts \
  apps/workstation/src/core/candidate/candidate-transaction.integration.test.ts \
  apps/workstation/src/core/candidate/candidate-repository.integration.test.ts \
  apps/workstation/src/core/candidate/candidate-cleanup.integration.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit A3 product contracts/adapter completion**

```bash
git add apps/workstation/src/core/candidate
git commit -m "feat(core): expose candidate transaction events"
```

---

### Task 11: Full Regression and A3 Acceptance Gate

**Files:**
- Modify only if a failing regression demonstrates a real integration defect. Do not refactor unrelated A1/A2 code in this task.

**Interfaces:**
- Consumes: completed A1/A2/A3 implementation.
- Produces: evidence that A3 satisfies the frozen PRD/Architecture behavior and does not regress A1/A2.

- [ ] **Step 1: Verify toolchain version**

```bash
node --version
pnpm --version
```

Expected:

```text
Node 24.x (target baseline 24.18.1)
pnpm 9.x (lock/tooling baseline 9.15.9)
```

If the environment is not Node 24, switch the environment before running the remaining gates; do not weaken `engines`.

- [ ] **Step 2: Run all Candidate tests**

```bash
pnpm exec vitest run --config vitest.config.ts apps/workstation/src/core/candidate
```

Expected: PASS.

- [ ] **Step 3: Run all A1/A2/A3 Core tests**

```bash
pnpm exec vitest run --config vitest.config.ts apps/workstation/src/core
```

Expected: PASS.

- [ ] **Step 4: Run shared contract tests**

```bash
pnpm exec vitest run --config vitest.config.ts packages/contracts/src
```

Expected: PASS.

- [ ] **Step 5: Run full repository verification**

```bash
pnpm check
```

Expected: formatting, lint, typecheck, and all tests PASS.

- [ ] **Step 6: Run Git/document cleanliness checks**

```bash
git diff --check
git status --short
```

Expected: no whitespace errors. Status contains only the intended A3 code/tests/docs until those changes are committed.

- [ ] **Step 7: Verify the frozen A3 acceptance matrix manually from test names/results**

Every row must have a passing automated test:

| Behavior | Required evidence |
|---|---|
| First Task creates Candidate from clean C0 | CandidateTransaction unit + real Git integration |
| Ready Candidate reuses same worktree | CandidateTransaction unit |
| Every successful Task gets unique checkpoint | real Git integration, including empty checkpoint |
| Later Task Cancel returns to previous checkpoint | CandidateTransaction unit/integration |
| First Task Cancel removes empty Candidate business state | CandidateTransaction unit |
| Reject during Active Task is a strong termination | CandidateTransaction unit |
| Scope can expand but not move/shrink | CandidateTransaction authorization tests |
| Pending Scope Extension blocks writes/finish | CandidateTransaction authorization tests |
| Stale scope/request results cannot apply | CandidateTransaction authorization tests |
| Current dirty blocks but does not stale Candidate | CandidateTransaction baseline tests |
| `main` base drift stales Candidate and leaves only Reject | CandidateTransaction baseline tests |
| Ordinary concurrent mutation returns `TASK_BUSY` | deferred-mutation unit test |
| Cancel/Reject wins final visible state over in-flight mutation | race unit tests |
| `project.json`/unexpected files block finish | finishTask tests |
| finish validation failure keeps edits for A4 repair | finishTask tests |
| Accept pre-commit failure keeps old Current + Candidate | repository hook integration + transaction unit |
| Accept commit success survives cleanup failure | transaction unit |
| Empty Accept still creates new Current revision | real Git integration |
| Reject cleanup failure is still business success | transaction unit |
| Pending cleanup does not block a new Active Candidate | transaction unit |
| Startup deletes only marker-authorized resources | cleanup integration |
| No-marker resources are orphaned, not deleted/recovered | cleanup integration |
| Renderer contracts contain no Git/worktree/checkpoint internals | IPC contract tests |

- [ ] **Step 8: Commit any verification-only fixes as their own small commits, then stop**

Do not merge `feat/a3` into `dev` and do not push unless explicitly requested.

---

## Implementation Order and Dependency Graph

```text
Task 1 Contracts
      │
      ├──────────────┐
      ▼              ▼
Task 2 A1 seam   Task 3 CandidateRepository
                     │
                     ▼
                Task 4 Cleanup
                     │
      ┌──────────────┘
      ▼
Task 5 Lifecycle
      ▼
Task 6 Envelope + Scope Extension
      ▼
Task 7 A2 Reads/Writes + Busy/Cancel races
      ▼
Task 8 finishTask
      ▼
Task 9 Accept linearization
      ▼
Task 10 IPC + reconciliation
      ▼
Task 11 Full verification
```

Tasks 2–4 can be implemented independently after Task 1, but Task 5 should not begin until A1 path access, Candidate Git, and cleanup-marker interfaces are stable.

## Commit Strategy

The intended atomic commit sequence is:

```text
feat(contracts): add candidate transaction contracts
feat(core): expose active project path internally
feat(core): add candidate git repository
feat(core): add candidate cleanup markers
feat(core): add candidate task lifecycle
feat(core): enforce candidate task authorization
feat(core): apply candidate music mutations
feat(core): finish candidate tasks with checkpoints
feat(core): accept candidate into current
feat(core): expose candidate transaction events
```

Do not combine A1 seam changes, Git adapter work, business state-machine work, and IPC wiring into one commit. Each commit must pass the tests introduced by that slice before moving on.

## Self-Review Against the Frozen Spec

- **Spec coverage:** Candidate base revision, one-worktree-per-Candidate, post-confirmation Task creation, A3/A4 ownership split, complete execution envelope, Scope-only expansion, request ID/revision stale protection, derived operations, dual state machines, active-Task-only runtime state, empty checkpoint, stale Candidate, Candidate-only `composition.abc` changes, full finish validation, `TASK_BUSY`, Cancel/Reject priority, Accept/Reject linearization, PendingCleanup, cleanup marker, orphan behavior, global IDs, stable error contracts, and Renderer Git-detail hiding are each mapped to at least one implementation task and explicit test.
- **No placeholders:** The plan contains no deferred P0 behavior. P1/P2 work is excluded rather than left as TODO.
- **Type consistency:** `baseRevision` is Candidate-level everywhere; `taskBaseCheckpoint` stays internal to Active Task; request calls use `expectedScopeRevision`; `TaskContextView` returns current `scopeRevision`; A4 owns repair state; Candidate checkpoint SHA never enters the Renderer product contract.
- **Boundary consistency:** A1 owns project session/Current serialization; A2 owns composition transformations/validation; A3 owns Candidate/Task business transaction; A4 owns Agent planning/repair/MCP transport. No module duplicates another module's domain logic.
