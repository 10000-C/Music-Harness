# A5 Export Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver A5 as a Current-only export-preparation module that returns one revision-bound validated Canonical ABC source for desktop abcjs WAV synthesis and fresh A2 Standard MIDI bytes for MIDI export.

**Architecture:** A5 captures a clean Current snapshot under A1's existing project-level serialization seam, releases the coordinator, then performs A2 final compilation against the immutable source. A2 owns the single definition of final publishability via `compileFinalCanonical`; A3 `finishTask` and Accept reuse that seam. A5 has no Candidate, openDAW, abcjs, target-path, or file-writing responsibility.

**Tech Stack:** TypeScript, Vitest, A1 ProjectAuthorityAccess, A2 CompositionPipeline, existing Standard MIDI compiler, pnpm/Node 24.

## Global Constraints

- Formal export source is clean Current `main` HEAD only; Candidate is not exportable.
- P0 user-facing formats are MIDI and WAV; Canonical ABC is internal authority/input, not a user `.abc` export format.
- MIDI uses existing A2 `StandardMidiDocument.fileBytes`; do not add abcjs as a second MIDI compiler.
- WAV synthesis happens later in the desktop layer with abcjs from A5-provided validated Canonical ABC.
- A5 must not depend on A4, Candidate state, openDAW, RuntimeSnapshot, Web Audio, target paths, or export-file writes.
- Snapshot acquisition shares A1 project serialization with Accept; A2 compilation runs after the immutable snapshot is captured.
- Do not add `music-style-skills/` to any A5 commit.

---

### Task 1: Align product, architecture, and dev plan

**Files:**
- Modify: `docs/product/Agent Music Workstation PRD.md`
- Modify: `docs/architecture/Agent Music Workstation System Architecture.md`
- Modify: `docs/devplan.md`
- Keep: `docs/superpowers/specs/2026-09-12-a5-export-preparation-design.md`

**Interfaces:**
- Consumes: confirmed export topology from the A5 design spec.
- Produces: one consistent source of truth: A5 = Current export preparation; B5 = desktop MIDI file output + abcjs WAV synthesis/Windows delivery.

- [ ] **Step 1: Replace active P0 export wording**

Make current docs state:

```text
Current Canonical ABC
→ A5 final validation
→ { canonicalAbc, midiFileBytes, currentRevision }
→ B5
   ├─ midiFileBytes → .mid
   └─ canonicalAbc → abcjs synth → .wav
```

- [ ] **Step 2: Remove current openDAW-export requirements**

Remove openDAW Offline Render, `OpenDawRuntimeAdapter` WAV rendering, B3 dependency for B5 export, and ABC-as-user-export wording from active requirements. Keep historical spike records explicitly marked historical.

- [ ] **Step 3: Verify docs are internally consistent**

Run:

```bash
grep -RIn "ABC、MIDI、WAV\|Offline Render\|OpenDawRuntimeAdapter.*WAV\|B3.*B5\|Candidate 不可导出" docs/devplan.md docs/product docs/architecture
```

Expected: no active requirement contradicts the selected topology.

- [ ] **Step 4: Commit**

```bash
git add docs/devplan.md docs/product/'Agent Music Workstation PRD.md' docs/architecture/'Agent Music Workstation System Architecture.md' docs/superpowers/specs/2026-09-12-a5-export-preparation-design.md docs/superpowers/plans/2026-09-12-a5-export-preparation.md
git commit -m "docs: define a5 export preparation"
```

### Task 2: Centralize final A2 compilation and migrate A3

**Files:**
- Modify: `apps/workstation/src/core/composition/composition-service.ts`
- Modify: `apps/workstation/src/core/composition/composition-service.test.ts`
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.ts`
- Modify: `apps/workstation/src/core/candidate/candidate-transaction.test.ts`

**Interfaces:**
- Consumes: `CompositionPipeline.compileCanonical(source)` and `validateFinalMeterConsistency(source)`.
- Produces: `CompositionPipeline.compileFinalCanonical(source): CompositionCompilation`.

- [ ] **Step 1: Write the failing A2 final-seam test**

Add a test proving ordinary `compileCanonical` accepts canonical 3/4 source with stale 4/4 barlines while `compileFinalCanonical` rejects it with `METER_BARLINE_MISMATCH`, and valid final source returns a compilation.

- [ ] **Step 2: Run the focused test and observe RED**

```bash
pnpm vitest run --config vitest.config.ts apps/workstation/src/core/composition/composition-service.test.ts
```

Expected: FAIL because `compileFinalCanonical` does not exist.

- [ ] **Step 3: Implement the minimum final seam**

Implement:

```ts
public compileFinalCanonical(source: string): CompositionCompilation {
  const compilation = this.compileCanonical(source);
  const validation = this.validateFinalMeterConsistency(source);
  if (!validation.valid) {
    const issue = validation.issues[0];
    if (issue !== undefined) {
      throw new CompositionValidationError(issue);
    }
  }
  return compilation;
}
```

- [ ] **Step 4: Run A2 focused tests and observe GREEN**

Run the composition service and meter-consistency tests.

- [ ] **Step 5: Write failing A3 seam-usage tests**

Update the existing final-validation failure test to spy/mock `compileFinalCanonical`, and add/adjust Accept validation coverage so A3 no longer directly calls `validateFinalMeterConsistency` at final publication points.

- [ ] **Step 6: Run Candidate tests and observe RED**

Expected: assertions fail while A3 still uses the old two-call checklist.

- [ ] **Step 7: Migrate A3 final validation to the new seam**

`finishTask` must catch `CompositionValidationError` from `compileFinalCanonical` and return its report while restoring Task state to `editing`. Accept must let the same error normalize to `VALIDATION_FAILED`.

- [ ] **Step 8: Run Candidate + Composition tests and observe GREEN**

- [ ] **Step 9: Commit**

```bash
git add apps/workstation/src/core/composition apps/workstation/src/core/candidate/candidate-transaction.ts apps/workstation/src/core/candidate/candidate-transaction.test.ts
git commit -m "refactor(core): centralize final composition validation"
```

### Task 3: Add the A5 export-preparation module

**Files:**
- Create: `packages/contracts/src/export.ts`
- Create: `packages/contracts/src/export.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/workstation/src/core/export/export-preparation.ts`
- Create: `apps/workstation/src/core/export/export-preparation.test.ts`
- Create: `apps/workstation/src/core/export/export-preparation.integration.test.ts`
- Create: `apps/workstation/src/core/export/export-ipc-handler.ts`
- Create: `apps/workstation/src/core/export/export-ipc-handler.test.ts`
- Create: `apps/workstation/src/core/export/index.ts`

**Interfaces:**
- Consumes: `ProjectAuthorityAccess.readCleanCurrent()`, `ProjectAuthorityAccess.runSerializedWrite()`, `CompositionPipeline.compileFinalCanonical()`.
- Produces:

```ts
// packages/contracts/src/export.ts
export interface PreparedCurrentExport {
  readonly projectId: ProjectId;
  readonly currentRevision: string;
  readonly canonicalAbc: string;
  readonly midiFileBytes: Uint8Array;
}

