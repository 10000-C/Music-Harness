# A4 Agent Toolchain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement A4 on `feat/a4`: Strands-based OpenAI-compatible Agent execution, Strands MCP client and Session management, Project multi-session lifecycle, Settings, bounded repair/cancel semantics, Core MCP integration adapters, and the minimal Renderer-facing Agent transport contract. Architecture V1.14 additionally requires the product runtime to converge on one Core-process-scoped MCP connection across Project switches.

**Architecture:** `apps/agent` owns Settings, Project/Session association, Strands Agent construction and A4 Workflow. It creates a fresh Strands Agent per workflow invocation while `DynamicOpenAiChatModel` re-resolves the active model configuration for every Strands model call; the active `sessionId` restores durable conversation state through Strands `SessionManager` + `LocalFileStorage`. `apps/workstation/src/core/mcp` is a thin transport adapter over the existing A3 Agent/Control ports; in the formal product runtime it owns one loopback MCP server and Core-process-scoped runtime descriptor whose lifetime is independent of Project close/open. A4 connects to that single Core MCP and never chooses an endpoint by `projectId`. A4 transaction rollback remains a narrow injected host-control port rather than an eighth Agent MCP tool.

**Tech Stack:** Node.js 24.18.1, pnpm 9.15.9, TypeScript 5.9 strict mode, Vitest 4.1, `@strands-agents/sdk` 1.16.x, OpenAI SDK 6.x peer required by Strands, MCP TypeScript SDK v1.x compatible with Strands, Zod v4.

## Architecture V1.14 Delta — Required Before B1 Project-Switch Integration

The initial A4 implementation used a Project-scoped runtime descriptor and created an MCP client from `projectId` for each invocation. PRD V1.16 / Architecture V1.14 supersede that **formal product topology** while preserving the eight-tool MCP contract and the standalone `core:mcp --project` development harness.

Before B1 Project-switch integration is considered complete:

- shared product `McpRuntimeDescriptor` becomes Core-process-scoped (`endpoint`, `instanceToken`, `pid`); Project selection is not connection discovery;
- product Music Core starts one MCP Server per Core process and keeps it alive across `closeProject(A) → openProject(B)`;
- A4 creates/reuses one Core MCP infrastructure connection and does not call descriptor discovery with `projectId`; `projectId` remains in Agent commands and A3 execution envelopes only for authority validation;
- `cancelCurrentExecution(projectId)` must resolve only after any bootstrapped Active Task rollback has completed, so B1 can use it as the Project-switch barrier;
- no `switchProject` Agent Tool is added; B1/B2 own user-initiated Project switching.

The existing `core:mcp --project ...` CLI remains intentionally Project-bound for Claude Code/A-layer regression and is not the product process composition root.

## Global Constraints

- Branch: `feat/a4`, based on `dev` commit `dc72bae`.
- TDD: one public-seam behavior at a time; verify red before implementation and green after implementation.
- Atomic commits: each task below ends in an independently reviewable commit.
- Product runtime uses one Core-process-scoped MCP connection across Project switches; A4 does not maintain one MCP endpoint per Project.
- P0 exposes exactly eight Agent MCP tools: `getTaskContext`, `getScopedComposition`, `submitGenerationPlan`, `requestScopeExtension`, `replaceScopedMusic`, `updateMusicalProperties`, `resizeComposition`, `finishTask`; the Agent-facing `submitGenerationPlan` schema is `summary + scope` only, with Core/MCP injecting the Active Project ID.

- Long-form generation uses `updateMusicalProperties → resizeComposition(targetMeasureCount) → segmented timeRange replacement`; `requestScopeExtension` never creates future timeline length.
- Agent guidance must treat `TRACK_LENGTH_MISMATCH` details and normalized parser diagnostics as repair inputs; Tick-0 inline `[Q:]`/`[K:]` are invalid.
- Scope Extension confirmation must abort and clear/reject pending authorization when the MCP Tool Call is cancelled or times out.
- A4 must use Strands native OpenAI-compatible model, MCP client, SessionManager/Storage and context management; no custom SSE parser, generic retry loop, transcript engine or compaction engine.
- Model configuration is read at each Strands model call. `maxRepairAttempts` is read immediately before each new repair round.
- Repair never requests Scope Extension. One `ValidationReport → repair → finishTask` cycle counts as one `repairAttempt`.
- Final non-validation execution failure and user cancel with an Active Task must cancel/rollback that Task. A4 `failed` must not leave an Active Task.
- One Project may own multiple Agent Sessions, but P0 has exactly one Active Session per Project and no background execution in inactive Sessions.
- Renderer never reads Strands Storage and never receives raw MCP Tool Result or internal A4 Workflow state.
- A4 → Renderer transport is limited to Session lifecycle, user message/cancel, assistant text delta, and execution terminal events.
- API keys must not appear in project files, Git-tracked runtime data, Session Storage content written by A4, logs, or user-visible errors.

