# Agent Music Workstation 基础项目骨架设计

| 项目 | 内容 |
|---|---|
| 日期 | 2026-07-30 |
| 状态 | 已实现 |
| 对应范围 | 项目初始化 A：基础骨架 |
| 架构基线 | System Architecture V1.2 |
| 产品基线 | PRD V1.5 |

> **历史文档说明：** 本文记录 2026-07-30 基础骨架设计时的依赖预期。当前 P0 以 PRD V1.11 / System Architecture V1.9 为准：SQLite 已从 P0 删除，Agent Session 改由 Strands SessionManager/Storage 管理；Provider 与 Agent-side MCP Client 也直接使用 Strands 能力。本文中相关旧条目仅保留为历史设计记录，不构成当前实现要求。

## 1. 目标

为 Agent Music Workstation 建立可持续扩展的 pnpm Monorepo 基础骨架，使后续 Electron、React、Music Core、Strands、MCP、openDAW 和 SQLite 实现能够在明确的模块边界内增量接入。

本阶段只交付工程结构、共享类型入口和代码质量工具，不交付可启动桌面窗口或业务功能。

## 2. 范围

本阶段包括：

- pnpm workspace 与根级脚本；
- TypeScript strict 基础配置；
- Node 与 Renderer 可分别扩展的 TypeScript 配置边界；
- ESLint、Prettier、Vitest；
- `apps/workstation`、`apps/agent`、`packages/contracts` 与 `vendor/opendaw` 目录；
- 各 workspace 的独立 `package.json` 和 TypeScript 配置；
- `packages/contracts` 的最小领域类型与公共出口；
- Node 与 pnpm 版本约束；
- 与项目运行时、缓存和构建产物相匹配的 `.gitignore`；
- 根级统一校验命令。

## 3. 非目标

本阶段不包括：

- Electron Main、BrowserWindow 或 preload；
- React 应用和 UI；
- Electron Utility Process；
- Strands Agent Loop；
- MCP Server 或 Client；
- openDAW SDK、WASM、Worker 或 AudioWorklet；
- SQLite/LibSQL 驱动和 Schema；
- Canonical ABC Parser、Scope Mapping、MIDI 或 Git/worktree 业务实现；
- 安装包、开发服务器或应用启动命令。

上述依赖不在基础骨架阶段安装，避免在尚未实现对应模块前扩大 lockfile 和构建复杂度。

## 4. 目录结构

```text
Agent-Music-Workstation/
├── apps/
│   ├── workstation/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── main/
│   │       ├── renderer/
│   │       └── core/
│   └── agent/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
├── packages/
│   └── contracts/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── domain.ts
│           └── index.ts
├── vendor/
│   └── opendaw/
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
├── eslint.config.js
├── prettier.config.mjs
├── .prettierignore
├── vitest.config.ts
├── .node-version
└── .npmrc
```

空目录使用 `.gitkeep` 保留，但不添加虚假的实现文件。

## 5. Workspace 边界

### 5.1 `apps/workstation`

未来承载 Electron Main、Renderer 和 Music Core。基础阶段只建立目录和配置，不创建启动入口。

### 5.2 `apps/agent`

未来承载 Strands Agent Runtime、Agent Workflow、Agent / Model Settings，以及对 Strands 原生 OpenAI-compatible Model 与 Agent-side MCP Client 的配置集成。基础阶段只建立目录和配置，不安装 Strands 或模型 SDK。

### 5.3 `packages/contracts`

只保存跨 Workstation 与 Agent 共享的稳定 Schema 和类型。基础阶段先提供：

- `ProjectId`；
- `TaskId`；
- `CandidateId`；
- `TrackId`；
- `Tick`；
- `TickRange`；
- `TaskScope`；
- 固定 Track ID 常量与只读元组。

不在此包放置解析、文件、Git、MIDI、openDAW 或 Agent 业务实现。

### 5.4 `vendor/opendaw`

预留上游 openDAW fork 或 vendored source 的位置。本阶段保持为空，不复制 Spike 工作区或安装 SDK。

## 6. TypeScript 策略

根级 `tsconfig.base.json` 启用：

- `strict`；
- `noUncheckedIndexedAccess`；
- `exactOptionalPropertyTypes`；
- `noImplicitOverride`；
- `noFallthroughCasesInSwitch`；
- `useUnknownInCatchVariables`；
- `verbatimModuleSyntax`；
- `isolatedModules`。

各 workspace 继承根配置并声明自己的运行环境：

- Workstation 和 Agent 基础配置使用 Node 类型边界；
- Renderer 后续建立独立 DOM 配置，不在当前阶段混入 Node 全局类型；
- Contracts 不依赖 Node 或 DOM，实现环境无关。

## 7. 工具与命令

根级脚本：

```text
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm check
```

其中 `pnpm check` 顺序执行格式检查、Lint、类型检查和测试。

工具选择：

- TypeScript：静态类型检查；
- ESLint：代码规则和 TypeScript 语义检查；
- Prettier：格式化；
- Vitest：单元测试；
- pnpm recursive/workspace commands：统一调度子包任务。

测试阶段至少包含一个 contracts 单元测试，验证固定 Track Registry 和 `TaskScope` 的类型/运行时辅助不变量，避免测试命令成为无测试的空壳。

## 8. 版本与依赖策略

- 在根 `package.json` 固定 `packageManager`；
- 使用 `.node-version` 固定 Node 24.18.1；
- `.npmrc` 开启严格 peer dependency 和 workspace 行为约束；
- 首次安装生成并提交 `pnpm-lock.yaml`；
- 基础阶段只安装工程质量工具和 contracts 所需的最小依赖；
- Electron、React、Strands、openDAW、MCP SDK 和 SQLite 驱动在对应纵切实现时单独引入并验证。

## 9. `.gitignore` 策略

忽略：

- `node_modules`；
- `dist`、`build`、`coverage`、`.vite`、`.turbo` 等构建与缓存目录；
- 日志和系统临时文件；
- SQLite 数据库及 WAL/SHM 文件；
- `.agent-music`、导出缓存和运行时描述文件；
- Candidate worktree 的运行时目录；
- 本地环境变量文件。

不忽略：

- `pnpm-lock.yaml`；
- workspace 配置；
- contracts 源码和测试；
- `vendor/opendaw/.gitkeep`。

## 10. 验收标准

基础骨架完成时必须满足：

1. 仓库具有设计中的目录与配置文件；
2. `pnpm install --frozen-lockfile` 成功；
3. `pnpm check` 成功；
4. TypeScript strict 规则实际生效；
5. Contracts 可以被两个 app workspace 通过 workspace dependency 引用；
6. Contracts 测试通过；
7. 没有安装 Electron、React、Strands、openDAW、MCP SDK 或 SQLite 驱动；
8. 没有添加业务占位实现或伪造启动入口；
9. Git 工作区在提交后保持 clean；
10. Secret scan 不发现凭据。

## 11. 后续演进

基础骨架完成后的推荐下一纵切是“可启动骨架”：

```text
Electron Main
→ Renderer 最小页面
→ Music Core Utility Process
→ Agent Service
→ contracts 驱动的类型化 IPC
→ health check
```

该纵切应独立设计和计划，不在本次初始化中预先实现。
