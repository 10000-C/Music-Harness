# Agent Music Workstation 产品需求文档

**版本：** V1.9 Candidate Transaction Decisions\
**状态：** P0 产品范围已确认；A3 Candidate Transaction 决策已冻结\
**日期：** 2026-08-13\
**开发周期：** 10–15 天\
**团队规模：** 2 人\
**首发平台：** Windows 10/11\
**项目形态：** 开源、本地优先，AGPL 兼容发行

---

## 1. 文档目的

本文档定义 Agent Music Workstation P0 的用户可见能力、状态语义、权限边界和验收标准。具体进程、模块、Git/worktree、MCP Transport、ABC Parser、openDAW Runtime Adapter 等实现由架构文档定义，但不得改变本 PRD 的产品行为。

### 1.1 优先级

- **P0：** Windows 首发必须交付并通过验收。
- **P1：** P0 稳定后实现，不阻塞首发。
- **P2：** 后续能力，不为其提前引入 P0 状态复杂度。

### 1.2 本版相对 V1.7 的主要调整

- 冻结 P0 Velocity：支持每事件 `1..127`；`0` 在 Standard MIDI 中表示 Note Off，因此不得作为 Note onset Velocity。一个 Chord 内所有 pitch 共享 Velocity，Tie chain 只在起音处设置。
- 补齐 Agent 修改全局拍号的正式能力：仅允许覆盖全部六轨的 `wholeProject` Task，并使用专用 `updateGlobalMeter` 工具。
- P0 MCP Tool 由 6 个增为 7 个；轨道片段替换与全局拍号修改保持不同的授权和写入接口。

### 1.3 V1.6 的工作区调整

- P0 产品工作区改为自研 React UI，不 fork、内嵌或直接复用 openDAW Studio UI。
- openDAW 仅作为 SDK/Core Runtime，负责播放、音频图、运行时工程对象、Solo/Mute 和离线渲染。
- 六轨时间轴、Clip 展示、Transport 控件、Loop、Playhead 与连续 Scope 由产品 Renderer 实现。
- P0 UI 不直接修改 openDAW BoxGraph；`composition.abc` 仍是唯一编曲事实来源。
- P2 手动编辑默认采用自研 React 编辑器，经 Music Core 领域编辑命令更新 Canonical ABC，再重建 openDAW Runtime。
- 是否接入 openDAW Studio UI 不作为 P2 默认路线；只有产品范围转为完整 DAW 时才重新立项评估。

---

## 2. 产品定义

Agent Music Workstation 是一款本地优先、Agent-first 的桌面音乐创作工作台。

用户通过自然语言描述创作或修改意图，Agent 通过受 MCP 约束的音乐工具创建或修改结构化音乐工程。编曲以 Canonical ABC 为核心事实来源，并派生标准 MIDI、openDAW 运行时状态和音频导出。

用户可以：

- 创建并保存空白工程；
- 让 Agent 创建结构化编曲；
- 在 UI 中选择明确的连续修改范围；
- 使用自然语言描述“如何修改”；
- 试听 Candidate，并在 Current 与 Candidate 间切换；
- 将 Candidate 整体接受为新 Current，或整体拒绝；
- 重新打开最后成功提交的 Current；
- 从 Current 导出 MIDI、ABC，以及技术 Gate 通过后的 WAV。

### 2.1 核心价值

- **结构化工程：** 输出不是不可编辑的端到端音频。
- **范围确定：** UI 选区直接决定实际写入范围。
- **工具强制：** MCP 是 Agent 工程写入和权限边界。
- **Candidate 隔离：** Agent 不直接覆盖 Current。
- **本地版本：** Git 保存全部成功 Current Revision。
- **开放音乐表达：** 不人为限制曲长、调式或主观曲式名称。
- **可迁移输出：** 导出标准 MIDI、ABC 和经过验证的 WAV。

---

## 3. 核心原则

### 3.1 Current 是当前稳定版本

Current 表示当前稳定生效、可播放、可作为 Agent Task Baseline、可以提交到 Git 并恢复的工程版本。

Current 只有两种产生方式：

1. 创建项目时初始化空白 Current；
2. 用户接受 Candidate 后，Candidate 被提交为新的 Current。

空白 Current 是合法工程版本，可以保存、关闭、重新打开，并作为首次生成的 Baseline。

### 3.2 Agent 只写 Candidate

```text
Current
→ 创建或复用唯一 Candidate
→ Agent 写入和验证
→ Candidate Ready
→ Accept：提交为新 Current
→ Reject：删除 Candidate
```

P0 同一项目同时最多存在一个业务 Active Candidate。已结束 Candidate 的 PendingCleanup 或无 marker orphan 仅是基础设施残留，不计为可操作 Candidate。一个 Candidate 可以连续承载多个 Agent Task。

### 3.3 MCP 是唯一 Agent 写入边界

Agent 不能直接编辑工程文件、执行 Git 命令或写入 openDAW 内部对象。所有 Agent 工程修改必须通过 MCP 工具完成。

MCP 负责：

