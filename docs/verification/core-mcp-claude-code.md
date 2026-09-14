# Claude Code ↔ Music Core MCP Dev Harness

This guide starts the real Music Core MCP Server as a standalone local development process and connects Claude Code to it with the standard Streamable HTTP MCP transport.

This is a development/interoperability harness. The formal desktop product runtime defined by Architecture V1.16 uses one long-lived Core/MCP across Project switches; this CLI intentionally binds one standalone server to one Project for external-client verification. It does not change the product MCP contract. The Music Core still exposes exactly ten P0 Agent-facing tools.

## Prerequisites

- Node.js 24.x
- pnpm 9.x
- dependencies installed from the repository lockfile
- a writable parent directory for a new Project, or an existing valid Agent Music Project whose Current is clean/ready
- Claude Code installed on the same machine as the MCP server

The server binds to `127.0.0.1`, so Claude Code must run on the same host.

## 1. Install dependencies

From the repository root:

```bash
pnpm install --frozen-lockfile
```

## 2. Create a Project if needed

If you do not already have an Agent Music Project:

```bash
pnpm project:create --path ./my-project
```

The command creates the real empty Project structure, initializes Git, writes the initial Current, commits `Initial Current`, releases the Project lock, and prints the Project ID and next `core:mcp` command. The target must be absent or empty according to `ProjectFoundation.createProject()` rules.

If you already have a valid Project, skip this step.

## 3. Start the Music Core MCP Server

```bash
pnpm core:mcp --project /path/to/agent-music-project
```

Relative project paths are resolved from the repository working directory.

The default runtime descriptor directory is:

```text
~/.agent-music/runtime
```

You may override it:

```bash
pnpm core:mcp   --project /path/to/agent-music-project   --runtime-dir /path/to/runtime-directory
```

The runtime directory must be outside the project directory. The CLI rejects an in-project runtime directory so the endpoint/token descriptor cannot accidentally become project or Git state.

The `core:mcp` command opens an existing project only. Use `project:create` separately for initialization. If the Project opens as `recoveryRequired` because Current is dirty, the CLI fails before starting the MCP server; recover Current first.

## 4. Register the printed endpoint in Claude Code

After startup, the CLI prints output with this shape:

```text
Music Core MCP ready
Project: /path/to/project
Project ID: <project-id>
Endpoint: http://127.0.0.1:<ephemeral-port>/mcp
Instance Token: <random-token>

Claude Code:
claude mcp add --transport http agent-music http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <random-token>"
```

Run the printed `claude mcp add ...` command in another terminal on the same machine.

The token is intentionally printed by this dev harness so a local MCP client can connect. Treat it as an ephemeral local credential. It is stored only in the user-level runtime descriptor and is removed when the server stops normally.

You can inspect the Claude Code registration with:

```bash
claude mcp list
claude mcp get agent-music
```

## 5. Available Music Core tools

Claude Code should discover exactly:

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

There is intentionally no eighth cancel/approval tool.

## 6. Generation Plan confirmation

`submitGenerationPlan` is an Operation-creating call, not a long-held RPC. Claude Code supplies a stable UUID `operationId`; the call returns immediately. The terminal prompt shows that Operation ID. Use `getOperation` to recover the user decision/Task bootstrap and `cancelOperation` for explicit business cancellation. A client timeout alone does not cancel the Operation.

```text
Generation plan
Summary: ...
Scope: ...
Approve? [y/N]
```

Enter `y` or `yes` to approve. Any other answer rejects the plan. Approval goes through the existing Core/A3 control path and only then creates the Candidate Task.

Do not close the MCP server terminal while a confirmation prompt is pending.

## 7. Scope Extension confirmation

When Claude Code calls `requestScopeExtension`, the real A3 pending Scope Extension is created first. The MCP server terminal then asks:

```text
Scope extension requested
Request ID: ...
Requested Scope: ...
Approve scope extension? [y/N]
```

Enter `y` or `yes` to approve; any other answer rejects through the existing A3 control seam.

Approval/rejection is deliberately not exposed as an Agent MCP tool. The confirmation is cancellation-bound: if the MCP client times out/cancels, the terminal prompt is aborted and the pending extension must not be approved later. After an approved `requestScopeExtension` returns, Claude Code should call `getTaskContext` again and use the returned authoritative `scopeRevision` and Scope for all later Task-bound calls.

## 8. Stop the server

Use `Ctrl+C` in the MCP server terminal.

Normal termination:

1. stops the HTTP MCP server;
2. removes the runtime descriptor;
3. releases the opened Project lock;
4. closes terminal input.

`SIGTERM` follows the same cleanup path.

## 9. Regression use

For broad A-layer MCP Server regression, use:

```text
docs/verification/a4-mcp-server-regression.md
```

That procedure verifies not only connectivity but also the ten tools' behavior against real Candidate files, Git checkpoints, authorization state, stable errors, and Current/main invariants.

The dev CLI is the recommended launcher for local interoperability checks, but a successful `tools/list` alone is not a substitute for the full A-layer regression procedure.


## 10. Long-form composition structure

For a long new composition, do not use Scope Extension to create future time or force one huge whole-project replacement. Use:

```text
updateMusicalProperties(meter/initial tempo as needed)
→ resizeComposition({ targetMeasureCount })
→ getScopedComposition / replaceScopedMusic with bounded timeRange `targetScope` chunks
→ finishTask
```

`resizeComposition` uses an absolute target measure count. Repeating the same target after a transport timeout is idempotent.
