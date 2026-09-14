# A5 Export Preparation Design

**Date:** 2026-09-12
**Status:** Implemented on feat/a5
**Scope:** A5 Export Preparation plus the minimum A1/A2 seams needed by A5

## 1. Goal

A5 prepares deterministic export input exclusively from the clean Current `main` HEAD.

Canonical ABC remains the project authority and A2 compilation input. P0 user-facing export formats are MIDI and WAV. WAV is synthesized in the desktop layer with abcjs; A5 does not synthesize audio.

```text
A1 clean Current main HEAD
→ A5 prepareCurrentExport()
→ A2 fresh final compilation/validation
→ PreparedCurrentExport
   ├─ A2 Standard MIDI bytes → desktop `.mid` file output
   └─ validated Canonical ABC → desktop abcjs synth → `.wav` file output
```

A5 must not read Candidate state, reuse stale derived caches, depend on Agent/A4 state, or depend on openDAW.

## 2. Non-goals

A5 does not own:

- ABC file export as a user-facing format;
- WAV synthesis implementation;
- abcjs synthesized sound or Web Audio inside Music Core;
- openDAW, RuntimeSnapshot, `OpenDawRuntimeAdapter`, or offline rendering;
- Agent settings, Agent sessions, or A4 workflow state;
- Candidate, Task, branch, worktree, or Candidate preview export;
- export path selection or desktop file dialogs;
- final target-file temp-write/fsync/rename behavior.

## 3. Export source authority

All formal exports derive from one `CurrentAuthoritySnapshot` read from clean `main` HEAD. Candidate content is mechanically unreachable from the A5 interface.

A5 never accepts `candidateId`, Candidate path, arbitrary ABC source, or a caller-supplied prebuilt compilation.

## 4. A5 seam

A5 exposes one primary operation. `PreparedCurrentExport` is defined in `@agent-music/contracts` because B5 consumes it across the Core/Desktop typed IPC boundary:

```ts
interface ExportPreparation {
  prepareCurrentExport(): Promise<PreparedCurrentExport>;
}

interface PreparedCurrentExport {
  readonly projectId: ProjectId;
  readonly currentRevision: string;
  readonly canonicalAbc: string;
  readonly midiFileBytes: Uint8Array;
}
```

`currentRevision` binds both derived outputs to one Current revision. `canonicalAbc` is not exposed for `.abc` download; it is the validated internal input required by the desktop abcjs WAV path.

A5 does not expose `PlaybackCompilation` merely for export because the desktop WAV path consumes Canonical ABC directly and MIDI export consumes the existing A2 file bytes.

The cross-process seam is intentionally one command/event pair:

```ts
type ExportCommand = {
  type: 'export.prepareCurrent';
  requestId: string;
};

type ExportEvent =
  | { type: 'export.prepared'; requestId: string; sequence: number; result: PreparedCurrentExport }
  | { type: 'export.failed'; requestId: string; sequence: number; code: ExportErrorCode; message: string };
```

The command has no project/candidate/source argument: Core Active Project is authoritative and Candidate data cannot enter the export path. The handler preserves stable A1 Project errors, maps final A2 validation to `VALIDATION_FAILED`, and hides unexpected implementation details behind `EXPORT_PREPARATION_FAILED`.

## 5. A2 final-compilation seam

Existing `compileCanonical()` is intentionally usable while a Task is still being edited and therefore cannot enforce every final-composition invariant. In particular, after changing Global Meter, a Candidate may temporarily require musical rearrangement before `finishTask`.

Add a distinct final seam conceptually equivalent to:

```ts
compileFinalCanonical(source: string): CompositionCompilation
```

It must:

1. run ordinary Canonical compilation;
2. run final Meter/barline consistency validation;
3. return the fresh `CompositionCompilation` only when both succeed;
4. surface validation failure through the existing `CompositionValidationError` / `ValidationReport` model.

The same final seam is reused by:

- A3 `finishTask`;
- A3 final Accept validation;
- A5 `prepareCurrentExport`.

This keeps the definition of "final composition is publishable" in A2 rather than duplicating validation logic in A3 and A5.

## 6. A1 snapshot serialization

A5 must not obtain a Current snapshot concurrently with the linearization portion of A3 Accept/rollback.

The read of `currentRevision + manifest + compositionSource` therefore participates in the same project-level serialized Current coordination already used by A3 Current mutation. Only snapshot acquisition is serialized; expensive A2 compilation happens after the immutable snapshot has been obtained.