- 校验连接会话、任务和 Candidate 状态；
- 校验 Task Scope 与允许操作；
- 通过 Scope Mapping 定位 Canonical ABC 范围；
- 原子应用 ABC 片段；
- 解析、编译和结构校验；
- 返回结构化错误；
- 驱动 Task 完成验证。

### 3.4 UI 选区就是执行范围

产品只保留一个执行范围概念：`TaskScope`。

- UI 存在正式选区时，该选区转换为实际执行范围；
- UI 没有正式选区时，任务范围为 `wholeProject`；
- 自然语言只表达音乐意图，不负责识别、缩小或扩大范围；
- Agent 不能自行扩大 Scope；
- 同一 Task 中申请扩展 Scope 时，必须由用户确认。

### 3.5 P0 不提供 Section

P0 不提供 Section 数据模型、Section 边界展示、Section 快捷选区或 Section 编辑。

P0 UI 可以提供：

- 整工程选择；
- 单轨或多轨选择；
- 连续小节范围；
- 连续时间范围；
- Loop 范围复用为 Scope。

小节和时间轴选区在任务创建前统一转换为 Tick 范围。

---

## 4. P0 产品范围

### 4.1 平台与窗口

- Windows 10/11 桌面应用；
- 一个窗口同时打开一个项目；
- 同一项目同一时间只运行一个 Agent 写任务；
- 同一项目同一时间只有一个可写应用实例；
- 不开发独立 Web 端；
- macOS 保持架构兼容，但首发不承诺正式支持。

### 4.2 固定六轨

P0 固定六条角色轨道：

1. 鼓；
2. 贝斯；
3. 吉他；
4. 钢琴 / 键盘；
5. 弦乐；
6. 管乐。

规则：

- 六条轨道的稳定 ID、顺序和角色固定；
- 轨道允许为空；
- P0 不提供新增、删除、复制、拆分、合并、排序或角色替换；
- 固定六轨不意味着六轨必须同时发声；
- 底层领域模型仍使用通用 Track 数组，不硬编码为六个字段。

### 4.3 曲长

- 不设置固定曲长枚举；
- 支持 ABC 工具链能够稳定处理的任意正数小节长度；
- `wholeProject` 修改可以延长或缩短整曲；
- 局部连续范围修改不得静默改变 Scope 外时间位置。

### 4.4 拍号、Tempo 与调性

#### 拍号

- P0 支持一个全局拍号；
- 支持 ABC 工具链稳定支持的全局拍号；
- Agent 可以在 `wholeProject` Task 中修改全局拍号；
- `updateGlobalMeter` 只修改工程唯一的 Global Meter，不承担把原音乐自动改编为新拍号；
- Agent 在修改 Global Meter 后，根据用户意图通过音乐修改工具重排 `wholeProject` 内的 Note/Rest 等内容，使最终 Candidate 符合新拍号；
- P0 不支持曲中局部变拍。

#### Tempo

- P0 支持 Tempo Map；
- 支持曲中局部变速；
- Agent 可以新增、删除或修改 Scope 内的 Tempo Event；
- 不设置人为 BPM 上限；
- 只拒绝零、负数、非有限数或底层工具链明确无法处理的值；其中 Standard MIDI Set Tempo 使用 24-bit 微秒/四分音符字段，无法表示的 BPM 必须在生成 Candidate 时明确拒绝，不得静默回绕；
- Tempo 变化不改变 Tick、小节和拍位置，只改变实际播放时间。

#### 调性与调式

- 支持 ABC 工具链能够稳定解析和保存的调性与调式；
- 不限于 major / minor；
- 支持曲中局部调性变化；
- Agent 可以修改 Scope 内的 Key Event；
- 不对每个音符执行“必须属于当前音阶”的机械限制。

### 4.5 跨 Scope 事件

- 音符允许跨越小节边界；
- 局部 Scope 下，与 Scope 边界相交的既有事件默认只读；
- Agent 只能修改修改前后都完整位于 Scope 内的事件；
- P0 不提供跨边界事件自动拆分或 Tie 编辑。

### 4.6 MIDI 表情事件

| 事件类型 | 保存/播放 | Agent 生成或修改 |
|---|---|---|
| Note、Pitch、Duration、Velocity | 支持 | 支持 |
| Tempo Event | 支持 | 支持 |
| 全局 Time Signature | 支持 | 支持 |
| Key Event | 支持 | 支持 |
| Sustain / CC64 | 技术链支持时透明保留 | P0 不承诺 |
| Pitch Bend | 透明保留 | 不支持 |
| Channel / Poly Aftertouch | 透明保留 | 不支持 |
| 其他 MIDI CC | 尽量透明保留 | 不支持 |

“不支持 Agent 修改”不等于读取、播放、保存或导出时删除这些事件。

Velocity 的 P0 行为：

- 支持整数 `1..127`；`0` 表示 MIDI Note Off，不作为 Note onset Velocity；
- 没有显式值时使用 Canonical 默认值 `100`；
- 一个 Note 或 Chord 对应一个 Velocity；Chord 内所有 pitch 共享该值；
- Tie chain 的 Velocity 属于起音，延续 token 不重新设置；
- Velocity 与对应事件作为同一个 Scope 写入单元。

