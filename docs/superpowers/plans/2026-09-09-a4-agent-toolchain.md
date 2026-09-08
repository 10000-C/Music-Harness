# A4 Agent Toolchain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement A4 on `feat/a4`: Strands-based OpenAI-compatible Agent execution, Strands MCP client and Session management, Project multi-session lifecycle, Settings, bounded repair/cancel semantics, Core MCP integration adapters, and the minimal Renderer-facing Agent transport contract.

**Architecture:** `apps/agent` owns Settings, Project/Session association, Strands Agent construction and A4 Workflow. It creates a fresh Strands Agent per invocation so the latest model configuration is used while the active `sessionId` restores durable conversation state through Strands `SessionManager` + `FileStorage`. `apps/workstation/src/core/mcp` is a thin transport adapter over the existing A3 Agent/Control ports; it owns loopback MCP hosting, runtime descriptor and `submitGenerationPlan` confirmation handoff, but no A4 Workflow logic. A4 transaction rollback is expressed through a narrow injected host-control port rather than adding an eighth Agent MCP tool.

**Tech Stack:** Node.js 24.18.1, pnpm 9.15.9, TypeScript 5.9 strict mode, Vitest 4.1, `@strands-agents/sdk` 1.16.x, OpenAI SDK 6.x peer required by Strands, MCP TypeScript SDK v1.x compatible with Strands, Zod v4.

## Global Constraints

- Branch: `feat/a4`, based on `dev` commit `dc72bae`.
- TDD: one public-seam behavior at a time; verify red before implementation and green after implementation.
- Atomic commits: each task below ends in an independently reviewable commit.
- P0 exposes exactly seven Agent MCP tools: `getTaskContext`, `getScopedComposition`, `submitGenerationPlan`, `requestScopeExtension`, `replaceScopedMusic`, `updateGlobalMeter`, `finishTask`.
- A4 must use Strands native OpenAI-compatible model, MCP client, SessionManager/Storage and context management; no custom SSE parser, generic retry loop, transcript engine or compaction engine.
- Model configuration is read at each model invocation. `maxRepairAttempts` is read immediately before each new repair round.
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
- Produces `McpRuntimeDescriptor` and runtime validators.
- Contract validators accept only UUID project/session/execution IDs, non-empty endpoint/token fields, and known command/event variants.

- [ ] **Step 1: Add failing contract tests** for valid/invalid runtime descriptors, Project session commands, message/cancel commands, text delta, and completed/failed/cancelled terminal events.
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
- `createStrandsSession(sessionId, storageRoot)` returns a Strands `SessionManager` backed by Strands `FileStorage`; A4 does not parse Strands snapshots.

- [ ] **Step 1: Write failing registry tests** for two Sessions in one Project, Project isolation, active switching, reload from persisted association JSON, and Save-As/new Project isolation.
- [ ] **Step 2: Implement minimal atomic `session-index.json` metadata persistence**; do not persist messages/tool results in the index.
- [ ] **Step 3: Add Strands dependencies to `apps/agent`** (`@strands-agents/sdk`, compatible `openai`, MCP SDK peer, `zod`) using exact pnpm versions resolved on this branch.
- [ ] **Step 4: Write a failing Strands Session test** that saves a message snapshot and restores it through a new Agent/SessionManager using the same `sessionId` and FileStorage root.
- [ ] **Step 5: Implement the Strands Session factory with `contextManager: 'auto'` at Agent creation time and shared agent-level FileStorage so session/offloader namespaces persist.**
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
- `CoreMcpServer.start(projectId)` binds only `127.0.0.1` on an ephemeral port and writes `{projectId, endpoint, instanceToken, pid}` to the injected runtime descriptor store.
- `CoreMcpServer.stop()` closes HTTP/MCP resources and removes the descriptor.
- `GenerationPlanConfirmationPort.request(input)` waits for product approval and returns an approved `TaskScope` or rejection/cancellation; approval then calls existing `CandidateControlPort.startTask`.
- All Task-bound tools delegate to `CandidateAgentPort`; no Candidate authorization logic is duplicated in the MCP layer.

