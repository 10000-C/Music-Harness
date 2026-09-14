# Core MCP Dev CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a development CLI that launches the real Music Core MCP Server against an existing project so Claude Code can connect to it over Streamable HTTP.

**Architecture:** Keep the CLI as a thin composition root over existing Project/A2/A3/MCP modules. Terminal confirmation implements only non-Agent control decisions; the seven Agent MCP tools remain unchanged. Use `tsx` only to execute the repository's no-emit TypeScript source in development.

**Tech Stack:** Node.js 24, TypeScript 5.9, `tsx`, official MCP SDK, Vitest, existing Project/Candidate/Composition/MCP modules.

## Global Constraints

- Work on `feat/a4`.
- Do not add an eighth Agent MCP tool.
- Do not persist runtime descriptor/token inside the project/Git repository.
- Do not bypass MCP for Agent-facing mutations.
- Keep the CLI development-only and outside the product IPC/Renderer contracts.
- Use TDD for behavior-bearing code.

---

### Task 1: CLI parsing and terminal control adapter

**Files:**
- Create: `apps/workstation/src/dev/core-mcp-cli-support.ts`
- Test: `apps/workstation/src/dev/core-mcp-cli-support.test.ts`

**Interfaces:**
- Produces `parseCoreMcpCliOptions(argv)` returning `{ projectPath, runtimeDirectory }`.
- Produces a terminal confirmation adapter implementing `GenerationPlanConfirmationPort`.
- Produces a Candidate Agent wrapper that delegates all A3 Agent operations but asks for Scope Extension approval after the real pending request is created and routes the decision through `CandidateControlPort`.

- [ ] **Step 1:** Write tests for required `--project`, default `~/.agent-music/runtime`, explicit `--runtime-dir`, and unknown/missing arguments.
- [ ] **Step 2:** Run the focused test and confirm RED because support module does not exist.
- [ ] **Step 3:** Implement minimal parser.
- [ ] **Step 4:** Add tests for plan approval/rejection and Scope Extension approval/rejection ordering.
- [ ] **Step 5:** Run and confirm RED for missing terminal/control adapters.
- [ ] **Step 6:** Implement the adapters with injected question/output ports so tests do not fake production domain behavior.
- [ ] **Step 7:** Run focused tests and workstation typecheck.

### Task 2: Standalone Core MCP CLI composition root

**Files:**
- Create: `apps/workstation/src/dev/core-mcp-cli.ts`
- Create: `apps/workstation/src/dev/core-mcp-cli.integration.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- `runCoreMcpCli(options, io)` opens the existing project, composes production Candidate/A2/MCP modules, starts the HTTP server, prints endpoint/token/Claude command, and returns an idempotent cleanup handle.
- Package script: `pnpm core:mcp --project <path>`.

- [ ] **Step 1:** Write an integration test using a real temporary project and standards-compliant MCP client; expected failure is missing CLI composition function.
- [ ] **Step 2:** Add `tsx` as workstation dev dependency and `core:mcp` script.
- [ ] **Step 3:** Implement production composition with startup cleanup on failure and idempotent cleanup.
- [ ] **Step 4:** Add executable main guard and SIGINT/SIGTERM wiring.
- [ ] **Step 5:** Run integration test, focused tests, workstation typecheck/lint.

### Task 3: Usage documentation and final verification

**Files:**
- Create: `docs/verification/core-mcp-claude-code.md`
- Modify: `docs/superpowers/plans/2026-09-09-a4-agent-toolchain.md`

- [ ] **Step 1:** Document local startup, the printed Claude Code registration command, plan/Scope prompts, and cleanup behavior.
- [ ] **Step 2:** Link the CLI from the A-layer verification section as the recommended local server launcher.
- [ ] **Step 3:** Run `pnpm install --frozen-lockfile`, format check, lint, sequential strict typechecks, full tests, `git diff --check`, and secret scan.
- [ ] **Step 4:** Review the final diff against this design and A4's seven-tool boundary.
- [ ] **Step 5:** Commit and push `feat/a4`.