### 4.7 产品 UI 与 openDAW Runtime 边界

P0 产品工作区由 React + TypeScript 自研，包括：

- 固定六轨及其 Track Header；
- Clip 和音乐密度的只读展示；
- 时间轴、小节线、缩放、滚动和 Playhead；
- Transport 控件；
- 播放、暂停、Stop、Seek 和 Loop 交互；
- Solo / Mute 交互；
- Current / Candidate 试听切换；
- 固定轨道集合上的连续时间 Scope。

P0 通过 Adapter 使用 openDAW SDK/Core Runtime，包括：

- openDAW Project、RuntimeSnapshot 和音频图；
- 乐器、播放、Seek、Loop、Solo / Mute 的运行时能力；
- Current / Candidate RuntimeSnapshot 加载；
- 必要的音源和整曲离线渲染。

RuntimeSnapshot 由 openDAW Runtime/Adapter 根据 Music Core 输出的 `PlaybackCompilation`（Standard MIDI Document、总 Tick、固定轨道映射及 Tempo/Meter/Key 元数据）构建、加载与缓存；Music Core 的 Composition Pipeline 不生成 RuntimeSnapshot。Scope Mapping 只负责 Tick 与 Canonical ABC 范围映射，留在 Core，不进入 Snapshot 或 Renderer IPC。

P0 不 fork、内嵌或直接复用 openDAW Studio UI，也不抽取其 Timeline、Piano Roll 或 Mixer UI。产品 UI 不读取或直接修改 openDAW BoxGraph；所有编曲事实和正式编辑仍由 Music Core 基于 Canonical ABC 处理。

P0：

- 不显示 Piano Roll；
- 不提供用户音符、Region 或 Clip 手动编辑；
- 不开放完整 Mixer、音频导入、录音、声卡输入、MIDI 导入和第三方插件；
- openDAW Runtime 状态是可重建派生状态，不成为工程事实。

### 4.8 音色与混音

P0：

- 固定六轨使用首发映射；
- 不向 Agent 开放乐器预设、效果器链、音色宏、Volume 或 Pan 写工具；
- Solo / Mute 是临时试听状态，不进入 Current、Candidate 或导出。

P1：

- 增加 `listSoundOptions`、`updateTrackSound`、`updateTrackMix`；
- 支持 Agent 修改精选乐器预设、效果器链、音色宏、Volume 和 Pan；
- 增加 `sound-config.json` 作为 Git 权威事实文件；
- 正式用户音色和基础混音编辑可与该阶段一并实现。

---

## 5. P0 Scope 模型

### 5.1 Canonical Scope

```ts
type TaskScope =
  | {
      type: "wholeProject";
      trackIds: TrackId[];
    }
  | {
      type: "timeRange";
      trackIds: TrackId[];
      startTick: number;
      endTick: number; // [startTick, endTick)
    };
```

规则：

- 小节、时间轴和 Loop 选区在 UI 层转换为 Canonical Scope；
- 一个 Task 只有一个连续时间区间；
- 可同时覆盖一个或多个固定轨道，但所有轨道共享同一时间区间；
- 不支持多个不连续时间区间；
- Agent 不接触 ABC 字符位置。
- Tempo Map 或 Key Map 修改必须覆盖全部六条固定轨道；若当前 Scope 未覆盖全部六轨，必须先走 Scope 扩展确认。
- Global Meter 修改必须同时满足 `wholeProject` 和覆盖全部六条固定轨道。

### 5.2 无选区任务

没有正式 UI 选区时，Scope 为 `wholeProject`。执行前必须明确提示“修改整个工程”并进行强确认。

### 5.3 Scope 扩展

同一个正式 Task 中允许经用户确认**扩大** Scope，不允许在同一 Task 内缩小、移动或替换 Scope。新 Scope 必须满足 `oldScope ⊆ newScope`；若用户希望修改完全不同的范围，应结束当前 Task 并创建新 Task。

```text
Agent 调用 requestScopeExtension
→ A3 创建唯一 Scope Extension requestId
→ 当前 Task 进入授权等待屏障，所有 Task 写入与 finishTask 暂停
→ 用户确认或拒绝
→ 批准：A3 校验 oldScope ⊆ newScope，更新 TaskContext.scope，scopeRevision + 1
→ 拒绝：Scope 与 scopeRevision 均保持不变
→ Agent 继续同一个 Task
```

约束：

- Agent 只能提出扩展请求，`TaskContext.scope` 与 `scopeRevision` 只能由 A3 修改；
- Pending Scope Extension 期间禁止 `replaceScopedMusic`、`updateGlobalMeter`、`finishTask` 和再次请求扩展；
- 每次扩展请求使用唯一 `requestId`，旧确认事件不得批准新的请求；
- 所有 Task-bound MCP 调用携带 `projectId`、`candidateId`、`baseRevision` 和 `expectedScopeRevision`，A3 必须与当前权威状态逐项核对；
- `taskId` 和 `candidateId` 在整个系统内全局唯一；
- 批准扩展后 `taskId`、`candidateId` 和 Candidate `baseRevision` 均不变。

