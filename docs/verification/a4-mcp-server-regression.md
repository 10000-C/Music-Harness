# A4 MCP Server Regression Procedure

**Purpose:** persistent Agent-executed acceptance procedure for the A-layer boundary: Music Core MCP Server + MCP Tool Host + real Core/Candidate/project facts.

**Scope:** A only. This procedure must not use Strands, `AgentWorkflow`, or any model provider. Any standards-compliant MCP client should be able to execute it.

**Primary question:** can an arbitrary MCP client call the eight P0 Music Core tools, receive the documented behavior, and observe the corresponding authoritative Candidate/project/Git facts?

## 1. Execution Rules

This is an Agent-executed regression procedure, not a required permanent automated E2E test.

The executing Agent may create a temporary project, start the real Music Core MCP server, connect with the official MCP SDK test client or another standards-compliant MCP client, invoke tools, and inspect files/Git state directly.

The following rules are mandatory:

1. **All eight Agent-facing capability calls must cross MCP.** Do not call `MusicCoreToolHost`, `CandidateTransaction`, `CompositionPipeline`, or repository mutation methods directly as a substitute for the MCP call under test.
2. **Direct filesystem/Git access is inspection-only.** It may read `composition.abc`, inspect Candidate worktree state, and query Git revisions/status. It must not mutate project authority or Candidate content.
3. **Strands is forbidden in A-layer verification.** A-layer success must not depend on Strands MCP behavior.
4. **Non-MCP user/control decisions may use their real Core control seam.** In particular:
   - generation-plan confirmation is not an Agent MCP tool; the harness may resolve the real confirmation port after first proving the Tool Call is still pending;
   - Scope Extension approval/rejection is not one of the eight Agent MCP tools; the harness may use the real Core/A3 control seam to approve/reject the pending request.
5. Use a temporary project/repository. Never run destructive acceptance steps against a user project.
6. Record both **Tool Result** and **authoritative fact**. A Tool returning success is not sufficient evidence when a filesystem/Git fact is expected to change.
7. Stable A3 domain failures exposed over MCP must retain `code`, sanitized `message`, and only approved structured `details`. Git stderr, paths, parser internals, credentials, and implementation exceptions must not leak.

## 2. Required Environment

Before starting, record:

```text
commit: <git rev-parse HEAD>
branch: <git branch --show-current>
node: <node --version>
pnpm: <pnpm --version>
platform: <os/platform>
```

Required production components:

- `ProjectFoundation`
- `CandidateTransaction`
- `CompositionPipeline`
- `CandidateGitRepository`
- `CandidateCleanupManager`
- `MusicCoreToolHost`
- `MusicCoreMcpHttpServer`
- a standards-compliant MCP client using Streamable HTTP

Use the real `127.0.0.1:<ephemeral>/mcp` endpoint and runtime Instance Token.

## 3. Initial Fixture

Create a fresh project with the real `ProjectFoundation`.

Capture these baseline facts before any MCP mutation:

```text
projectId
initialMainRevision = git rev-parse main
initialCurrentAbc = project/composition.abc contents
initialCurrentStatus = git status --porcelain
```

Expected:

```text
initialCurrentStatus == ""
```

Start the real MCP server for that Project and connect with the Instance Token.

For the main scenario, begin with this narrow initial Scope:

```json
{
  "type": "wholeProject",
  "trackIds": ["track.drums"]
}
```

This narrow Scope is deliberate: it allows the regression to prove authorization, Scope Extension, stale revision behavior, and later whole-project meter mutation.

## 4. Acceptance Sequence

Run the sequence in order. A later step may depend on facts created by an earlier step.

### A-01 — Discover exactly eight P0 tools

Invoke MCP `tools/list`.

Expected names, in the server's declared order:

```text
getTaskContext
getScopedComposition
submitGenerationPlan
requestScopeExtension
replaceScopedMusic
updateMusicalProperties
resizeComposition
finishTask
```

Pass conditions:

