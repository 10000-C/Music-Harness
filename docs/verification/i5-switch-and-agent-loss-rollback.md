# I5 联调缺口修复验证 — Project 切换协调与 Agent 丢失回滚

日期：2026-09-15
分支：`inter/agentAndmcp`（worktree `i5-switch-rollback-wiring`）
范围：`docs/devplan.md` 第 10 节 I5 通过标准中的两项未接线条目。

## 修复内容

### 1. Project 切换协调链接线（I5 通过标准：Project switch 竞态条目）

**修复前**：`ProjectSwitchCoordinator` 已实现并有单测，但从未在 Main
进程实例化。Renderer 确认切换后直接 dispatch `project.open`，Core 因
`PROJECT_ALREADY_OPEN` 拒绝（`project-foundation.ts` 的
`assertNoActiveProject`），已开项目之间的切换必然失败，也没有
cancel → settle → close → open 的协调序。

**修复后**：

- `apps/workstation/src/main/register-shell-ipc.ts` 实例化
  `ProjectSwitchCoordinator`：
  - Agent port 通过新增的 `agent.execution.state` 命令向 Agent 进程查询
    `running` / `activeTask`，cancel 走 `agent.execution.cancel`，
    settle 轮询 state 直到 execution 结束；
  - Core port 走 `supervisor.dispatchProject`（close A → open B，open 失败
    时由 coordinator 恢复 A）。
- 新增 IPC 通道 `shell:project:switch`（`shell-contracts.ts`），preload
  暴露为 `switchProject({projectPath})`，校验后透传。
- `app.tsx` 的 `ProjectSwitchConfirmation.onConfirm` 改调
  `bridge.switchProject`；确认对话框继续承担"先提示"职责（I5 标准要求），
  Main 承担 cancel/settle/close/open 的权威顺序；失败保持源项目并显示
  结构化错误。

**协调链**：Renderer 确认 → Main coordinator → Agent state 查询 →
（有活动时）cancel → settle → Core close A → Core open B →（失败时
reopen A）→ 原始 `project.opened` 事件（真实 sequence）回 Renderer。
Core/MCP/Agent 进程全程不重启。

### 2. Agent 进程意外退出时回滚权威 Active Task（I5 通过标准：Agent 子进程突然退出条目）

**修复前**：supervisor 的 agent exit/fatal 路径只做 fail/restart，没有
通知 Core 调 `candidate.cancelActiveTaskForAgentLoss`。

**修复后**（`service-supervisor.ts`）：

- supervisor 从 Core `project.opened` / `project.closed` 事件跟踪
  Active Project（`getActiveProjectId` / `trackActiveProject`）；
- agent 意外 `onExit`（非 shutdown）和 `agent.process.fatal` 时，向 Core
  发送 `candidate.cancelActiveTaskForAgentLoss`（best-effort，Core 端对
  无 Active Task 幂等安全）。

### 3. 契约扩展

`packages/contracts/src/agent.ts`：`AgentCommand` 新增
`agent.execution.state`，`AgentCommandResult` 新增
`agent.execution.stateReported { running, activeTask }`；Agent 侧
`AgentService` / `AgentWorkflow.hasActiveTask` 实现；Main 为唯一消费方
（Renderer 不直接查询）。

## 测试

- `packages/contracts/src/agent.test.ts`：state 命令/结果校验。
- `apps/agent/src/service/agent-service.test.ts`：`agent.execution.state`
  返回 idle/busy 状态。
- `apps/workstation/tests/service-supervisor.test.ts`：agent 意外退出时
  发送 `candidate.cancelActiveTaskForAgentLoss`；无 tracked project 时跳过。
- `apps/workstation/tests/shell-ipc.test.ts`：projectSwitch 通道注册、
  无源项目拒绝、确认切换走 close→open 顺序、Agent 不可达时 fail-closed。
- `apps/workstation/tests/preload-allowlist.test.ts` 与
  `desktop-shell.smoke.test.ts`：bridge allowlist 更新
  （新增 `switchProject`）。
- 既有 `project-switch-coordinator.test.ts` 全部通过（协调器逻辑未改）。

## 准入

format / lint / typecheck 全部通过；本改动涉及的测试全部通过
（contracts agent 11 例、workstation shell-ipc + service-supervisor +
preload-allowlist + project-switch-coordinator 53 例、agent service 8 例）。

**已知基线失败（与本次改动无关，已在主检出 `inter/agentAndmcp` 复现）**：
11 个 git 集成测试因 Windows 长路径限制失败（`git init` 于 >300 字符路径
抛 `GIT_OPERATION_FAILED`），涉及 project-foundation / candidate-repository /
candidate-transaction / export-preparation / core-mcp-cli 等文件。
修复方向：启用 git `core.longpaths` + Windows LongPathsPolicy，或缩短
测试 tmp 根路径。已登记为待修复 todo。