export class ExportPreparation {
  constructor(project: ProjectAuthorityAccess, composition?: CompositionPipeline);
  prepareCurrentExport(): Promise<PreparedCurrentExport>;
}
```

- [ ] **Step 1: Write the clean-Current failing test**

Test through `prepareCurrentExport()` that A5 returns projectId/revision from one snapshot, the exact validated Canonical ABC, and `compilation.playback.midiDocument.fileBytes` from a fresh compile.

- [ ] **Step 2: Run focused A5 test and observe RED**

Expected: module/class missing.

- [ ] **Step 3: Implement the minimal A5 seam**

Capture the snapshot inside:

```ts
const snapshot = await this.project.runSerializedWrite(() =>
  this.project.readCleanCurrent(),
);
```

Then outside the serialized callback call `compileFinalCanonical(snapshot.compositionSource)` and return copied MIDI bytes with snapshot identity.

- [ ] **Step 4: Run the clean-Current test and observe GREEN**

- [ ] **Step 5: Add authority/freshness tests one slice at a time**

Add tests that prove dirty Current errors pass through, no Candidate input exists, compilation happens on every call, and A5 never writes export files.

- [ ] **Step 6: Add the Accept-race integration test**

Use real `ProjectFoundation` coordination or a controlled `ProjectAuthorityAccess` adapter to pause one serialized Current operation. Prove export snapshot acquisition and Current commit cannot interleave into mixed revision/source data; the result is wholly old or wholly new revision data.

- [ ] **Step 7: Add close/reopen reproducibility coverage**

With a real temp project, prepare export, close/open, prepare again, and assert Canonical ABC and MIDI bytes are equal for unchanged Current.

- [ ] **Step 8: Run A5 tests and observe GREEN**

```bash
pnpm vitest run --config vitest.config.ts apps/workstation/src/core/export
```


- [ ] **Step 9: Add the typed Core/Desktop export seam**

Move `PreparedCurrentExport` to `@agent-music/contracts`, add an exact-shape `export.prepareCurrent` command plus `export.prepared` / `export.failed` events, and expose a minimal `ExportIpcHandler`. The command must not accept projectId, candidateId, arbitrary source, or precompiled data.

- [ ] **Step 10: Add Contract/IPC tests**

Prove exact command allowlisting, monotonic event sequence, stable Project error forwarding, final-validation normalization, and sanitization of unknown failures.

- [ ] **Step 11: Run A5 + contract tests and observe GREEN**

```bash
pnpm vitest run --config vitest.config.ts packages/contracts/src/export.test.ts apps/workstation/src/core/export
```

- [ ] **Step 12: Commit**

```bash
git add packages/contracts/src/export.ts packages/contracts/src/export.test.ts packages/contracts/src/index.ts apps/workstation/src/core/export
git commit -m "feat(core): add current export preparation"
```

### Task 4: Final branch verification for feat/a5 acceptance

**Files:**
- Review all `feat/a5` changes against the design spec and this plan.

**Interfaces:**
- Consumes: Tasks 1-3 outputs.
- Produces: acceptance evidence for `feat/a5`.

- [ ] **Step 1: Run formatting/lint/type verification**

```bash
pnpm format:check
pnpm lint
pnpm typecheck
```

- [ ] **Step 2: Run the full test suite**

```bash
pnpm test
```

- [ ] **Step 3: Check branch hygiene**

```bash
git status --short --branch
git diff dev...HEAD --check
git log --oneline --decorate dev..HEAD
```

Expected: only intentional A5 files/commits; `music-style-skills/` remains untracked and uncommitted.

- [ ] **Step 4: Acceptance checklist**

Verify directly from code/tests:

```text
[ ] A5 reads only clean Current
[ ] A5 snapshot capture is serialized with Current mutation
[ ] A5 fresh-compiles after snapshot capture
[ ] A5 returns revision-bound Canonical ABC + A2 MIDI bytes
[ ] Candidate cannot be supplied to A5
[ ] A5 has no openDAW/abcjs/file-output dependency
[ ] A3 finish/Accept share A2 final compilation seam
[ ] docs define desktop abcjs WAV ownership and MIDI/WAV-only user export
```