- exactly eight Agent-facing Music Core tools are exposed;
- no cancel/reconciliation/internal Core control tool appears;
- no Strands-specific tool is required for Music Core capability discovery.

### A-02 — `submitGenerationPlan` is long-held before confirmation

Agent-facing input must not require `projectId`; the MCP Host binds the currently opened Project. A timeout/cancelled client request must abort the corresponding server Tool Call rather than leaving an orphaned confirmation.

Call:

```json
{
  "name": "submitGenerationPlan",
  "arguments": {
    "summary": "Generate a one-bar drum phrase.",
    "scope": {
      "type": "wholeProject",
      "trackIds": ["track.drums"]
    }
  }
}
```

Before resolving confirmation, verify:

- Tool Call is still pending;
- no Candidate worktree has been created;
- `main` is still `initialMainRevision`;
- Current `composition.abc` is still `initialCurrentAbc`.

Then approve through the real confirmation/control seam.

Expected Tool Result:

- `approved === true`;
- returns Task bootstrap containing `taskId`, `candidateId`, `projectId`, `baseRevision`, Scope and `scopeRevision`;
- `baseRevision === initialMainRevision`;
- initial `scopeRevision === 0`.

Authoritative fact checks:

- Candidate worktree now exists for the returned `candidateId`;
- `main` and Current remain unchanged.

### A-03 — `getTaskContext` returns A3 authority

Call:

```json
{
  "name": "getTaskContext",
  "arguments": {
    "taskId": "<taskId>"
  }
}
```

Expected result must match the Task created in A-02:

```text
projectId == expected project
candidateId == expected Candidate
baseRevision == initialMainRevision
scope == wholeProject(track.drums)
scopeRevision == 0
state == editing
candidateState == active
allowedOperations contains replaceScopedMusic
allowedOperations does not contain updateMusicalProperties
```

Use this result, not Renderer/UI copies, as the authoritative source for subsequent execution envelopes.

### A-04 — `getScopedComposition` respects Scope

Call with the current flat execution envelope:

```json
{
  "name": "getScopedComposition",
  "arguments": {
    "taskId": "<taskId>",
    "projectId": "<projectId>",
    "candidateId": "<candidateId>",
    "baseRevision": "<baseRevision>",
    "expectedScopeRevision": 0
  }
}
```

Expected:

- call succeeds;
- returned scoped composition contains only the authorized drum track view for this Scope;
- no project file/Git fact changes.

### A-05 — Unauthorized `updateMusicalProperties` fails with a stable A3 error

Using the same revision-0 envelope, call:

```json
{
  "name": "updateMusicalProperties",
  "arguments": {
    "envelope": {
      "taskId": "<taskId>",
      "projectId": "<projectId>",
      "candidateId": "<candidateId>",
      "baseRevision": "<baseRevision>",
      "expectedScopeRevision": 0
    },
    "meter": { "numerator": 3, "denominator": 4 },
    "tempo": { "bpm": 100 }
  }
}
```