---

### Task 1: Shared Agent and MCP Contracts + Agent Test Harness

**Files:**
- Create: `packages/contracts/src/agent.ts`
- Create: `packages/contracts/src/mcp.ts`
- Create: `packages/contracts/src/agent.test.ts`
- Create: `packages/contracts/src/mcp.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Create: `apps/agent/vitest.config.ts`
- Modify: `apps/agent/tsconfig.json`

**Interfaces:**
- Produces branded `AgentSessionId` and `AgentExecutionId` values at shared IPC boundaries.
- Produces `AgentSessionSummary`, `AgentCommand`, `AgentCommandResult`, and `AgentEvent` discriminated unions.
- Produces the MCP runtime descriptor contract and runtime validators. Under Architecture V1.14 the formal product descriptor is Core-process-scoped rather than Project-scoped; the older `{projectId,...}` shape is a migration target, not the final B1 contract.
- Contract validators accept only UUID project/session/execution IDs, non-empty endpoint/token fields, known command/event variants, and the exact declared keys for each variant/nested payload; undeclared fields are rejected.

- [ ] **Step 1: Add failing contract tests** for valid/invalid runtime descriptors, Project session commands, message/cancel commands, text delta, completed/failed/cancelled terminal events, and otherwise-valid variants containing forbidden extra fields.
- [ ] **Step 2: Run the two contract test files** and verify they fail because the new modules are missing.
- [ ] **Step 3: Implement the minimal branded types, discriminated unions, and validators** without introducing transport implementation.
- [ ] **Step 4: Add `apps/agent/vitest.config.ts` and make its tsconfig include `src/**/*.ts`** so A4 tests participate in root `pnpm test` / `pnpm typecheck`.
- [ ] **Step 5: Run contract tests, `pnpm --filter @agent-music/contracts typecheck`, and root formatting check.**
- [ ] **Step 6: Commit:** `feat(contracts): define agent and mcp boundaries`.

### Task 2: A4 Settings Store

**Files:**
- Create: `apps/agent/src/settings/agent-settings.ts`
- Create: `apps/agent/src/settings/agent-settings-store.ts`
- Create: `apps/agent/src/settings/agent-settings-store.test.ts`
- Create: `apps/agent/src/settings/index.ts`

**Interfaces:**
- Produces `AgentSettingsStore.read(): Promise<AgentSettings>`.
- Produces `AgentSettingsStore.write(settings): Promise<void>` using temporary-file + atomic rename and restrictive file mode.
- Produces `getActiveModelConfig()` and `getMaxRepairAttempts()` helpers that always read the current file rather than a frozen Workflow snapshot.

- [ ] **Step 1: Write a failing test** proving missing settings produce a deterministic default document or explicit configuration error according to the store constructor fixture.
- [ ] **Step 2: Run the test and confirm red.**
- [ ] **Step 3: Implement JSON parsing and schema validation** for `formatVersion`, `activeModelConfigId`, model endpoint/apiKey/model/parameters, and non-negative integer `maxRepairAttempts`.
- [ ] **Step 4: Write failing tests** for unknown active model ID, malformed endpoint/model/key, negative repair attempts, atomic replacement, and file mode on POSIX.
- [ ] **Step 5: Implement minimal atomic persistence and normalized non-secret errors.**
- [ ] **Step 6: Verify agent settings tests + typecheck + lint.**
- [ ] **Step 7: Commit:** `feat(agent): add secure settings store`.

### Task 3: Project Multi-Session Registry and Strands Session Factory

**Files:**
- Create: `apps/agent/src/session/session-registry.ts`
- Create: `apps/agent/src/session/session-registry.test.ts`
- Create: `apps/agent/src/session/strands-session.ts`
- Create: `apps/agent/src/session/strands-session.test.ts`
- Create: `apps/agent/src/session/index.ts`

**Interfaces:**
- `SessionRegistry.list(projectId)` returns only that Project's sessions.
- `SessionRegistry.create(projectId)` creates a UUID session, persists only association metadata, and makes it active.
- `SessionRegistry.open(projectId, sessionId)` rejects cross-Project IDs and updates the single Active Session.
- `SessionRegistry.getActive(projectId)` returns the authoritative active session.
- `createStrandsSession(sessionId, storageRoot)` returns a Strands `SessionManager` backed by Strands `LocalFileStorage`; A4 does not parse Strands snapshots.

- [ ] **Step 1: Write failing registry tests** for two Sessions in one Project, Project isolation, active switching, reload from persisted association JSON, and Save-As/new Project isolation.
- [ ] **Step 2: Implement minimal atomic `session-index.json` metadata persistence**; do not persist messages/tool results in the index.
- [ ] **Step 3: Add Strands dependencies to `apps/agent`** (`@strands-agents/sdk`, compatible `openai`, MCP SDK peer, `zod`) using exact pnpm versions resolved on this branch.
- [ ] **Step 4: Write a failing Strands Session test** that saves a message snapshot and restores it through a new Agent/SessionManager using the same `sessionId` and LocalFileStorage root.
- [ ] **Step 5: Implement the Strands Session factory with `contextManager: 'auto'` at Agent creation time and shared agent-level LocalFileStorage so session/offloader namespaces persist.**
- [ ] **Step 6: Verify Session tests, package typecheck, and lockfile integrity.**
- [ ] **Step 7: Commit:** `feat(agent): add project session management`.

### Task 4: Core MCP Runtime Descriptor and Seven-Tool Host

**Files:**
- Create: `apps/workstation/src/core/mcp/runtime-descriptor.ts`
- Create: `apps/workstation/src/core/mcp/runtime-descriptor.test.ts`
- Create: `apps/workstation/src/core/mcp/core-mcp-server.ts`
- Create: `apps/workstation/src/core/mcp/core-mcp-server.test.ts`
- Create: `apps/workstation/src/core/mcp/index.ts`
- Modify: `apps/workstation/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Architecture V1.14 target: `CoreMcpServer.start()` binds one `127.0.0.1` ephemeral endpoint per Core process and writes a Core-process-scoped descriptor `{endpoint, instanceToken, pid}`. Project close/open does not stop the server. The earlier `start(projectId)` behavior is retained only by the standalone dev harness until the product composition root is migrated.
- `CoreMcpServer.stop()` closes HTTP/MCP resources and removes the descriptor; descriptor publish/remove failures are exception-safe and cannot leave a logically failed server bound.
- `GenerationPlanConfirmationPort.request(input)` waits for product approval and returns an approved `TaskScope` or rejection/cancellation; approval then calls existing `CandidateControlPort.startTask`.
- All Task-bound tools delegate to `CandidateAgentPort`; no Candidate authorization logic is duplicated in the MCP layer.