Required invariant:

```text
PreparedCurrentExport.canonicalAbc and `.midiFileBytes` are derived entirely from PreparedCurrentExport.currentRevision.
```

A5 must never return revision N with MIDI generated from revision N+1/N-1.

Implementation may reuse the existing `ProjectAuthorityAccess.runSerializedWrite` coordination internally, but GitAdapter, lock details, and file paths must not enter the A5 interface.

## 7. MIDI and WAV downstream ownership

P0 MIDI export continues to use the existing A2 `StandardMidiDocument.fileBytes`.

A2 already owns the project's exact:

- fixed six-track ordering;
- PPQ=960;
- Tempo Map;
- Global Time Signature;
- supported Key Signature semantics;
- Note start/duration/pitch/velocity rules;
- full composition length and trailing rests.

abcjs `getMidiFile()` is not introduced into the authoritative MIDI path because that would create a second MIDI compiler with potentially different semantics.

For WAV, the desktop layer consumes `PreparedCurrentExport.canonicalAbc` and uses abcjs synthesized sound in a Web Audio-capable Renderer context. This is deliberately outside A5/Music Core. openDAW is not part of the export path.

## 8. Error behavior

`prepareCurrentExport()` fails without producing export data when:

- no Project is open;
- Current worktree is dirty;
- Current authority files cannot be read or parsed;
- Canonical compilation fails;
- final Meter/barline validation fails;
- Project write authority is lost while the stable snapshot is acquired.

Errors reuse stable A1/A2 domain error models. A5 must not expose Git commands, filesystem internals, project paths, parser HTML, or Candidate details.

## 9. Tests

A5 unit/integration tests must prove:

1. clean Current produces one `PreparedCurrentExport` containing matching `projectId`, `currentRevision`, validated Canonical ABC, and fresh A2 MIDI bytes;
2. dirty Current is rejected;
3. Candidate content different from Current cannot affect export preparation;
4. stale MIDI/derived caches are not consumed;
5. final Meter/barline-invalid Current is rejected even if ordinary Canonical compilation succeeds;
6. snapshot acquisition racing with Accept resolves wholly to either the old or new Current revision, never a mixed snapshot;
7. close/reopen of the same Current reproduces equivalent Canonical ABC and MIDI bytes;
8. A5 does not create or modify files under `exports/`;
9. the Export IPC command has an exact allowlisted shape and cannot carry Candidate/source overrides;
10. the Export IPC handler emits monotonic typed success/failure events and does not expose unexpected internal errors.

A2 regression tests must prove the new final seam matches the validation currently enforced by `finishTask` while ordinary `compileCanonical()` still permits the intended temporary in-Task Meter-repair state.

Desktop export tests are outside A5 and cover MIDI file output plus abcjs WAV synthesis, target-path selection, temp-write/fsync/rename behavior, Windows paths, occupied target files, and the concrete WAV duration/tail behavior.

## 10. Documentation migration

Current PRD/Architecture/devplan wording must be updated so that:

- P0 formal export formats are MIDI and WAV;
- Canonical ABC remains the internal authority but is no longer a user `.abc` export format;
- WAV is synthesized in the desktop layer with abcjs from A5-provided validated Canonical ABC;
- A5 is `Export Preparation` over A1 + A2 only;
- A5 output is validated Canonical ABC plus fresh A2 Standard MIDI bytes, all bound to one Current revision;
- A5 no longer depends on B3/openDAW;
- B5 remains responsible for desktop MIDI/WAV file output and Windows delivery, but WAV synthesis uses abcjs rather than openDAW;
- `OpenDawRuntimeAdapter` and openDAW Offline Render are removed from the current export architecture;
- TG-010/openDAW WAV spike remains historical evidence only and no longer represents the active WAV implementation.

Historical spike records should not be rewritten as though the experiments never happened; only their status as active architecture changes.

## 11. Implementation order

1. Update PRD/Architecture/devplan to MIDI + desktop-abcjs WAV export semantics.
2. Add the A2 final-compilation seam and refactor A3 final validation to use it.
3. Add the shared `PreparedCurrentExport` / Export Command/Event contracts and A5 `ExportPreparation` with Current-only stable snapshot acquisition.
4. Add the minimal Core `ExportIpcHandler` for B5 consumption.
5. Add A5 Current/Candidate authority, IPC, and Accept-race tests.
6. Add the A5 implementation plan.
7. Run focused A1/A2/A3/A5 tests, root test suite, and typecheck.