---

## 6. Canonical ABC 与 Scope Mapping

### 6.1 单一编曲文件

P0 使用一个 `composition.abc`，其中包含六个固定 Voice。

- Canonical ABC 是编曲唯一事实来源；
- MIDI、Scope Mapping 和 openDAW Runtime 均为派生状态；
- P0 不持久化 Note ID、Product Event ID、MIDI Event ID、AST Node ID 或 openDAW Runtime ID。

### 6.2 禁止 Repeat 简写

Canonical ABC 按实际播放顺序保存为完全展开形式，不允许保存会造成“源码片段对应多个播放时间位置”的 Repeat 简写，包括：

- `|: ... :|`；
- 第一、第二结尾；
- 跳转类反复结构；
- 其他导致源码与播放时间一对多的简写。

导入或 Agent 提交包含 Repeat 的内容时，必须先展开并规范化后才能进入 Candidate。

### 6.3 Scope Mapping

P0 必须支持：

```text
UI 连续时间选区
→ Track IDs + Tick Range
→ Canonical ABC 中对应的字符范围
→ MCP 严格限定写入边界
```

Scope Mapping：

- 通过 abcjs 等解析库获得事件时间和源码字符位置；
- 由 Music Core 自身负责 Canonical ABC 展开、规范化和持久化；
- 是可重建缓存，不进入 Git；
- 以 `sourceHash` 和解析器版本校验有效性；
- 缺失、过期或重建失败时，禁止 `replaceScopedMusic`；
- 每次 ABC 修改后重建受影响轨道的 Mapping。

---

## 7. Current、Candidate 与 Git

### 7.1 项目初始化

创建项目时立即：

1. 创建项目目录；
2. 写入空白 `project.json` 和 `composition.abc`；
3. 初始化 Git；
4. 提交 Initial Empty Current Revision。

### 7.2 Candidate 生命周期

正式 Task 只在用户确认后创建。确认前的 `planning` / `awaiting_confirmation` 属于 Agent Workflow，不属于 Candidate Transaction。

```text
Current Only
→ 用户确认 Agent Task
→ 创建 Candidate，或复用已有 Ready Candidate
→ 创建正式 TaskContext
→ Agent Writing
→ finishTask 完整验证
→ Candidate Ready
```

Candidate Ready 后：

- **Accept：** 将 Candidate 最终树提交为一个新的 Current Revision；每次成功 Accept 都产生唯一的新 `main` commit，即使最终内容无变化；
- **Reject：** 强终止整个 Candidate；即使存在活动 Task 也可直接 Reject，Current 始终不变；
- **继续修改：** 在同一个 Ready Candidate 中启动下一个 Task，并以最新 Candidate checkpoint 作为该 Task 的 `taskBaseCheckpoint`；
- **从 Current 重来：** 必须先显式 Reject 现有 Candidate，再创建新 Candidate。

Candidate 的业务生命周期与 branch/worktree 物理清理分离。Accept 或 Reject 已经在业务上成功后，清理失败不得让 Candidate 重新变成可操作状态，也不得阻塞创建新的 Candidate。

### 7.3 Task 与 checkpoint

一个 Candidate 可以包含多个连续 Task，但 A3 运行时最多只保留一个 Active Task。已完成或已取消 Task 的执行授权立即销毁，历史记录由执行日志/持久化层保存。

每个 Task：

```text
记录 taskBaseCheckpoint
→ 多次 MCP 写入
→ 单次写入失败只回滚该次调用
→ finishTask 完整验证
→ 成功后创建一个唯一 Candidate checkpoint commit
```

- 每个成功 Task 都产生唯一 checkpoint；即使没有内容变化，也允许 empty checkpoint commit；
- Task 内成功写入在 `finishTask` 前可以保持未提交；
- `finishTask` 必须同时通过 A3 事务校验与 A2 最终音乐校验；验证失败不提交，并保留当前修改供 Agent 修复；
- Candidate checkpoint 只提交 `composition.abc`；`project.json` 必须与 Candidate `baseRevision` 完全一致；
- Candidate worktree 若出现除预期 `composition.abc` 变化之外的 tracked/untracked 非忽略变化，`finishTask` fail-closed；
- 用户取消 Task 时先使 Task 授权失效，再整体回滚到 `taskBaseCheckpoint`；若 Candidate 此前已有成功 checkpoint，则恢复到上一个 Ready；若取消的是首个 Task且 Candidate 从未产生成功 checkpoint，则同时结束该空 Candidate；
- Reject 比 Cancel 更强：Reject 放弃整个 Candidate，而 Cancel 只撤销当前 Task；
- Accept 时 Candidate 内部 checkpoint 被 squash 为一个新的 Current Revision。

### 7.4 恢复

P0 必须保证：

- 最后一次成功提交的 Current 可以重新打开；
- 恢复失败时不覆盖最后有效 Revision。