- [ ] **Step 1: Write failing runtime descriptor tests** for restrictive permissions, stale-PID cleanup, write/remove lifecycle, project isolation, descriptor publish failure cleanup, and descriptor remove failure cleanup.
- [ ] **Step 2: Implement descriptor storage and token generation.**
- [ ] **Step 3: Write a failing MCP host test** asserting `tools/list` returns exactly the eight P0 tools and missing/wrong bearer token is rejected.
- [ ] **Step 4: Implement loopback Streamable HTTP using MCP SDK v1.x and Zod tool schemas.**
- [ ] **Step 5: Add failing delegation tests** for each tool, including a pending `submitGenerationPlan` whose Agent-facing schema omits `projectId`, whose MCP adapter injects the bound Active Project, and that creates no Task before confirmation but starts a Task only after approval. Add timeout cancellation coverage proving MCP `notifications/cancelled` reaches the original Tool Call signal.
- [ ] **Step 6: Implement only serialization/error-normalization adapters over A3; do not move A2/A3 rules into the tool host.**
- [ ] **Step 7: Verify MCP unit/HTTP integration tests and workstation typecheck.**
- [ ] **Step 8: Commit:** `feat(core): expose candidate tools over mcp`.

### Task 5: Strands Model + MCP Runtime Factory

**Files:**
- Create: `apps/agent/src/runtime/runtime-descriptor-client.ts`
- Create: `apps/agent/src/runtime/runtime-descriptor-client.test.ts`
- Create: `apps/agent/src/runtime/strands-agent-factory.ts`
- Create: `apps/agent/src/runtime/strands-agent-factory.test.ts`
- Create: `apps/agent/src/runtime/index.ts`

**Interfaces:**
- Architecture V1.14 target: runtime descriptor discovery resolves the single live Core instance and rejects stale/malformed descriptors; it does not take `projectId` to choose an endpoint.
- Each invocation calls `AgentSettingsStore.getActiveModelConfig()` and creates `OpenAIModel({ api: 'chat', ... })` from the latest settings.
- MCP uses Strands `McpClient` with the Core descriptor endpoint and instance token header; the connection is reusable across Project close/open, and no custom MCP protocol client exists.
- Strands `Agent` receives the active SessionManager/LocalFileStorage and `contextManager: 'auto'`.