Expected MCP Tool Result:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "{\"code\":\"OPERATION_NOT_ALLOWED\",...}"
    }
  ]
}
```

Pass conditions:

- stable code is `OPERATION_NOT_ALLOWED`;
- no internal path/stderr/parser detail is present;
- Candidate `composition.abc` is unchanged by this rejected call;
- Current/main remain unchanged.

**Regression history:** this step previously exposed a real defect where MCP preserved only the human-readable message and dropped the stable A3 `code`. Commit `37656b0` fixed that boundary. This check must remain part of future A-layer runs.

### A-06 — `replaceScopedMusic` mutates Candidate, not Current

Call:

```json
{
  "name": "replaceScopedMusic",
  "arguments": {
    "envelope": {
      "taskId": "<taskId>",
      "projectId": "<projectId>",
      "candidateId": "<candidateId>",
      "baseRevision": "<baseRevision>",
      "expectedScopeRevision": 0
    },
    "replacements": [
      {
        "trackId": "track.drums",
        "abc": "C4"
      }
    ]
  }
}
```

Authoritative fact checks:

```text
Candidate composition.abc contains: [V:track.drums] C4 |
Current composition.abc == initialCurrentAbc
git rev-parse main == initialMainRevision
```

A successful Tool Result without the Candidate file change is a failure.

### A-07 — `requestScopeExtension` creates a pending write barrier

Call:

```json
{
  "name": "requestScopeExtension",
  "arguments": {
    "envelope": {
      "taskId": "<taskId>",
      "projectId": "<projectId>",
      "candidateId": "<candidateId>",
      "baseRevision": "<baseRevision>",
      "expectedScopeRevision": 0
    },
    "requestedScope": {
      "type": "wholeProject",
      "trackIds": [
        "track.drums",
        "track.bass",
        "track.guitar",
        "track.keys",
        "track.strings",
        "track.winds"
      ]
    }
  }
}
```

Expected:

- result includes a pending Scope Extension request ID;
- `fromScopeRevision === 0`.

While the request is pending, attempt another ordinary Candidate mutation through MCP using revision 0.

Expected:

- mutation is rejected with stable `TASK_SCOPE_EXTENSION_PENDING`;
- Candidate file remains at the A-06 state.

### A-08 — Approving extension increments authorization revision and invalidates stale envelopes

Approve the pending request through the real Core/A3 control seam.

Expected authoritative context:

```text
scope == wholeProject(all six tracks)
scopeRevision == 1
allowedOperations contains replaceScopedMusic
allowedOperations contains updateMusicalProperties
```

Then call any Task-bound MCP read using the old revision-0 envelope.

Expected:

- MCP Tool Result is an error;
- stable code is `STALE_SCOPE_REVISION`;
- no project/Candidate fact changes.

All following calls use `expectedScopeRevision: 1`.

### A-09 — `updateMusicalProperties` mutates Candidate initial Meter/Tempo

Call:

```json
{
  "name": "updateMusicalProperties",
  "arguments": {
    "envelope": {
      "taskId": "<taskId>",
      "projectId": "<projectId>",
      "candidateId": "<candidateId>",
      "baseRevision": "<baseRevision>",
      "expectedScopeRevision": 1
    },
    "meter": { "numerator": 3, "denominator": 4 },
    "tempo": { "bpm": 100 }
  }
}
```

Authoritative fact checks:

```text
Candidate composition.abc contains M:3/4 and Q:1/4=100
Current composition.abc == initialCurrentAbc
git rev-parse main == initialMainRevision
```

At this point the musical bodies still need to become meter-consistent before `finishTask` can succeed.

### A-10 — Whole-project `replaceScopedMusic` makes all six tracks meter-consistent

Call revision-1 `replaceScopedMusic` with all six tracks, for example:

```text
track.drums   -> C3
track.bass    -> z3
track.guitar  -> z3
track.keys    -> z3
track.strings -> z3
track.winds   -> z3
```

Authoritative fact checks:

- Candidate header still contains `M:3/4`;
- Candidate drum body contains `[V:track.drums] C3 |`;
- the other five Candidate voice bodies contain their corresponding `z3 |`;
- Current/main remain unchanged.

### A-11 — `finishTask` validates and checkpoints the Candidate

Call with the flat revision-1 execution envelope:

```json
{
  "name": "finishTask",
  "arguments": {
    "taskId": "<taskId>",
    "projectId": "<projectId>",
    "candidateId": "<candidateId>",
    "baseRevision": "<baseRevision>",
    "expectedScopeRevision": 1
  }
}
```

Expected Tool Result:

```text
validation.valid == true
candidate.state == ready
```

Capture:

```text
candidateHead = git -C <candidate-worktree> rev-parse HEAD
```

Pass conditions:

```text
candidateHead != initialMainRevision
git -C <project> rev-parse main == initialMainRevision
Current composition.abc == initialCurrentAbc
```

Then call `getTaskContext({taskId})` again.

Expected:

- stable `TASK_NOT_ACTIVE` error;
- finished Task authority is gone.

## 5. Negative Protocol/Security Checks

These checks may be run before or after the main sequence with isolated fixtures.

### A-N01 — Missing/wrong bearer token

Expected:

- request is rejected before Tool Host execution;
- no Candidate/project fact changes.

### A-N02 — Malformed Tool arguments

Pass malformed input that fails the MCP Tool schema.

Expected:

- schema/protocol error remains a schema/protocol error;
- it is **not** mislabeled as `CANDIDATE_TRANSACTION_FAILED`;
- Tool Host mutation method is not entered.

### A-N03 — Unexpected Core implementation failure is sanitized

Inject or provoke a non-domain failure at the Tool Host boundary.

Expected MCP domain fallback:

```json
{
  "code": "CANDIDATE_TRANSACTION_FAILED",
  "message": "Candidate transaction failed"
}
```

Expected absence:

```text
absolute filesystem paths
Git stderr
provider credentials/tokens
raw parser exceptions
internal stack details
```

### A-N04 — MCP server lifecycle fault cleanup

Use descriptor-store fault injection already supported by the server tests.

Verify:

- descriptor publication failure closes the HTTP server;
- descriptor removal failure still closes the HTTP server;
- failed lifecycle does not leave an object that falsely appears cleanly started/stopped.

## 6. Result Record Template

After every Agent-executed A-layer regression, record a short result in the review/task notes using this template. Do not commit generated temporary project data.

```md
### A-layer MCP regression — YYYY-MM-DD

