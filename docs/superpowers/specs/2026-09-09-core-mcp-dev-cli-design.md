# Core MCP Dev CLI Design

## Goal

Provide a development-only CLI that opens an existing Agent Music project, starts the real Music Core MCP Server as a standalone process, and prints the connection information needed for Claude Code or any standards-compliant HTTP MCP client.

## Scope

The CLI is a local interoperability harness. It does not change the product protocol, add Agent-facing tools, or move authorization decisions into MCP.

The seven P0 MCP tools remain exactly:

1. `getTaskContext`
2. `getScopedComposition`
3. `submitGenerationPlan`
4. `requestScopeExtension`
5. `replaceScopedMusic`
6. `updateGlobalMeter`
7. `finishTask`

## Invocation

```bash
pnpm core:mcp --project /absolute/or/relative/project/path
```

Optional:

```bash
--runtime-dir <path>
```

Default runtime directory is user-level and outside the project repository:

```text
~/.agent-music/runtime
```

The command opens an existing valid project only. It does not create projects. The Project must open in `ready` state; `recoveryRequired` fails before MCP startup.

## Composition

The CLI composes only existing production modules:

```text
ProjectFoundation.openProject
→ CandidateGitRepository
→ CandidateCleanupManager
→ CompositionPipeline
→ CandidateTransaction
→ MusicCoreToolHost
→ MusicCoreMcpHttpServer
```

The MCP server continues to bind to `127.0.0.1` on an ephemeral port and publishes the existing runtime descriptor with a random Instance Token.

## Terminal Decisions

### Generation Plan

`submitGenerationPlan` remains a long-held MCP Tool Call. The CLI implements `GenerationPlanConfirmationPort` with a terminal prompt:

```text
Generation plan
Summary: ...
Scope: ...
Approve? [y/N]
```

`y`/`yes` approves. Any other answer rejects. An aborted MCP call returns the existing cancelled behavior.

### Scope Extension

`requestScopeExtension` must still first create the real A3 pending request. The CLI wraps only the Agent-facing A3 port for this tool:

```text
MCP requestScopeExtension
→ CandidateTransaction.requestScopeExtension
→ pending request exists
→ terminal asks approve/reject
→ CandidateControlPort.approveScopeExtension / rejectScopeExtension
→ original pending Tool Result returns
```

This is intentionally dev-harness behavior. It does not add `approveScopeExtension` or `rejectScopeExtension` to MCP. The MCP client should call `getTaskContext` after the Tool Result to observe the authoritative current Scope and `scopeRevision`.

## Output

After startup, print:

```text
Music Core MCP ready
Project: <project path>
Project ID: <projectId>
Endpoint: <http://127.0.0.1:port/mcp>
Instance Token: <token>

Claude Code:
claude mcp add --transport http agent-music <endpoint> --header "Authorization: Bearer <token>"
```

The token is intentionally printed because this is an explicit local dev harness whose purpose is connecting another local client. It is never persisted into the project.

## Lifecycle

- `SIGINT` and `SIGTERM` perform one idempotent cleanup.
- Cleanup stops the MCP HTTP server first, then closes the opened Project.
- Startup failure after Project open closes the Project before exiting.
- Terminal input is closed during cleanup.
- The CLI exits non-zero on invalid arguments, invalid project/open failure, or MCP startup failure.

## Runtime

The repository is `noEmit` TypeScript and uses `.js` import specifiers, so the CLI is executed with `tsx`. `tsx` is a workspace development dependency used only by the dev CLI; it is not part of the product runtime contract.

## Testing

Keep process plumbing thin and test the behavior-bearing pieces separately:

1. argument parsing/default runtime path;
2. terminal plan confirmation decision mapping;
3. Scope Extension wrapper creates pending first and routes approval/rejection through the existing control seam;
4. composition/lifecycle integration starts the real HTTP MCP server over a real temporary project and verifies a standards-compliant client can list exactly seven tools;
5. cleanup closes server/project resources.

The existing A-layer manual regression procedure remains the broader behavioral acceptance for all seven tools and real project facts.