P0 不保证：

- 恢复运行中的 Agent Task；
- 恢复未接受 Candidate；
- 恢复未提交 Task 状态；
- 恢复播放位置和 UI 状态。

启动时可以安全清理残留 Candidate worktree。

### 7.5 Current 工作区干净规则

- Current 工作区必须保持 Git clean；
- Candidate 创建时记录其来源 Current Revision 为 `Candidate.baseRevision`，整个 Candidate 生命周期内保持不变；
- 任何继续使用 Candidate 的操作都必须确认 Current clean 且 `main HEAD == Candidate.baseRevision`；
- 若基线漂移，Candidate 立即进入 `stale`，活动 Task 授权失效，只允许 Reject；
- Current 出现未提交修改时停止 Candidate 使用并提示恢复最后有效 Current；
- P0 不支持采用、合并、rebase 或导入外部 Current 修改；
- Candidate Task 内允许 `composition.abc` 存在合法未提交修改，但 `project.json` 与其他非忽略文件不得产生业务变化。

---

## 8. Agent 工作流

### 8.1 首次生成

```text
空白 Current
→ 用户输入创作要求
→ Agent 提交工程计划
→ 用户强确认
→ 创建 Candidate 与 TaskContext
→ Agent 通过 MCP 写入
→ finishTask 验证与有限修复
→ Candidate Ready 或安全失败
```

### 8.2 普通局部修改

```text
用户形成 UI Scope
→ 输入音乐修改意图
→ 显示轻量内联摘要
→ 一键确认
→ Agent 通过 MCP 修改 Candidate
→ finishTask 验证
→ Candidate Ready
```

### 8.3 强确认场景

以下操作必须强确认：

- 首次生成工程计划；
- `wholeProject` 修改；
- 全局拍号变化；
- Tempo Map 变化；
- Key Map 或调式变化；
- Scope 扩展；
- 接受 Candidate 并更新 Current；
- 会影响当前选区之外音乐位置或播放时长的操作。

普通局部音符、节奏、Velocity 或和声内容修改使用轻量确认。

### 8.4 自动修复

- 自动修复次数必须为有限非负整数；
- 具体数值由用户级配置决定，PRD 不规定默认值；
- 正式 Task 创建时将当前值冻结到 A4 `AgentExecutionContext`，不写入 A3 `TaskContext`；
- 运行中的 Task 不受后续配置修改影响；
- 禁止无限循环。

---

## 9. P0 MCP Tool List

P0 向 Agent 暴露 7 个高层工具：

1. `getTaskContext`：读取当前项目、Candidate、Task Scope、能力和状态；
2. `getScopedComposition`：读取 Scope 内 Canonical ABC 和必要的只读上下文；
3. `submitGenerationPlan`：首次生成前提交工程计划；
4. `requestScopeExtension`：申请扩大当前 Task Scope；
5. `replaceScopedMusic`：提交 Scope 内 ABC 片段，由 Music Core 定位并原子替换；
6. `updateGlobalMeter`：在覆盖全部六轨的 `wholeProject` Task 中修改唯一 Global Meter；该工具是底层工程事实修改能力，不自动重排音乐内容；
7. `finishTask`：执行完整验证，成功后创建一个 Task checkpoint。

Agent 不获得以下工具：

- Accept / Reject Candidate；
- 播放、暂停和 Current/Candidate 切换；
- 轨道增删、复制、排序或角色替换；
- P0 音色、效果器和混音写入；
- 文件、Git 或 openDAW 底层对象访问。

`replaceScopedMusic` 直接接收 ABC 片段。结构化 MusicPatch 仅作为 Music Core 内部事务表示，不要求 Agent 构造第二套编曲格式。

除 bootstrap `getTaskContext({ taskId })` 与 Task 创建前的 `submitGenerationPlan` 外，所有 Task-bound MCP 读写调用统一携带 execution envelope：`taskId`、`projectId`、`candidateId`、`baseRevision`、`expectedScopeRevision`。这些字段不是 Agent 的授权声明，而是 A3 用于逐项比对权威 Task/Candidate 状态的迟到结果保护。允许操作不单独持久化，由 A3 根据当前 Scope 与 P0 capability 实时推导。

---

## 10. 工作区与试听

P0 主要视图由自研 React Renderer 实现，不加载 openDAW Studio UI：

- 六条固定轨道；
- Clip 与时间轴；
- 小节和时间刻度；
- 播放头；
- Current / Candidate 状态；
- UI Scope；
- Agent 对话与活动摘要；
- Accept / Reject；
- Play、Pause、Seek、Loop、Solo、Mute。

P0 不显示：

- Section；
- Piano Roll；
- 音符直接编辑；
- 动态轨道管理；
- MIDI/音频导入；
- 录音；
- 第三方插件；
- 完整 Mixer；
- 完整工具调用面板；
- Git 分支图。

### 10.1 Current / Candidate 试听

