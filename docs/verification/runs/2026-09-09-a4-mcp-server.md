# A4 MCP Server Regression Run — 2026-09-09

- Procedure: `docs/verification/a4-mcp-server-regression.md`
- Layer: A — MCP Server / Core capability
- Strands used: no
- MCP client: official MCP SDK test client over Streamable HTTP
- Production facts exercised: real ProjectFoundation, CandidateTransaction, CompositionPipeline, CandidateGitRepository, Candidate worktree and Git repository
- Baseline implementation commit for the final passing run: `37656b0` (`fix(core): preserve stable candidate errors over mcp`)
- Result: **PASS**

## Main sequence evidence

| Case | Result | Evidence |
| --- | --- | --- |
| A-01 tools/list | PASS | Exactly the seven P0 Music Core tools were returned. |
| A-02 submitGenerationPlan pending/approve | PASS | No Candidate existed before confirmation; approval created the expected Candidate/Task bootstrap. |
| A-03 getTaskContext | PASS | Returned A3-authoritative project/task/candidate/baseRevision/Scope/scopeRevision. |
| A-04 getScopedComposition | PASS | Narrow drum Scope returned one authorized track view. |
| A-05 unauthorized meter | PASS after fix | Narrow Scope rejected `updateGlobalMeter` with stable `OPERATION_NOT_ALLOWED`. |
| A-06 replaceScopedMusic | PASS | Candidate `composition.abc` changed to drum `C4`; Current file and `main` stayed unchanged. |
| A-07 requestScopeExtension | PASS | Pending request created and ordinary Candidate mutation was blocked while pending. |
| A-08 revision invalidation | PASS | Approval moved Scope revision 0 → 1; old revision-0 envelope was rejected as stale. |
| A-09 updateGlobalMeter | PASS | Candidate file changed to `M:3/4`; Current/main stayed unchanged. |
| A-10 all-track rebar | PASS | Candidate contained drum `C3` and `z3` for the other five tracks under `M:3/4`. |
| A-11 finishTask | PASS | Candidate became Ready, a new Candidate checkpoint was created, Task authority ended, and `main` remained at the original Current revision. |

## Concrete final facts

The run observed this invariant shape:

```text
initial main SHA != final Candidate checkpoint SHA
project main SHA == initial main SHA
Current composition.abc == initial Current composition.abc
Candidate composition.abc contains M:3/4
Candidate drums == C3
finished task getTaskContext => TASK_NOT_ACTIVE
```

Temporary project/worktree data was deleted after the run and is intentionally not committed.

## Regression discovered during the run

The first pass exposed a real MCP contract defect:

```text
A3 CandidateError:
  code = OPERATION_NOT_ALLOWED
  message = Operation is not allowed by the current Task Scope

Old MCP result:
  isError = true
  text = Operation is not allowed by the current Task Scope

Problem:
  stable A3 error code was lost across MCP
```

This contradicted Architecture §13.8, which requires stable A3 domain error codes and sanitized structured details across Renderer/A4/MCP boundaries.

The defect was fixed in:

```text
37656b0 fix(core): preserve stable candidate errors over mcp
```

The passing rerun verified:

```json
{
  "isError": true,
  "content": [
    {
      "type": "text",
      "text": "{\"code\":\"OPERATION_NOT_ALLOWED\",\"message\":\"Operation is not allowed by the current Task Scope\"}"
    }
  ]
}
```

It also verified unexpected implementation failures are normalized to `CANDIDATE_TRANSACTION_FAILED` without leaking internal path/stderr details.

## Next regression rule

Future A-layer runs should start from the reusable procedure rather than recreating this ad hoc scenario. If a broad Agent-executed run discovers another defect:

1. record the failure in the new run note;
2. fix the production boundary;
3. add a focused automated regression test for the specific defect;
4. rerun the full A-layer procedure;
5. record the final PASS/FAIL result.