- [ ] **Architecture V1.14 follow-up:** replace Project-scoped discovery tests with Core-instance discovery tests (live descriptor, dead PID, malformed descriptor, secret-safe errors) and add a Project A → B switch integration proving the same MCP endpoint/client remains usable.
- [ ] **Architecture V1.14 follow-up:** migrate the descriptor reader/factory so Project IDs no longer select endpoints; preserve `projectId` only in workflow/business calls.
- [ ] **Step 3: Write a failing factory test** showing two sequential invocations observe two different active model configurations without changing the Session ID.
- [ ] **Architecture V1.14 follow-up:** keep model configuration dynamic per invocation/model call, but move Strands MCP infrastructure construction to the Core-instance lifecycle so Project close/open reuses the same endpoint/client instead of selecting a descriptor per Project.
- [ ] **Step 5: Add an integration test against Task 4's real local MCP server** proving Strands sees the eight tools through MCP; V1.14 completion additionally requires Project A close → Project B open with the same MCP endpoint/client and correct active-project guards.
- [ ] **Step 6: Verify runtime tests and agent typecheck.**
- [ ] **Step 7: Commit:** `feat(agent): integrate strands model and mcp runtime`.

### Task 6: A4 Workflow, Streaming, Cancel, Repair and Failure Rollback

**Files:**
- Create: `apps/agent/src/workflow/agent-workflow.ts`
- Create: `apps/agent/src/workflow/agent-workflow.test.ts`
- Create: `apps/agent/src/workflow/workflow-error.ts`
- Create: `apps/agent/src/workflow/index.ts`

**Interfaces:**
- `AgentWorkflow.sendMessage({projectId, sessionId, text}, emit)` accepts only the active Session and one concurrent execution.
- `emit` receives assistant text deltas and one terminal event only; raw Strands Tool events/results and internal Workflow state are not emitted.
- For an already-confirmed local Task, `AgentWorkflow` mechanically resolves `getTaskContext({taskId})` through a dedicated Strands MCP bootstrap port before constructing the next model runtime; it does not rely on the LLM to decide whether to bootstrap.
- `AgentWorkflow.cancelCurrentExecution(projectId)` cancels the active Strands Agent; if an A3 Task has been bootstrapped, it calls injected `TaskRollbackPort.cancelTask`.
- `TaskRollbackPort` is a narrow host/control seam for A3 rollback and is not an Agent MCP tool.
- Validation failure starts bounded repair; `requestScopeExtension` is unavailable in repair mode; each full repair loop increments once; latest `maxRepairAttempts` is read at the next-round boundary.

- [ ] **Step 1: Write failing streaming tests** proving only text deltas and a terminal event escape A4 even when Strands emits tool events.
- [ ] **Step 2: Implement minimal stream event projection using Strands `modelStreamUpdateEvent → modelContentBlockDeltaEvent → textDelta`.**
- [ ] **Step 3: Write failing tests** for mechanical confirmed-Task bootstrap before the model runtime plus planning/pre-Task cancellation and Active-Task cancellation/rollback.
- [ ] **Step 4: Implement cancellation with a single active Abort/Agent handle and injected rollback port.**
- [ ] **Step 5: Write failing final-error tests** proving provider/MCP final errors roll back Active Task and never start repair.
- [ ] **Step 6: Write failing repair tests** proving only validation failure enters repair, Scope Extension cannot be used during repair, repair count increments per full cycle, and a dynamically lowered `maxRepairAttempts` stops before the next round and rolls back.
- [ ] **Step 7: Implement the minimal bounded workflow orchestration without a second generic retry loop.**
- [ ] **Step 8: Verify workflow tests and agent package checks.**
- [ ] **Step 9: Commit:** `feat(agent): orchestrate bounded agent workflow`.

### Task 7: Agent Service Command Handler + A4 Integration Verification

**Files:**
- Create: `apps/agent/src/service/agent-service.ts`
- Create: `apps/agent/src/service/agent-service.test.ts`
- Create: `apps/agent/src/service/index.ts`
- Create: `apps/agent/src/index.ts`
- Modify: `apps/agent/package.json`
- Update if implementation reality requires clarification only: `docs/superpowers/plans/2026-09-09-a4-agent-toolchain.md`