- Commit: `<sha>`
- Branch: `<branch>`
- Node: `<version>`
- MCP client: `<official SDK / other standards-compliant client>`
- Result: PASS / FAIL

| Case | Result | Evidence |
| --- | --- | --- |
| A-01 tools/list | PASS/FAIL | exact eight names |
| A-02 plan pending/approve | PASS/FAIL | no Candidate before approval; Task after approval |
| A-03 getTaskContext | PASS/FAIL | authority matches A3 |
| A-04 scoped read | PASS/FAIL | only authorized Scope |
| A-05 unauthorized meter | PASS/FAIL | OPERATION_NOT_ALLOWED retained over MCP |
| A-06 scoped write | PASS/FAIL | Candidate changed; Current/main unchanged |
| A-07 extension pending | PASS/FAIL | pending barrier enforced |
| A-08 revision invalidation | PASS/FAIL | old envelope => STALE_SCOPE_REVISION |
| A-09 meter update | PASS/FAIL | Candidate M:3/4 |
| A-10 all-track rebar | PASS/FAIL | six voices meter-consistent |
| A-11 finish/checkpoint | PASS/FAIL | Candidate Ready + new checkpoint; Task gone; main unchanged |
| A-N01 auth | PASS/FAIL | unauthorized client rejected |
| A-N02 schema | PASS/FAIL | invalid args rejected before domain call |
| A-N03 sanitization | PASS/FAIL | stable fallback, no internal detail |
| A-N04 lifecycle | PASS/FAIL | server resources always closed |

Discovered regressions:
- none / `<description and follow-up commit>`
```

## 7. Relationship to B/C/D Verification

A PASS proves only the MCP Server/Core capability boundary.

It does **not** prove:

- Strands converts model tool calls into real MCP execution — B layer;
- A4 Workflow correctly consumes real Strands events — C layer;
- the full Agent path is reachable through real A4 orchestration into project facts — D layer.

B/C/D have separate integration evidence. Do not substitute one layer for another.

### A-10 — Canonical replacement guidance and validation phase

Inspect `tools/list` and exercise a failing replacement.

Expected:

- `getScopedComposition` states that `tracks[].abc` are canonical voice-body fragments and formatting references for `replaceScopedMusic`;
- `replaceScopedMusic` states that `replacements[].abc` must not contain document headers or `[V:...]` markers and summarizes the supported P0 fragment subset;
- a preflight `ABC_NOT_CANONICAL` is returned as `VALIDATION_FAILED` with `details.phase = "currentComposition"`; a replacement-originated validation error uses `details.phase = "replacement"`;
- validation phase metadata never exposes project paths, source text, or underlying exception details.