- 内存中分别缓存 Current RuntimeSnapshot 和 Candidate RuntimeSnapshot；
- 同时只运行一个 openDAW 播放 Runtime；
- 切换试听目标时先停止 Transport，再加载目标 Snapshot；
- 播放位置按 Tick 尽量保持；
- Candidate 更新时，Music Core 先重建 openDAW 无关的编译结果，再由 openDAW Runtime/Adapter 只重建 Candidate Snapshot。

---

## 11. 项目文件与本地数据

### 11.1 P0 Git 权威文件

```text
project/
├── project.json
├── composition.abc
└── .git/
```

`project.json` 至少包含：

```json
{
  "formatVersion": 1,
  "projectId": "uuid",
  "timebase": {
    "ppq": 960
  },
  "tracks": [
    "track.drums",
    "track.bass",
    "track.guitar",
    "track.keys",
    "track.strings",
    "track.winds"
  ]
}
```

- Git `main` HEAD 是唯一 Current 指针；
- `project.json` 不保存 Current SHA 或 Candidate 信息；
- P0 删除 `metadata.json` 和 `composition.map.json`；
- P1 音色与混音上线后增加 `sound-config.json`。

### 11.2 派生数据与 UI 状态

以下不进入 Git：

- Scope Mapping；
- MIDI 缓存；
- openDAW Runtime；
- 音频渲染缓存；
- 播放位置、Loop、缩放和面板状态；
- 对话、Task、Tool Call 和验证记录；
- API Key；
- Candidate worktree。

### 11.3 应用级 SQLite

```text
AppData/AgentMusic/app.db
```

保存：

- 项目索引；
- 当前对话及消息；
- Agent Task；
- Tool Call；
- 验证结果和修复次数；
- 非敏感模型配置索引。

这些数据不是音乐工程事实，丢失后不影响 Current 恢复、播放和导出。

### 11.4 全局模型配置

模型配置保存在用户级 JSON：

```text
Windows: %USERPROFILE%\.agent-music\settings.json
macOS/Linux: ~/.agent-music/settings.json
```

包含：

- OpenAI-compatible Endpoint；
- API Key；
- 模型名称；
- Chat Completions 参数；
- `maxRepairAttempts` 等 Agent 参数。

约束：

- 文件仅允许当前操作系统用户读取；
- API Key 不进入项目、Git、SQLite 或日志；
- UI 默认遮盖 Key；
- 配置写入使用临时文件和原子替换。

---

## 12. 模型协议

P0 只支持一套明确协议：

```text
OpenAI-compatible Chat Completions
POST /v1/chat/completions
```

Provider Adapter 统一处理：

- `messages`；
- `tools`；
- `tool_choice`；
- 流式输出；
- Tool Call 参数；
- 取消、超时和错误映射。

P0 不同时兼容 Responses API。

---

## 13. 保存、打开、复制与导出

### 13.1 保存与打开

- 创建项目时即建立 Git 仓库和空白 Current；
- Candidate Accept 后产生新 Current Revision；
- Reject 不产生新 Current；
- 重新打开时只恢复 `main` HEAD 对应的最后 Current；
- MIDI、Scope Mapping 和 openDAW Runtime 重新生成。

### 13.2 另存为

P0 “另存为”流程：

- 只复制原项目当前 Current 的权威文件；
- 生成新的 `projectId`；
- 初始化新的 Git 仓库；
- 提交新的 Initial Current Revision；
- 不保留原 Git 历史、Candidate、对话或 Task 记录。

### 13.3 导出

P0 只允许从 Current 导出：

- 标准多轨 MIDI；
- Canonical ABC；
- 整曲 WAV，前提是技术 Gate 通过。

Candidate 不允许正式导出。

标准 MIDI 至少保留：

- 六条角色轨；
- Track 顺序；
- Tempo Map；
- 全局 Time Signature；
- Key Signature 可表达部分；
- Note Start、Duration、Pitch、Velocity；
- 工程完整长度和尾部休止。

---

## 14. P1 与 P2

### 14.1 P1

- Agent 音色、效果器和基础混音工具；
- `sound-config.json`；
- 用户正式音色、Volume 和 Pan 编辑；
- 整曲 Stems 导出；
- 最近项目列表；
- 已完整验证 Candidate 的异常恢复；
- 简化版本恢复入口；
- macOS 验证；
- 乐谱导出。

### 14.2 P2

- 多 Candidate 与 A/B/C 对比；
- 完整工具调用和调试面板；
- 自研 React Piano Roll / Clip Editor；用户编辑转换为 Music Core 领域编辑命令，更新 Canonical ABC 后重建 RuntimeSnapshot；
- 只有产品范围转为完整 DAW 且独立评估通过时，才考虑接入 openDAW Studio UI；
- 持久范围书签或 Section 类 UI 组织能力；
- 全局和跨项目 Agent Memory；
- 动态轨道管理；
- 曲中局部变拍；
- Pitch Bend、Aftertouch 和任意 MIDI CC 的 Agent 编辑；
- 音频和 MIDI 导入；
- 录音和 MIDI 键盘；
- VST / VST3 / AU；
- 多 Agent；
- 云同步与在线协作；
- 多窗口或单窗口多项目；
- 复杂版本管理 UI。