**Interfaces:**
- `AgentService.handle(command, emit)` is the single business-facing A4 seam for Session list/create/open/getActive, sendMessage and cancel.
- `AgentProcessEntrypoint` is the process-facing seam for typed ready/health/shutdown/fatal lifecycle plus Agent command/result/event forwarding; B1 owns only the concrete process transport/supervision adapter.
- Session switching is rejected while execution is active.
- Controlled Agent Service shutdown/fatal cleanup calls Workflow shutdown; if a Task is active, rollback is attempted before service termination is considered clean. Abrupt Agent child-process death cannot be repaired by the dead A4 process: B1 supervisor must notify Core with Project-only `candidate.cancelActiveTaskForAgentLoss`, and A3 uses its authoritative Active Task IDs to execute the existing rollback path.
- `AgentEvent` output contains no API key, raw MCP Tool Result, full A4 Workflow state, project file path, Git path or Strands snapshot structure.

- [ ] **Step 1: Write failing service tests** for multi-session command routing, active-session enforcement, switch-while-running rejection, text/terminal forwarding and cancel.
- [ ] **Step 2: Implement the command handler as composition only; keep Settings/Session/Runtime/Workflow responsibilities in their modules.**
- [ ] **Step 3: Add controlled fatal/shutdown tests** proving A4 cleanup uses the rollback port and Session conversation remains restorable; add a Core/A3 abrupt-agent-loss test proving Project-only reconciliation cancels the authoritative Active Task.
- [ ] **Step 4: Run focused A4 tests.**
- [ ] **Step 5: Run full `pnpm check`, `git diff --check`, and secret scan.**
- [ ] **Step 6: Run a code review against `dev` for coding standards and PRD/Architecture coverage; fix only A4-scope findings and re-run verification.**
- [ ] **Step 7: Commit:** `feat(agent): expose a4 agent service`.

## Integration Verification Layers

A4 acceptance is intentionally layered so a green lower layer is never treated as proof that a higher product path is reachable:

- **A — MCP Server / Core capability:** independent of Strands or any specific Agent. Use the dev launcher documented in `docs/verification/core-mcp-claude-code.md` when a standalone local server is useful, and execute the persistent Agent-run regression procedure in `docs/verification/a4-mcp-server-regression.md` with a standards-compliant MCP client. Verify the eight P0 tools are callable, authorization/error behavior is correct, and successful mutations are reflected in the real Candidate files/Git facts. Broad path verification is intentionally Agent-executed rather than a permanent large automated E2E; regressions found by it should become focused automated tests.
- **B — Strands Agent:** use a local fake OpenAI-compatible endpoint plus the real Strands Agent and real MCP server. Verify a real model `tool_call` reaches MCP, produces the SDK's real `afterToolCallEvent`, and the Tool Result appears in the next model request. No A4 Workflow state machine is involved.
- **C — Agent + Workflow + MCP:** use production `AgentWorkflow`, `StrandsAgentRuntimeFactory`, Strands MCP client and real MCP HTTP server with controlled Core tool outcomes. Verify first-generation tool loops, confirmed-Task mechanical bootstrap before the first model call, validation→repair, repair tool filtering, cancellation/failure semantics, and Renderer-safe terminal projection using real SDK events rather than hand-built event objects.
- **D — Full project acceptance:** connect the C-layer path to real `MusicCoreToolHost`, `CandidateTransaction`, `CompositionPipeline`, `CandidateGitRepository`, project files and Git worktrees. Assert final filesystem/Git authority: Candidate content/checkpoints change as expected, Current/main remains unchanged until Accept, and failure rollback restores the exact prior Task checkpoint.

A/B/C/D answer different questions. `tools/list` success, Strands MCP connectivity, or unit-level Workflow event parsing must not be used as substitutes for D-layer product-path reachability.

## Plan Self-Review

- Spec coverage: Settings ownership, Strands Provider/MCP/Session, Project multi-session, single Core MCP connection across Project switching, dynamic model config, dynamic repair cap, long-held generation-plan confirmation, mechanical confirmed-Task bootstrap, no repair Scope Extension, composition-resize-first long-form generation, recoverable validation diagnostics, unified cancel/final-failure rollback, controlled-fatal cleanup, abrupt-process Core reconciliation, and strict minimal Renderer transport all map to explicit tasks or the V1.14 migration delta above.
- No placeholders: every task has concrete file boundaries, public seams, red/green verification and a commit boundary.
- Type consistency: shared IDs/commands/events originate in `packages/contracts`; A4 internal ports remain in `apps/agent`; A3 transaction types remain owned by existing Core/contracts and are not duplicated.
- Scope control: B1/B2/B4 implementation is not included; A4 only defines the shared transport data contract they will consume later.