- [ ] **Step 1: Write failing runtime descriptor tests** for restrictive permissions, stale-PID cleanup, write/remove lifecycle, and project isolation.
- [ ] **Step 2: Implement descriptor storage and token generation.**
- [ ] **Step 3: Write a failing MCP host test** asserting `tools/list` returns exactly the seven P0 tools and missing/wrong bearer token is rejected.
- [ ] **Step 4: Implement loopback Streamable HTTP using MCP SDK v1.x and Zod tool schemas.**
- [ ] **Step 5: Add failing delegation tests** for each tool, including a pending `submitGenerationPlan` that creates no Task before confirmation and starts a Task only after approval.
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
- Runtime descriptor client discovers the descriptor for the requested Project and rejects mismatched/stale descriptors.
- Each invocation calls `AgentSettingsStore.getActiveModelConfig()` and creates `OpenAIModel({ api: 'chat', ... })` from the latest settings.
- MCP uses Strands `McpClient` with the descriptor endpoint and instance token header; no custom MCP protocol client exists.
- Strands `Agent` receives the active SessionManager/FileStorage and `contextManager: 'auto'`.

- [ ] **Step 1: Write failing descriptor discovery tests** for valid project, project mismatch, dead PID, malformed descriptor, and secret-safe errors.
- [ ] **Step 2: Implement minimal descriptor reader.**
- [ ] **Step 3: Write a failing factory test** showing two sequential invocations observe two different active model configurations without changing the Session ID.
- [ ] **Step 4: Implement OpenAI Chat Completions model + Strands McpClient construction using current settings/descriptor per invocation.**
- [ ] **Step 5: Add an integration test against Task 4's real local MCP server** proving Strands sees the seven tools through MCP.
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
- `AgentWorkflow.cancelCurrentExecution(projectId)` cancels the active Strands Agent; if an A3 Task has been bootstrapped, it calls injected `TaskRollbackPort.cancelTask`.
- `TaskRollbackPort` is a narrow host/control seam for A3 rollback and is not an Agent MCP tool.
- Validation failure starts bounded repair; `requestScopeExtension` is unavailable in repair mode; each full repair loop increments once; latest `maxRepairAttempts` is read at the next-round boundary.

- [ ] **Step 1: Write failing streaming tests** proving only text deltas and a terminal event escape A4 even when Strands emits tool events.
- [ ] **Step 2: Implement minimal stream event projection using Strands `modelStreamUpdateEvent → modelContentBlockDeltaEvent → textDelta`.**
- [ ] **Step 3: Write failing cancellation tests** for planning/pre-Task cancellation and Active-Task cancellation/rollback.
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
- `AgentService.handle(command, emit)` is the single host-facing A4 seam for Session list/create/open/getActive, sendMessage and cancel.
- Session switching is rejected while execution is active.
- Agent Service shutdown/crash cleanup calls Workflow shutdown; if a Task is active, rollback is attempted before service termination is considered clean.
- `AgentEvent` output contains no API key, raw MCP Tool Result, full A4 Workflow state, project file path, Git path or Strands snapshot structure.

- [ ] **Step 1: Write failing service tests** for multi-session command routing, active-session enforcement, switch-while-running rejection, text/terminal forwarding and cancel.
- [ ] **Step 2: Implement the command handler as composition only; keep Settings/Session/Runtime/Workflow responsibilities in their modules.**
- [ ] **Step 3: Add a crash/shutdown test** proving an Active Task uses the rollback port and that Session conversation data remains restorable afterward.
- [ ] **Step 4: Run focused A4 tests.**
- [ ] **Step 5: Run full `pnpm check`, `git diff --check`, and secret scan.**
- [ ] **Step 6: Run a code review against `dev` for coding standards and PRD/Architecture coverage; fix only A4-scope findings and re-run verification.**
- [ ] **Step 7: Commit:** `feat(agent): expose a4 agent service`.

## Plan Self-Review

- Spec coverage: Settings ownership, Strands Provider/MCP/Session, Project multi-session, dynamic model config, dynamic repair cap, long-held generation-plan confirmation, no repair Scope Extension, unified cancel/final-failure rollback, crash rollback, and minimal Renderer transport all map to explicit tasks.
- No placeholders: every task has concrete file boundaries, public seams, red/green verification and a commit boundary.
- Type consistency: shared IDs/commands/events originate in `packages/contracts`; A4 internal ports remain in `apps/agent`; A3 transaction types remain owned by existing Core/contracts and are not duplicated.
- Scope control: B1/B2/B4 implementation is not included; A4 only defines the shared transport data contract they will consume later.