---

## 15. 错误与安全行为

错误必须说明：

1. 发生了什么；
2. Current 是否安全；
3. Candidate 是否仍然可用；
4. 用户下一步可以做什么。

固定规则：

- 普通 Candidate mutation 同时只能执行一个；若已有 mutation 执行中，新 mutation 立即返回稳定领域错误 `TASK_BUSY`，不在 A3 内排队；
- Cancel / Reject 是高优先级强终止控制，不受 `TASK_BUSY` 限制；它们先使授权失效，正在执行的 mutation 在最终落盘前必须重新检查授权，失效结果不得写入 Candidate；
- 单次写入失败只撤销该次调用；
- `finishTask` 失败保留 Task 修改并允许 A4 Agent Workflow 决定是否继续有限修复；
- 取消后 Task 授权失效；Reject 后 Candidate 授权失效；
- 迟到结果不得生效；所有 Task-bound 调用必须匹配 task、project、candidate、Candidate `baseRevision` 和 `expectedScopeRevision`；
- Candidate baseline 漂移后进入 `stale`，只能 Reject；
- Accept 的事务成功点是新的 `main` commit 成功：commit 前失败必须保持旧 Current 并保留 Candidate；commit 成功后即视为 Accept 成功，后续 branch/worktree 清理失败不得回滚 Current；
- Reject 的业务成功点是 Candidate 授权失效并结束业务生命周期，物理清理失败不得恢复 Candidate；
- Accept/Reject 的残留资源进入待清理状态，不阻塞新的 Active Candidate；
- Git Current 不得被损坏结果覆盖；无法恢复时只打开最后有效 Current；
- 对外只返回稳定 A3 领域错误码与结构化 details，不直接透传 Git、文件系统或 parser 原始异常文本。

---

## 16. 技术 Gate

第 1–2 天必须验证：

1. Canonical ABC 完全展开、解析、规范化和保存；
2. 六个固定 Voice 到 MIDI/openDAW 的稳定映射；
3. UI Tick Scope 到 ABC 字符范围的 Scope Mapping；
4. MCP 是否能通过映射机械限制 ABC 写入范围；
5. 跨 Scope 持续事件只读规则；
6. Tempo Map 在 ABC、MIDI、openDAW 播放和重开中的保留；
7. 全局拍号和局部 Key Event；
8. 固定 PPQ=960 下 ABC 时值精确映射；
9. Windows Git/worktree、Task checkpoint、Accept/Reject 和异常清理；
10. 最后 Current 的可靠恢复；
11. Chat Completions 的工具调用、流式、取消和超时；
12. MIDI 导出核心数据；
13. openDAW 整曲 WAV 离线渲染。

Gate 失败时必须以可复现证据调整技术方案；WAV Gate 失败时可明确降为 P1。

---

## 17. P0 发布验收标准

P0 发布必须满足：

1. Windows 应用可启动；
2. 可以创建 Git 项目和空白 Current；
3. 空白 Current 可以关闭并重新打开；
4. 六轨 ID、顺序和角色稳定；
5. 可以生成非固定曲长工程；
6. P0 不存在 Section；
7. UI Scope 统一转换为 `wholeProject` 或连续 Tick 范围；
8. 无选区时使用 `wholeProject` 并强确认；
9. 多个不连续时间范围被阻止；
10. Agent 不能直接写 Current 或项目文件；
11. 同一项目最多一个 Candidate；
12. 一个 Candidate 可以连续承载多个 Task；
13. Candidate 可以播放并与 Current 切换试听；
14. Candidate 只能整体 Accept 或 Reject；
15. 一个成功 Task 形成一个内部 checkpoint；
16. Accept 后形成一个新的 Current Revision；
17. Reject 后 Current 不变；
18. 最后 Current 可以恢复；
19. Current 工作区必须保持 Git clean；
20. Candidate Task 内允许未提交修改；
21. Scope Mapping 可以重建并限制 ABC 写入；
22. Canonical ABC 不含 Repeat 简写；
23. 合法跨边界持续音不会被误改；
24. Tempo Map 可以播放和导出；
25. 每事件 Velocity `1..127` 可以生成、局部修改、播放和导出；Velocity `0` 必须在进入 Candidate 前被拒绝；
26. Agent 可以通过专用工具修改 Global Meter，并在同一 `wholeProject` Task 中重排音乐，使最终 Candidate 符合新拍号并可导出；
27. P0 不支持局部变拍；
28. 支持工具链验证通过的调式和局部 Key Event；
29. P0 使用自研 React 时间轴与 Transport，不加载 openDAW Studio UI，Piano Roll 不显示；
30. P0 Agent 不具有音色与混音写权限；
31. 自动修复次数可配置且必须有限；
32. API Key 不进入项目、Git、SQLite 或日志；
33. MIDI 和 ABC 只能从 Current 导出；
34. Candidate 不能导出；
35. WAV 在 Gate 通过后从 Current 导出；
36. “另存为”生成新项目且不保留原 Git 历史。

---

## 18. 已冻结产品决策

1. Current 是当前稳定生效版本，不要求经过用户接受。
2. 创建项目时立即创建 Git 仓库和空白 Current Revision。
3. Agent 永远只写 Candidate。
4. P0 同一项目最多一个业务 Active Candidate；PendingCleanup/orphan 资源不属于可操作 Candidate。
5. 一个 Candidate 可以连续承载多个 Task，但同时最多一个 Active Task。
6. Candidate 可以整体 Accept 或强 Reject；Cancel 只撤销当前 Task。
7. 每次成功 Accept 都将 Candidate squash 为一个唯一的新 Current Revision，包括无内容变化的 Candidate。
8. Git 保留所有成功 Current Revision。
9. 只保证恢复最后成功 Current。
10. MCP 是唯一 Agent 工程写入边界。
11. UI Scope 统一为 `wholeProject` 或固定轨道集合上的连续 Tick 范围。
12. 自然语言不计算 Scope。
13. 同一 Task 的 Scope 只能经用户批准扩大，必须满足 `oldScope ⊆ newScope`；Pending 扩展期间写入暂停，批准后 `scopeRevision + 1`。
14. P0 不支持多个不连续时间范围。
15. P0 固定六轨，不实现动态轨道管理。
16. P0 不提供 Section。
17. 不限制固定曲长。
18. P0 支持一个全局拍号，不支持曲中局部变拍。
19. P0 支持 Tempo Map 和局部 Key Event。
20. Canonical ABC 是唯一编曲事实来源。
21. Canonical ABC 保存为完全展开形式，不含 Repeat 简写。
22. P0 实现 Scope Mapping，但 Mapping 是缓存，不进入 Git。
23. P0 不持久化 Note、MIDI、AST 或 openDAW Runtime ID。
24. P0 使用单一 `composition.abc` 和六个固定 Voice。
25. P0 项目 Git 权威文件只有 `project.json` 与 `composition.abc`。
26. P1 增加 `sound-config.json` 和 Agent 音色/混音工具。
27. P0 每个成功 Task 形成唯一 Candidate checkpoint，即使无内容变化也允许 empty commit。
28. `finishTask` 失败保留修改；有限修复策略属于 A4 Agent Workflow。
29. Current 必须 Git clean；Candidate 只允许 `composition.abc` 出现预期 Task 修改，其他非忽略变化 fail-closed。
30. Git `main` HEAD 是唯一 Current 指针。
31. P0 使用固定 PPQ Tick，项目标准 PPQ 为 960，不静默量化。
32. Current 与 Candidate 各缓存一份 RuntimeSnapshot，但只运行一个 openDAW Runtime。
33. P0 产品时间轴、Clip 展示、Transport 和连续 Scope 使用自研 React UI，不 fork 或内嵌 openDAW Studio UI。
34. 产品 UI 只能通过 OpenDawRuntimeAdapter 控制派生 Runtime，不直接修改 openDAW BoxGraph。
35. P2 手动编辑默认使用自研 React 编辑器，经 Music Core 更新 Canonical ABC 后重建 Runtime；接入 openDAW Studio UI 需要新的架构决策。
36. P0 使用 OpenAI-compatible Chat Completions。
37. 模型配置与 API Key 保存在用户级 `settings.json`。
38. 对话和 Task 记录保存在应用级 SQLite，不是工程事实。
39. “另存为”不保留原 Git 历史。
40. P0 Velocity 使用每 Note/Chord 的 `1..127` 整数；`0` 保留为 MIDI Note Off 语义；Chord 内共享，Tie chain 只在起音处设置。
41. Global Meter 使用专用写工具修改，必须由覆盖全部六轨的 `wholeProject` Task 授权；该工具只改变底层全局拍号事实，不自动进行音乐性重排，重排由 Agent 使用音乐修改工具完成。
42. 正式 Task / A3 TaskContext 只在用户确认后创建；planning、awaiting_confirmation 和 repairing 属于 A4 Agent Workflow。
43. Candidate 创建时冻结 `baseRevision`；每个 Task 单独记录 `taskBaseCheckpoint`，两者含义不得混用。
44. Candidate baseline 漂移后进入 `stale`，活动 Task 授权失效，只允许 Reject。
45. `taskId` 与 `candidateId` 全局唯一；除 bootstrap 外，Task-bound MCP 调用统一携带完整 execution envelope。
46. Accept 的业务成功点是新 `main` commit 成功；Reject 的业务成功点是 Candidate 授权失效。两者物理 cleanup 均不反向改变业务结果。
47. 普通 Candidate mutation 不排队；busy 时返回 `TASK_BUSY`。Cancel / Reject 可以使正在运行的 mutation 授权失效。
48. A3 `TaskContext` 只保存事务与授权状态；用户意图、模型配置和有限修复状态属于 A4 `AgentExecutionContext`。
49. Scope 决定允许修改的范围，并由 A3 确定性推导当前 P0 `allowedOperations`；不持久化第二份权限状态。
