# Agent Music Workstation Technical Spikes

本文档记录会影响架构决策或 P0 可行性的技术验证。Spike 代码和大体积证据保存在仓库外的临时工作区，不进入产品源码。

---

## Spike-001：openDAW Electron Runtime 与 P0 播放链

- **日期**：2026-07-30
- **状态**：PASS
- **对应架构 Gate**：TG-003 PARTIAL PASS（由 Spike-002 补齐为 PASS）；TG-010 PARTIAL PASS（由 Spike-004 补齐为 PASS）；openDAW Runtime 集成独立结论为 PASS（架构文档暂未单独编号）
- **验证代码**：`/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw`
- **上游版本**：`@opendaw/studio-sdk@0.0.163`
- **Electron**：`40.10.6`
- **Chromium**：`144.0.7559.236`
- **Node.js**：`24.18.1`
- **环境**：Linux 2C2G，Xvfb；不使用完整虚拟桌面，不生成安装包

### Gate 覆盖边界

| Gate | 状态 | 本 Spike 覆盖 | 尚未覆盖 |
|---|---|---|---|
| openDAW Runtime 集成（未编号） | PASS | Electron BrowserWindow、WASM、AudioWorklet、Worker、固定六轨 RuntimeSnapshot、Transport、SoundFont、本地资源和构建 | Windows 安装包与实机音频设备属于交付测试，不属于本 Spike |
| TG-003 | PARTIAL PASS | Standard MIDI Document → openDAW；六轨、Tempo、Meter、Key 元数据和事件长度 | Canonical ABC → Standard MIDI Document |
| TG-010 | PARTIAL PASS | openDAW 离线渲染、有效非静音 WAV | 进度、取消、尾音策略和原子输出 |

### 1. 要回答的问题

验证下列 P0 架构链路是否可以成立：

```text
内部 Standard MIDI Document
→ 固定六轨 openDAW Project / RuntimeSnapshot
→ Electron Renderer 中的 openDAW WASM Runtime
→ Transport
→ 实际音频输出 / WAV
```

本 Spike 不验证用户导入任意 `.mid` 文件。P0 的输入是 Music Core 生成的内部标准化 MIDI 文档或等价中间产物。

### 2. 验收目标

| ID | 目标 | 通过标准 |
|---|---|---|
| OD-01 | Electron 开发态集成 | 真实 `BrowserWindow` 可加载 Vite Renderer；Worker、AudioWorklet、WASM Engine 启动 |
| OD-02 | 固定六轨映射 | 六个固定 Track ID 按规定顺序分别映射为独立 AudioUnit、Track、Region 和 NoteEvent |
| OD-03 | 音乐事件保持 | RuntimeSnapshot 序列化并重新加载后，start、duration、pitch、velocity 不变 |
| OD-04 | 全局音乐属性 | BPM 和 Meter 进入 openDAW；Key 可由 RuntimeSnapshot 保留，不丢失 |
| OD-05 | Transport | Seek、Play、Stop 可由自定义 UI/Adapter 控制 |
| OD-06 | 实际音频产出 | openDAW 离线引擎生成可解码、非静音 WAV；六条轨道均有独立非静音证据 |
| OD-07 | 本地资源 | 工程、WASM、Worker、AudioWorklet、Sample、SoundFont 均可本地加载 |
| OD-08 | SoundFont 可用性 | 官方 `.odb` 中三个 SoundFont loader 全部进入 `loaded`，无构造或 Worklet 加载错误 |
| OD-09 | 构建可行性 | TypeScript 检查与 Vite production build 通过 |

### 3. 验证夹具

内部 `StandardMidiDocument` 使用：

- PPQ：960
- BPM：120
- Meter：4/4
- Key：C major
- 固定轨道顺序：
  1. `track.drums`
  2. `track.bass`
  3. `track.guitar`
  4. `track.keys`
  5. `track.strings`
  6. `track.winds`

每轨包含一个独立 NoteEvent。六个事件被安排在连续、互不重叠的时间窗中，以便从最终 Master WAV 机械判断每一条轨道是否实际发声。

Spike 使用 openDAW 内置 `Vaporisateur` 合成器作为测试音源，目的是隔离并验证数据映射与音频引擎，不代表 P0 最终音色配置。

### 4. 验证结果

| 验证项 | 结果 | 证据摘要 |
|---|---|---|
| Electron `BrowserWindow` + Vite | PASS | `crossOriginIsolated=true`；Renderer 使用 `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true` |
| Worker / AudioWorklet / WASM Engine | PASS | WASM Engine `ready=true`；48 kHz AudioContext 启动 |
| 六轨对象映射 | PASS | 每个 Track ID 均生成独立 AudioUnit UUID、Track UUID、Region UUID、Event UUID |
| RuntimeSnapshot 往返 | PASS | openDAW graph 序列化为 10,580 bytes；重新加载成功 |
| 事件数据往返 | PASS | 六个事件的 start、duration、pitch、velocity 逐字段一致 |
| Tempo | PASS | 120 BPM 进入并从 Runtime 读回 |
| Meter | PASS | 4/4 进入并从 Timeline 读回 |
| Key | PASS，需按下述边界实现 | C major 保存在 RuntimeSnapshot 的音乐元数据中；openDAW 播放引擎没有需要消费的 Key 字段 |
| Seek | PASS | 暂停态跳转到 `003.1.1:000` |
| Play | PASS | `playing=yes`，位置从第三小节继续推进 |
| Stop | PASS | `playing=no`，位置复位到 `001.1.1:000` |
| 离线 WAV | PASS | RIFF/WAVE、IEEE Float、48 kHz、双声道、32-bit、3.1593 秒 |
| Master 非静音 | PASS | Peak `0.343383`；RMS `0.096290`；非静音样本比例 `79.06%` |
| 六轨分别发声 | PASS | 六个轨道时间窗 Peak `0.245–0.279`，RMS `0.0979–0.1088`，全部通过 |
| SoundFont | PASS | 官方 `OpenUp.odb` 中 3/3 SoundFont loader 进入 `loaded` |
| Sample | PASS | 官方 `.odb` 中 17 个 Sample 可本地读取并生成 peaks |
| TypeScript | PASS | 自有代码 `tsc --noEmit` 通过；对上游声明启用 `skipLibCheck` |
| Vite production build | PASS | WASM Engine 及设备 WASM、Worker、AudioWorklet 均进入构建产物 |

### 5. WAV 独立复核

生成文件：

```text
/workspace/tmp/opendaw-runtime-validation/evidence/six-track-render.wav
```

除 Renderer 内部统计外，另用不依赖 openDAW 的 Python RIFF 解析器重新读取落盘文件：

```json
{
  "formatTag": 3,
  "sampleRate": 48000,
  "channels": 2,
  "bitsPerSample": 32,
  "frames": 151648,
  "durationSeconds": 3.1593333333333335,
  "peak": 0.3433831036090851,
  "rms": 0.09628990448329038,
  "nonSilentRatio": 0.7906137898290778,
  "pass": true
}
```

该结果证明 openDAW 实际生成了可解码的非静音音频，而不是仅更新 Transport 状态。服务器无人工扬声器听音条件；人工听感不属于本技术 Gate。

### 6. SoundFont 问题与修复

#### 6.1 发现的问题

openDAW 会执行：

```ts
import("soundfont2").then(({SoundFont2}) => SoundFont2)
```

但 `soundfont2@0.5.0` 发布的是旧式 UMD 产物。在 Vite/浏览器环境中，它可能：

- 出现在 `default.SoundFont2`；或
- 将模块对象写入 `window.SoundFont2`；
- 不提供 openDAW 期望的 ESM 命名导出。

原始结果为：

```text
TypeError: SoundFont2 is not a constructor
```

#### 6.2 验证后的处理方式

在 Vite 层对精确模块 ID `soundfont2` 提供薄 ESM shim，统一导出：

```ts
export const SoundFont2 = resolvedConstructor
```

不修改 openDAW 或 `soundfont2` 的上游源码。修复后官方 `.odb` 中三个 SoundFont loader 全部进入 `loaded`，没有主线程或 Worklet SoundFont 错误。

#### 6.3 产品约束

- P0 必须固定 openDAW SDK 与相关依赖版本；
- SoundFont shim 属于 Runtime Adapter/构建配置，不应散落在业务代码；
- SDK 升级必须重新运行本 Spike 的 SoundFont contract test；
- 不应假设 openDAW SDK 的次版本 API 完全兼容。`0.0.157 → 0.0.163` 已出现 `WasmEngine.isEnabled()` 被删除的变化。

### 7. 架构结论

保留以下方案：

```text
Electron Renderer
→ 自定义工作区 UI
→ OpenDawRuntimeAdapter
→ openDAW headless SDK / WASM Runtime
```

不需要嵌入完整 openDAW Studio UI，也不需要修改 openDAW Audio Engine。

`RuntimeSnapshot` 不应只等同于 openDAW 的二进制 Project。建议逻辑结构为：

```ts
interface RuntimeSnapshot {
  openDawProject: ArrayBuffer;
  trackMapping: FixedTrackMapping[];
  musicalMetadata: {
    tempoMap: TempoEvent[];
    meterMap: MeterEvent[];
    keyMap: KeyEvent[];
  };
}
```

其中：

- Tempo 和 Meter 写入 openDAW Timeline；
- Key 是 Music Core 的音乐语义元数据，不影响 openDAW 的 MIDI/音频播放，可保存在 Snapshot wrapper 中；
- 固定产品 Track ID 不依赖 openDAW 随机 UUID，必须通过 `trackMapping` 显式绑定；
- 产品业务层不得直接依赖 openDAW BoxGraph、UUID 或 Worklet 对象。

### 8. 最终判定

**openDAW Runtime 集成：PASS。TG-003 的剩余范围由 Spike-002 补齐；TG-010 的剩余范围由 Spike-004 补齐。**

已证明：

```text
固定六轨中间产物
→ openDAW Project / RuntimeSnapshot
→ Electron WASM Runtime
→ Seek / Play / Stop
→ 六轨实际发声
→ 非静音 WAV
```

因此该项不再阻塞 P0 主体开发。

### 9. 明确不属于本 Spike 的范围

下列项目不是本次架构可行性结论的一部分，应在对应交付阶段测试：

- Windows 安装包与资源路径；
- Windows 实机音频设备、驱动和扬声器；
- 最终六轨音色、效果器与混音参数；
- Current/Candidate 切换与 Runtime 生命周期压力测试；
- WAV 导出取消、进度、尾音策略和原子写入的完整产品行为；
- 用户导入任意 MIDI 或音频文件。

### 10. 证据索引

```text
/workspace/tmp/opendaw-runtime-validation/evidence/six-track-validation.json
/workspace/tmp/opendaw-runtime-validation/evidence/six-track-render.wav
/workspace/tmp/opendaw-runtime-validation/evidence/wav-independent-check.json
/workspace/tmp/opendaw-runtime-validation/evidence/soundfont-validation.json
/workspace/tmp/opendaw-runtime-validation/evidence/six-track-electron-window.png
/workspace/tmp/opendaw-runtime-validation/evidence/soundfont-electron-window.png
/workspace/tmp/opendaw-runtime-validation/evidence/typecheck.log
/workspace/tmp/opendaw-runtime-validation/evidence/build-final.log
```


---

## Spike-002：TG-001～TG-003 Canonical ABC、Scope Mapping 与完整播放数据链

- **日期**：2026-07-30
- **状态**：PASS
- **对应架构 Gate**：TG-001 PASS；TG-002 PASS；TG-003 PASS
- **复用工作区**：`/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw`
- **ABC Parser**：`abcjs@6.6.4`
- **Standard MIDI 编解码**：`midi-file@1.2.4`；另用独立 Python SMF 解析器复核落盘文件
- **openDAW**：`@opendaw/studio-sdk@0.0.163`
- **Electron**：`40.10.6`
- **Chromium**：`144.0.7559.236`
- **项目 PPQ**：960
- **环境**：Linux 2C2G，Xvfb，`crossOriginIsolated=true`

### 1. 验证范围

本 Spike 验证以下连续链路：

```text
非 Canonical ABC（含 Repeat / First-Second Ending）
→ played-order Canonical ABC
→ Tick / ABC Span Scope Mapping
→ Standard MIDI File Format 1
→ 独立 SMF 解析回读
→ openDAW Project / RuntimeSnapshot
→ 事件、Tempo、Meter 与 Key 元数据回读
→ openDAW 离线音频渲染
```

固定 Voice 与 Track 顺序为：

| Voice | Track ID |
|---|---|
| `drums` | `track.drums` |
| `bass` | `track.bass` |
| `guitar` | `track.guitar` |
| `keys` | `track.keys` |
| `strings` | `track.strings` |
| `winds` | `track.winds` |

### 2. Gate 结论

| Gate | 结果 | 已证明内容 |
|---|---|---|
| TG-001 Canonical ABC | PASS | Repeat 和 First/Second Ending 展开为实际播放顺序；输出无 Repeat 简写；六 Voice 数量与顺序固定；序列化幂等；CRLF/空白归一化；1、7、24、97 小节均保持精确 Tick；无法整除 PPQ 的时值直接拒绝，不静默量化 |
| TG-002 Scope Mapping | PASS | 六轨各 28 个事件生成稳定 Tick/ABC token span；500 组确定性随机 Scope 与独立参考结果一致；半开区间只选择完整落入 Scope 的事件；source hash、parser version、PPQ 任一变化都会使缓存失效 |
| TG-003 ABC → MIDI → openDAW | PASS | Canonical ABC 生成真实 SMF Format 1；六轨共 96 个事件；Tempo、Meter、Key 和事件时长经过 SMF 独立回读；进入 openDAW 后 96 个 NoteEvent、TempoMap、Meter 和 Snapshot wrapper KeyMap 全部往返一致；离线渲染非静音 |

执行断言数量：

```text
TG-001: 28
TG-002: 1181
TG-003: 10
Total: 1219
```

### 3. TG-001：Canonical ABC

#### 3.1 Repeat 展开

验证了两种非 Canonical 输入：

```abc
|: C2 D2 E2 F2 | G2 A2 B2 c2 :|
```

以及：

```abc
|: C2 D2 E2 F2 |1 G2 A2 B2 c2 :|2 c2 B2 A2 G2 |
```

两者均由 `ABCJS.synth.sequence()` 按实际播放顺序展开，然后重新序列化为无 Repeat、无 Ending 标记的显式 ABC。每个 Voice 最终均为 4 小节、16 个四分音符。

Canonical 输出重新解析和序列化后逐字节不变：

```text
canonicalize(canonicalize(source)) === canonicalize(source)
```

#### 3.2 自由曲长与精确 Tick

| 小节数 | 每轨事件数 | 总 Tick |
|---:|---:|---:|
| 1 | 4 | 3,840 |
| 7 | 28 | 26,880 |
| 24 | 96 | 92,160 |
| 97 | 388 | 372,480 |

音乐时值由乐谱时值换算，而不是由音频调度时间换算：

```text
durationTick = ABC whole-note fraction × 4 × PPQ
```

例如 `C/7` 在 `L:1/8` 下得到约 `68.5714 Tick`，验证代码直接拒绝；不会四舍五入为整数 Tick。

#### 3.3 六 Voice 与规范化负例

以下输入均被拒绝：

- 缺失 Voice；
- 重复 Voice；
- Voice 顺序错误；
- 多出第七个 Voice；
- `K:` 与第一个 `V:` 之间存在空行；
- 时值无法精确映射到 PPQ=960。

发现 `abcjs` 会把 `K:` 后的空行视为 tune 结束。因此 Canonical Serializer 必须连续输出：

```abc
K:C
V:drums
```

不能输出：

```abc
K:C

V:drums
```

#### 3.4 `sequence()` 与 `setUpAudio()` 的边界

`setUpAudio()` 中的 `start` 和 `duration` 是经过 Tempo 换算的音频调度时间。例如同一个四分音符：

- 120 BPM：`duration=0.25`；
- 90 BPM：`duration≈0.333333`。

因此 Music Core 不得使用 `setUpAudio()` 的时间字段生成项目 Tick。本 Spike 使用：

- `ABCJS.synth.sequence()`：实际播放顺序和乐谱时值；
- `setUpAudio()`：MIDI pitch、velocity 与 source span 对齐；
- 自有整数换算：乐谱时值 → PPQ Tick。

### 4. TG-002：Scope Mapping

验证夹具为 7 小节、六 Voice、每轨 28 个四分音符。缓存结构包含：

```text
sourceHash = SHA-256(Canonical ABC)
parserVersion = abcjs@6.6.4
ppq = 960
tracks[trackId][] = {startTick, endTick, abcSpans[]}
```

结果：

- 六轨各生成 28 个 Mapping entry；
- 每个 entry 精确选择一个 Canonical ABC note token；
- span 按 source character 递增且不重叠；
- 500 组确定性随机 `[startTick,endTick)` 查询全部与独立事件过滤结果一致；
- 同一输入重复查询得到逐字节相同 JSON；
- source 内容、Parser Version 或 PPQ 变化都会使缓存失效。

跨边界示例：

```text
Scope: [480,2400)
事件: [0,960), [960,1920), [1920,2880)
结果: 只选择 [960,1920)
```

即本 Gate 的最小安全语义是：**只有完全落入 Scope 的事件 token 才进入可写 span**。部分相交事件不进入结果；其只读/报错产品行为仍由 TG-004 定义。

### 5. TG-003：ABC → Standard MIDI → openDAW

#### 5.1 验证夹具

Canonical ABC 为 4 小节，包含：

- PPQ：960；
- Meter：4/4；
- Tempo：tick 0 为 120 BPM，tick 3,840 变为 90 BPM；
- Key：tick 0 为 C major，tick 7,680 变为 G major；
- 六轨，每轨 16 个事件，共 96 个事件；
- 每个事件时长 960 Tick；
- 六轨使用不同音区，以证明轨道映射独立。

局部调性变化后，`keys` 轨第三小节中的普通 `F` 被解析为 MIDI `F#`（pitch 66），证明 Key context 实际作用于音高，而不是只保存文本标签。

#### 5.2 Standard MIDI

生成真实 SMF Format 1 文件：

```text
bytes: 1103
tracks: 7（1 conductor + 6 music tracks）
PPQ: 960
notes: 96
endTick: 15360
```

Conductor Track 包含：

| 类型 | Tick | 值 |
|---|---:|---|
| Tempo | 0 | 500,000 µs/beat = 120 BPM |
| Tempo | 3,840 | 666,667 µs/beat ≈ 90 BPM |
| Meter | 0 | 4/4 |
| Key | 0 | 0 fifths，major = C major |
| Key | 7,680 | +1 fifth，major = G major |

90 BPM 需要以整数微秒写入 SMF，因此回读值为约 `89.999955 BPM`，属于标准 MIDI 整数编码误差，不是 Tick 或 Tempo 丢失。

除 `midi-file` 的 writer/reader 往返外，另用不依赖该库的 Python 标准库解析器读取落盘 `.mid`，再次确认 Header、Track Chunk、VLQ、Tempo、Meter、Key、Track Name、Note On/Off、96 个事件和全部时长。

#### 5.3 openDAW RuntimeSnapshot

SMF 回读形成的 `StandardMidiDocument` 进入 openDAW 后：

```text
openDAW project bytes: 25,592
Snapshot wrapper metadata: 4,739 bytes
Track mapping: 6
NoteEvent mapping: 96
```

序列化并重新 `Project.load()` 后：

- 96 个 NoteEvent 的 `startTick`、`durationTick`、`pitch`、`velocity` 全部一致；
- 六个产品 Track ID 分别绑定独立 openDAW Track UUID 与 Region UUID；
- Meter 从 Timeline 读回为 4/4；
- TempoMap 读回：
  - tick 0、3,839：120 BPM；
  - tick 3,840、15,359：约 90 BPM；
- KeyMap 由 RuntimeSnapshot wrapper 保存并完成 JSON 往返：C major → G major。

KeyMap 不写入 openDAW Project 内部字段，因为 openDAW 播放事件已经包含实际 MIDI pitch，运行时无需再根据调性重算音高；Key 仍是 Music Core 和后续编辑所需的语义元数据。

#### 5.4 实际音频

使用 openDAW 内置 `Vaporisateur` 作为占位音源进行离线渲染：

```json
{
  "sampleRate": 48000,
  "channels": 2,
  "durationSeconds": 10.300666666666666,
  "peak": 1.8356488943099976,
  "rms": 0.2778782857760084,
  "nonSilentRatio": 0.9761949064785451
}
```

该结果只验证完整数据链能够驱动实际音频，不验证最终音色或混音质量。六个占位合成器同时发声导致 Peak 超过 1，也不作为 TG-003 的音质结论。

### 6. 第三方边界与实现约束

#### 6.1 局部 Tempo 与 Key 在多 Voice ABC 中的传播不同

实际验证结果：

- 在第一 Voice 中出现的 `[Q:1/4=90]` 会被 `abcjs` 传播到所有 Voice；
- 在第一 Voice 中出现的 `[K:G]` 只影响该 Voice，不会自动传播到其他 Voice。

本 Spike 的确定性序列化规则为：

- 局部 Tempo 只在第一个 Voice 中输出一次；
- 局部 Key 在六个 Voice 的相同 Tick 各输出一次；
- Music Core 解析后按 Tick/值去重为全局 `TempoMap` 和 `KeyMap`。

后续若设计专用 control voice 或独立 metadata 表示，需要重新运行 TG-001～TG-003，不得假设 `abcjs` 对 Tempo 和 Key 使用相同传播语义。

#### 6.2 openDAW Tempo Event 使用原始 BPM

当前 openDAW `VaryingTempoMap` 和官方 `TempoAutomationPage` 都直接把 `ValueEventBox.value` 解释为 BPM。本 Spike 因此写入原始 `120`、`90`。

同时，当前 SDK 的 DAWproject importer/exporter 中仍存在 normalized BPM 转换代码，与 Runtime 的原始 BPM 语义不一致。Agent Music Workstation P0 不经过 DAWproject 导入导出，因此该问题不阻塞当前链路，但必须：

- 由 `OpenDawRuntimeAdapter` 集中封装 Tempo Event 写入；
- 固定 SDK 版本；
- 保留 raw-BPM contract test；
- 若未来使用 DAWproject，必须单独验证其 Tempo 自动化往返。

#### 6.3 必须复用默认 Tempo Event Collection

`Project.new()` 已创建并连接默认 `ValueEventCollectionBox`。另建一个未连接的 Collection 会在 BoxGraph 事务结束时报错：

```text
Target ValueEventCollectionBox owners requires an edge
```

Runtime Adapter 必须从 `timelineBox.tempoTrack.events.targetVertex` 取得并复用默认 Collection。

### 7. 验证边界

TG-001 和 TG-002 本次使用的可执行语法白名单为单音、单声部事件。它足以验证 Gate 中的 Repeat 展开、Canonicalization、自由曲长、六 Voice、精确 Tick 和 Scope Mapping 机制，但不是最终 ABC 语言实现。

以下语法仍应在正式 Music Core 实现测试中补充：

- rest；
- chord；
- tie；
- accidental 延续；
- 跨小节持续事件；
- 更复杂的 tuplets 与装饰音。

跨 Scope 边界事件的允许/拒绝规则仍属于 TG-004，不由 TG-002 重复定义。

### 8. 证据索引

```text
/workspace/tmp/opendaw-runtime-validation/evidence/tg-001-003-validation.json
/workspace/tmp/opendaw-runtime-validation/evidence/tg-003-standard-midi.mid
/workspace/tmp/opendaw-runtime-validation/evidence/tg-003-midi-independent-check.json
/workspace/tmp/opendaw-runtime-validation/evidence/tg-001-003-electron-window.png
/workspace/tmp/opendaw-runtime-validation/evidence/tg-001-003-typecheck.log
/workspace/tmp/opendaw-runtime-validation/evidence/tg-001-003-build.log
```

验证代码位于仓库外：

```text
/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw/src/abc-validation-core.ts
/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw/src/abc-gates-spike.ts
/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw/electron-abc-gates-validation.mjs
```

---

## Spike-003：openDAW Selection → Canonical ABC 反向映射

- **日期**：2026-07-30
- **状态**：PASS
- **对应架构 Gate**：TG-002 补充验证；TG-003 RuntimeSnapshot 映射补充验证
- **复用工作区**：`/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw`
- **openDAW**：`@opendaw/studio-sdk@0.0.163`
- **Electron**：`40.10.6`
- **Chromium**：`144.0.7559.236`
- **项目 PPQ**：960
- **执行断言**：23

### 1. 要回答的问题

验证 openDAW 中已经完成的对象选区能否机械地映射回 Canonical ABC，而不使用大语言模型：

```text
openDAW VertexSelection / FilteredSelection
→ selected NoteEventBox / NoteRegionBox UUID
→ RuntimeSnapshot reverse index
→ product Track ID + exact Tick interval
→ TG-002 ScopeMappingCache
→ Canonical ABC character spans
```

本 Spike 使用与 openDAW Note Editor 相同的 `FilteredSelection<NoteEventBoxAdapter>` 结构，以及项目已有的 `regionSelection`，不是在产品层伪造一套选区对象。

### 2. RuntimeSnapshot 需要增加的反向索引

仅保存：

```text
product Track ID → openDAW Track / Region / Event UUID
```

不足以高效、安全地处理 openDAW 反向选区。验证使用以下派生索引：

```ts
interface RuntimeSelectionIndex {
  sourceHash: string;
  parserVersion: string;
  ppq: 960;

  notesByUuid: Record<OpenDawEventUuid, {
    eventUuid: string;
    regionUuid: string;
    trackId: TrackId;
    noteIndex: number;
    startTick: number;
    durationTick: number;
    pitch: number;
    velocity: number;
  }>;

  regionsByUuid: Record<OpenDawRegionUuid, {
    regionUuid: string;
    trackId: TrackId;
    startTick: number;
    endTick: number;
    eventUuids: string[];
  }>;
}
```

该索引属于 `RuntimeSnapshot` wrapper 的可重建派生数据，不进入 Canonical ABC，也不成为新的工程事实来源。

`sourceHash`、`parserVersion` 和 `ppq` 必须与 TG-002 的 `ScopeMappingCache` 一致，否则拒绝反向映射。

### 3. 验证结果

| 场景 | 结果 | 证据摘要 |
|---|---|---|
| 单 Note 选择 | PASS | `track.keys` 的一个 `NoteEventBox` 映射为 `[9600,10560)` 和 ABC token `E2` |
| 连续多 Note 选择 | PASS | 3 个相邻事件合并为精确范围 `[3840,6720)`，没有引入未选事件 |
| 非连续多 Note 选择 | PASS | 两个事件保留为两个离散范围；包围范围会额外包含未选事件，因此不得强制压成一个 Scope |
| 单 Region 选择 | PASS | `track.strings` Region 映射为该轨 16 个 ABC spans |
| 多 Region 选择 | PASS | `track.drums` 与 `track.strings` 保持两个独立轨道 Scope，共 32 个事件 |
| Region + 内部 Note 同时选择 | PASS | 两个选中对象去重后仍为 16 个事件，不重复提交同一 ABC span |
| 空选择 | PASS | 返回空 Track、空事件、空 spans |
| Snapshot 重载 | PASS | `Project.load()` 后 96 个 NoteEvent UUID 与 6 个 Region UUID 全部保持并可反向解析 |
| openDAW Note 被移动 | PASS，拒绝 | 当前 Tick 与 Snapshot 指纹不一致，fail-closed |
| 新建但未进入 Snapshot 的 Note | PASS，拒绝 | UUID 不存在于反向索引，fail-closed |

### 4. 连续与非连续选择必须区分

连续选择：

```text
Selected:
[3840,4800)
[4800,5760)
[5760,6720)

Exact range:
[3840,6720)
```

该范围可以安全地交给 TG-002 查询。

非连续选择：

```text
Selected:
[960,1920)
[2880,3840)

Bounding range:
[960,3840)
```

包围范围还包含未选择的：

```text
[1920,2880)
```

因此 openDAW 多选不能一律转成：

```ts
{startTick: min(selected), endTick: max(selected)}
```

正确输出必须保留：

```ts
interface BackmappedTrackSelection {
  trackId: TrackId;
  events: BackmappedEvent[];
  exactRanges: TickRange[];
  abcSpans: AbcSpan[];
  boundingRangeAddsUnselectedEvents: boolean;
}
```

只有 `boundingRangeAddsUnselectedEvents === false` 时，才可把结果简化为单一连续 Scope。

### 5. openDAW 矩形选区的边界

源码中的 `SelectionRectangle` 在拖拽过程中临时计算：

```text
uMin / uMax / vMin / vMax
```

但拖拽完成后写入 `VertexSelection` 的只有选中的 Adapter/Box vertices。原始矩形几何范围不会持久化。

因此可以可靠恢复：

- 被选中的具体 Note；
- 被选中的具体 Region；
- 每个对象对应的 Track、Tick 与 ABC spans；
- 所有选中对象的最小包围范围。

不能仅从 openDAW selection state 恢复：

- 用户拖拽矩形的精确 `x0/x1`；
- 矩形覆盖但没有事件的空白时间段；
- 用户是否有意包含左右空白边距。

如果产品需要“连续时间范围，包括空白区域”这一语义，UI 必须额外保留自己的：

```ts
interface ProductTimeSelection {
  trackIds: TrackId[];
  startTick: number;
  endTick: number;
}
```

该数据由产品 UI 维护，不能事后从 openDAW `VertexSelection` 推导。

### 6. 安全校验

选中的 NoteEvent 不能只按 UUID 查表后直接信任。反向映射时还要比较：

- owner Region UUID；
- absolute `startTick`；
- `durationTick`；
- `pitch`；
- `velocity`。

验证中将一个已映射事件从 tick `6720` 移至 `6840` 后，反向映射被拒绝：

```text
startTick is stale: expected 6720, got 6840
```

这可以阻止 openDAW 内容已被手动修改、但 ABC/Mapping 尚未同步时错误修改旧 ABC token。

对 openDAW 中新建但未进入 Snapshot 的事件，同样拒绝：

```text
Selected openDAW NoteEvent UUID is not in RuntimeSnapshot
```

### 7. 架构结论

验证后的链路成立：

```text
openDAW selected objects
→ UUID reverse index
→ exact product events / Track IDs / Tick ranges
→ ScopeMappingCache
→ Canonical ABC spans
```

因此 Note/Region 对象选择可以机械映射回 ABC，不需要大语言模型参与。

需要保留两个不同概念：

1. **Object Selection**：来自 openDAW，表示选中的 Note/Region 对象，可通过 UUID 反向映射；
2. **Product Time Selection**：来自产品 UI，表示连续 Tick Range，可以包含无事件空白区。

二者不能混为同一个数据结构。

### 8. 证据索引

```text
/workspace/tmp/opendaw-runtime-validation/evidence/selection-backmap-validation.json
/workspace/tmp/opendaw-runtime-validation/evidence/selection-backmap-electron-window.png
/workspace/tmp/opendaw-runtime-validation/evidence/selection-backmap-typecheck.log
/workspace/tmp/opendaw-runtime-validation/evidence/selection-backmap-build.log
```

验证代码位于仓库外：

```text
/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw/src/selection-backmap-core.ts
/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw/src/selection-backmap-spike.ts
/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw/electron-selection-backmap-validation.mjs
```


---

## Spike-004：TG-009 MIDI 与 TG-010 WAV 正式导出链

- **日期**：2026-07-30
- **状态**：PASS
- **对应架构 Gate**：TG-009 PASS；TG-010 PASS
- **复用工作区**：`/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw`
- **openDAW**：`@opendaw/studio-sdk@0.0.163`
- **Electron**：`40.10.6`
- **Chromium**：`144.0.7559.236`
- **Node.js**：`24.15.0`
- **环境**：Linux 2C2G，Xvfb；Windows 文件系统行为仍需在交付测试中回归

### 1. 要回答的问题

验证正式导出是否可以满足以下架构链路：

```text
clean Current main HEAD
→ 重新读取并编译 Canonical composition.abc
→ Standard MIDI / openDAW Runtime
→ MIDI 或 WAV bytes
→ 同目录临时文件
→ fsync
→ atomic rename
→ 最终目标文件
```

并验证：

- Candidate 不得进入正式导出；
- dirty `main` 不得正式导出；
- MIDI 保留核心工程数据和尾部休止；
- WAV 提供可用进度；
- WAV 渲染可取消；
- 可听尾音不被音符边界截断；
- 取消或写入失败时，既有目标文件保持不变；
- 临时文件得到清理。

### 2. Current-only 验证夹具

在仓库外创建真实临时 Git 工程：

```text
/workspace/tmp/opendaw-runtime-validation/evidence/tg-009-010-current-project
```

工程包含：

```text
main                        Current
candidate/export-gates      Candidate，包含不同音高
```

正式导出入口执行：

```text
branch == main
&& git status --porcelain == empty
&& git show main:composition.abc
```

结果：

| 验证项 | 结果 |
|---|---|
| dirty `main` | 拒绝 |
| Candidate 与 Current 内容不同 | 已确认 |
| 导出 source hash | 与 `main:composition.abc` 一致 |
| 导出 source hash | 与 Candidate 不一致 |
| Candidate 正式导出 | 未发生 |

因此导出输入来自提交后的 Current，而不是工作区文件、Candidate 或旧缓存。

### 3. TG-009：MIDI 导出

#### 3.1 验证夹具

Canonical ABC 包含：

- 六个固定 Voice；
- PPQ 960；
- 4/4；
- tick 0：120 BPM；
- tick 3,840：90 BPM；
- tick 0：C major；
- tick 7,680：G major；
- 六轨各 16 个 Note，共 96 个；
- 最后一个 Note 在 tick 15,360 结束；
- 工程在 tick 19,200 结束；
- 尾部包含 3,840 Tick，即一小节休止。

为支持完整工程长度，临时验证编译器增加了 Rest 处理：

```text
ABC Rest
→ 只推进 Voice cursor
→ 不创建 MIDI NoteEvent
→ 保留 StandardMidiDocument.totalTicks
```

这证明正式 Music Core 不能只累计 Note 时值；Rest 同样必须推进 Canonical 时间轴。

#### 3.2 导出结果

生成文件：

```text
/workspace/tmp/opendaw-runtime-validation/evidence/tg-009-010-output/current.mid
```

结果：

```text
SMF Format: 1
PPQ: 960
Tracks: 7（1 conductor + 6 music）
Bytes: 1,109
Notes: 96
Total ticks: 19,200
Last note end: 15,360
Trailing rest: 3,840 ticks
```

Conductor Track 保留：

| 类型 | Tick | 值 |
|---|---:|---|
| Tempo | 0 | 120 BPM |
| Tempo | 3,840 | 约 90 BPM |
| Meter | 0 | 4/4 |
| Key | 0 | C major |
| Key | 7,680 | G major |

六轨顺序和 Channel：

| Track | Channel |
|---|---:|
| `track.drums` | 9 |
| `track.bass` | 0 |
| `track.guitar` | 1 |
| `track.keys` | 2 |
| `track.strings` | 3 |
| `track.winds` | 4 |

使用不依赖 `midi-file` 的 Python 标准库 SMF 解析器重新检查了：

- Header 与 Track Chunk；
- VLQ；
- Track Name；
- Tempo、Meter 和 Key；
- Note On/Off；
- Track 顺序与 Channel；
- 96 个 Note；
- 所有 Track 的 End of Track 均位于 tick 19,200；
- 最后 Note 后的 3,840 Tick 休止。

独立解析结果为 PASS。

### 4. TG-010：WAV 离线渲染

#### 4.1 正常渲染与进度

生成文件：

```text
/workspace/tmp/opendaw-runtime-validation/evidence/tg-009-010-output/current.wav
```

openDAW `OfflineEngineRenderer` 产生 20 个进度值：

```text
0
→ 0.00053
→ 多个中间值
→ 0.94220
→ 1
```

已确认：

- 从 0 开始；
- 存在多个 `0 < progress < 1` 的中间值；
- 全部单调不下降；
- 成功时以 1 结束。

WAV 结果：

```text
RIFF/WAVE
IEEE Float
48 kHz
2 channels
32-bit
530,656 frames
11.0553 seconds
4,245,292 bytes
```

独立 Python RIFF 解析器复核：

```text
Peak: 1.921262
RMS: 0.283556
Non-silent ratio: 97.71%
Last audible sample: 10.8058 seconds
```

Peak 大于 1 是六个占位合成器同时发声的测试混音结果。文件使用 IEEE Float，不构成本 Gate 的编码截断；正式音色与混音增益仍需产品实现控制。

#### 4.2 取消

另创建约 16 倍长度的 openDAW 工程，在渲染已经产生中间进度后触发 `AbortController.abort()`。

取消进度：

```text
0
→ 0.000033
→ 0.002733
→ 0.007733
→ Abort
```

结果：

- `OfflineEngineRenderer.start()` 以 openDAW `AbortError` 拒绝；
- 没有错误报告 progress=1；
- Worker 被停止；
- 取消结果不产生可提交 WAV bytes。

因此取消令牌可以从产品导出任务传入 openDAW Renderer。

### 5. 尾音语义

最后 Note 的乐谱结束时间为：

```text
10.0000 seconds
```

最后可听样本为：

```text
10.8058 seconds
```

证明约 `0.8058` 秒的合成器 Release 尾音被保留，渲染没有在 Note End 处截断。

但工程的显式尾部休止为：

```text
2.6667 seconds
```

最终 WAV 时长只有：

```text
11.0553 seconds
```

即 openDAW 当前离线 Renderer 的行为是：

```text
持续渲染，直到声音低于 silence threshold
→ 保留可听衰减和约 250 ms 静音
→ 裁掉后续纯静音
```

它不会自动保留 Canonical 工程的完整尾部休止。

因此 P0 需要明确采用以下语义之一：

1. **内容尾音导出**：保留所有可听衰减，裁掉纯静音；当前 openDAW 行为可直接使用；
2. **时间轴完整导出**：WAV 必须至少等于 Canonical `totalTicks` 对应时长；需要导出后补零或使用自定义 `step()` 渲染控制。

本 Gate 按架构中“尾音不被截断”的要求判定 PASS。若产品将“整曲 WAV”解释为必须保留尾部纯休止，则实现阶段必须采用方案 2。

### 6. 原子输出与失败安全

验证实现使用：

```text
目标目录/.目标文件.pid.uuid.tmp
→ 分块写入
→ file fsync
→ 关闭临时文件
→ 同目录 rename 到最终路径
→ 尝试 directory fsync
```

MIDI 和 WAV 均验证：

- 临时文件与目标文件在同一目录；
- 临时文件写入完成前，已有目标文件仍保持旧内容；
- rename 后最终文件逐字节等于导出 bytes；
- SHA-256 与独立解析文件一致。

故障注入结果：

| 场景 | 结果 |
|---|---|
| WAV 分块写入中取消 | AbortError；原目标文件保持不变 |
| MIDI rename 前注入写入失败 | 原目标文件保持不变 |
| 取消后临时文件 | 已删除 |
| 失败后临时文件 | 已删除 |
| 成功后临时文件 | 不存在 |

当前验证运行于 Linux。Windows 10/11 上仍需回归：

- Defender 扫描期间 rename；
- 中文与长路径；
- 目标文件被其他程序占用；
- 同名文件替换；
- FAT/NTFS/网络盘差异。

这些属于 Windows 交付测试，不改变当前 Node/Electron 同目录临时文件方案的技术可行性结论。

### 7. 架构结论

TG-009 链路成立：

```text
clean main HEAD
→ Canonical ABC fresh compile
→ Standard MIDI Format 1
→ atomic file output
→ independent parser PASS
```

TG-010 链路成立：

```text
clean main HEAD
→ fresh openDAW Runtime
→ offline render progress
→ AbortSignal cancellation
→ audible tail preservation
→ WAV encoding
→ atomic file output
→ independent parser PASS
```

因此：

```text
TG-009: PASS
TG-010: PASS
```

### 8. 证据索引

```text
/workspace/tmp/opendaw-runtime-validation/evidence/tg-009-010-validation.json
/workspace/tmp/opendaw-runtime-validation/evidence/tg-009-midi-independent-check.json
/workspace/tmp/opendaw-runtime-validation/evidence/tg-010-wav-independent-check.json
/workspace/tmp/opendaw-runtime-validation/evidence/tg-009-010-electron-window.png
/workspace/tmp/opendaw-runtime-validation/evidence/tg-009-010-typecheck.log
/workspace/tmp/opendaw-runtime-validation/evidence/tg-009-010-build.log
/workspace/tmp/opendaw-runtime-validation/evidence/tg-009-010-output/current.mid
/workspace/tmp/opendaw-runtime-validation/evidence/tg-009-010-output/current.wav
```

验证代码位于仓库外：

```text
/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw/src/export-gates-spike.ts
/workspace/tmp/opendaw-runtime-validation/poc/vite-electron-opendaw/electron-export-gates-validation.mjs
```

---

## Spike-005：TG-004 跨 Scope 边界事件保护

- **日期**：2026-07-30
- **状态**：PASS
- **对应架构 Gate**：TG-004 PASS
- **验证环境**：Windows 11、Node.js 22.18.0、abcjs 6.6.4、PPQ=960
- **复现命令**：`pnpm.cmd install --frozen-lockfile && pnpm.cmd validate`

### 1. 验证结论

局部 Scope 使用半开区间 `[startTick,endTick)` 时，可以机械地识别并保护所有跨边界持续事件。验证了普通 Note、Tie、Chord 和 Rest；abcjs 实际解析夹具保留了双 Voice、Tie 起止 token、Chord 与 Rest。

在现有 `replaceScopedMusic` 的“每轨提交完整 Scope 片段” Interface 下，最终采用并验证了如下 fail-closed 规则：**若某提交轨道存在任一既有持续事件与 Scope 左右边界相交，则整次多轨写调用在临时写入前原子拒绝。** Agent 必须申请将 Scope 扩展到完整包含该事件后再重试。

### 2. 场景与故障注入

- 端点恰好位于 `startTick` 或 `endTick` 的事件正确归类为外部或内部；
- 左跨界、右跨界、覆盖整个 Scope 的事件均受保护；
- Tie 的两个 ABC span 同时受保护；
- 含跨界事件的写入返回 `SCOPE_INTERSECTS_PROTECTED_EVENT`，且 Candidate source、source hash、Mapping hash 均不变；
- stale Mapping hash 返回 `SCOPE_MAPPING_STALE`；
- Scope 扩展至 `[0,4800)` 后同一替换成功。

执行断言：22，全部通过。

### 3. 需固化的实现约束

若未来需要“保留边界音、仅编辑其间完整事件”的能力，不能继续复用单个完整 Scope 字符串片段 Interface；必须设计显式的分段替换 Interface。P0 不得通过字符串拼接悄然绕过跨界保护。

### 4. 证据索引

```text
C:\Users\TreeHey\AppData\Local\Temp\agent-music-workstation-spikes\tg004-008\evidence\tg-004-boundary-events.json
```

---

## Spike-006：TG-005 Windows Git/worktree 与 Candidate 状态机

- **日期**：2026-07-30
- **状态**：PASS
- **对应架构 Gate**：TG-005 PASS
- **验证环境**：Windows 11、Git for Windows 2.46.0.windows.1、Node.js 22.18.0
- **复现命令**：`pnpm.cmd install --frozen-lockfile && pnpm.cmd validate`

### 1. 验证结论

Windows 原生 Git 上已跑通：`C0 → Candidate → T1/P1 → T2/P2 → Accept C1`。Candidate 在独立 linked worktree 中允许未提交修改；每个成功 `finishTask` 形成一个 checkpoint；Accept 将最终 Candidate 权威树写入单一新的 `main` commit，P1/P2 均不是 C1 的祖先。

主夹具路径包含中文与空格。额外在 Candidate 中实际跟踪了长度 373 的 Windows 文件路径，并成功完成提交和 worktree 清理。

### 2. 场景与故障注入

- Candidate ID 冲突被拒绝；
- T1 成功形成 checkpoint；T2 失败不 commit 且保留 dirty Candidate；修复后形成 P2；
- 取消 T3 使用 Candidate 的 taskBaseCheckpoint 恢复，Candidate 回到 clean；
- dirty Current 与 invalid Candidate 均阻止 Accept；
- 注入 `pre-commit` 失败后，main SHA 不前进且主工作区恢复 clean，Candidate 保留以便重试；
- Accept commit 成功、Candidate 清理失败时，新的 Current 已持久化且可安全重试清理；
- Reject、手动删除 worktree 后的 `git worktree prune` 均不改变 Current。

执行断言：34，全部通过。

### 3. 实现约束

Git Adapter 应始终以参数数组运行 Git；对长路径需要启用 `core.longpaths=true`。Accept 的线性化边界是 main 正式 commit 成功：此前失败必须恢复两个权威文件和 index；此后失败仅进入 Candidate cleanup pending，不能回滚 Current。

### 4. 证据索引

```text
C:\Users\TreeHey\AppData\Local\Temp\agent-music-workstation-spikes\tg004-008\evidence\tg-005-windows-git-worktree.json
```

---

## Spike-007：TG-006 只依赖 Current `main` HEAD 的恢复

- **日期**：2026-07-30
- **状态**：PASS
- **对应架构 Gate**：TG-006 PASS
- **验证环境**：Windows 11、Git for Windows 2.46.0.windows.1、Node.js 22.18.0
- **复现命令**：`pnpm.cmd install --frozen-lockfile && pnpm.cmd validate`

### 1. 验证结论

只用 `main` HEAD 的 `project.json` 与 `composition.abc`，可以恢复相同的 Current 权威 hash；Scope Mapping、MIDI/Runtime 缓存、SQLite 与未接受 Candidate 均不是恢复前提。

### 2. 场景与故障注入

- 删除/损坏派生缓存和 SQLite 后，Current 权威 hash 不变；
- 清理 dirty、未接受 Candidate 不改变 `main`；
- 模拟 Accept commit 前崩溃：工作区外部内容被识别为 dirty，显式恢复后回到旧 HEAD；
- 模拟 commit 成功、Candidate 清理前崩溃：新 HEAD 保持有效；
- 外部篡改 `project.json` 不会被静默采用，返回 `CURRENT_WORKTREE_DIRTY`；显式恢复仅从 `main` HEAD 写回两个权威文件。

执行断言：10，全部通过。

### 3. 实现约束

启动时应采用“检测 dirty Current → 只读错误 → 显式恢复 main HEAD”的流程；P0 不得自动采纳工作区、SQLite 或 Candidate 中的未提交内容。

### 4. 证据索引

```text
C:\Users\TreeHey\AppData\Local\Temp\agent-music-workstation-spikes\tg004-008\evidence\tg-006-current-recovery.json
```

---

## Spike-008：TG-007 Local MCP Streamable HTTP

- **日期**：2026-07-30
- **状态**：PASS
- **对应架构 Gate**：TG-007 PASS
- **验证环境**：Windows 11、Node.js 22.18.0、`@modelcontextprotocol/sdk` 1.30.0
- **Transport**：官方 SDK 的 Streamable HTTP Server/Client，非 REST 模拟
- **复现命令**：`pnpm.cmd install --frozen-lockfile && pnpm.cmd validate`

### 1. 验证结论

两个 MCP 实例同时在不同随机端口的 `127.0.0.1` 上运行，分别拥有 256-bit 随机 Instance Token、独立 runtime descriptor 和 TaskContext。官方 Streamable HTTP Client 成功完成 `tools/list`、`get_task_context` 与写工具调用。

descriptor 在仓库外生成，设置为禁用继承且只授予当前 Windows 用户读写权限；正常关闭删除 descriptor，死 PID descriptor 可在后续启动时清理。

### 2. 场景与故障注入

- 缺失或错误 Token 返回 401；
- 跨 Origin 请求返回 403；
- Token A 不能访问实例 B 的 TaskContext；
- 不存在 Task、stale `scopeRevision`、Scope 越界写入均由服务器端拒绝；
- 合法 Task + Revision 的候选写入成功；
- 多实例 endpoint、Token 和 TaskContext 相互隔离；
- dead-PID descriptor 被删除，两个正常 descriptor 在关闭时删除。

执行断言：23，全部通过。

### 3. 发现的 Interface 缺口

架构文字要求写入校验 `scopeRevision`，但现有 `replaceScopedMusic` 示例未携带该字段。验证表明若不传入调用时 revision，Scope 扩展后的迟到 Tool Call 无法可靠拒绝。正式 MCP Interface 必须至少改为：

```ts
replaceScopedMusic({ taskId, scopeRevision, tracks })
finishTask({ taskId, scopeRevision })
```

该结论记录为 Spike 发现，尚未修改架构基线。

### 4. 证据索引

```text
C:\Users\TreeHey\AppData\Local\Temp\agent-music-workstation-spikes\tg004-008\evidence\tg-007-mcp-http.json
```

---

## Spike-009：TG-008 OpenAI-compatible Chat Completions Provider Adapter

- **日期**：2026-07-30
- **状态**：PASS
- **对应架构 Gate**：TG-008 PASS
- **验证环境**：Windows 11、Node.js 22.18.0、本地 fake Provider、TG-007 MCP Host
- **协议**：`POST /v1/chat/completions`
- **复现命令**：`pnpm.cmd install --frozen-lockfile && pnpm.cmd validate`

### 1. 验证结论

Provider Adapter 已通过本地 OpenAI-compatible fake Provider 验证流式 SSE Tool Call 的增量归并：Tool Call ID、函数名和 JSON arguments 分别跨多个 frame 发送后，正确组装为一次 `get_task_context` 调用。该调用使用真实 TG-007 Streamable HTTP MCP Client/Host 完成，随后第二次 Chat Completions 调用返回最终流式文本。

### 2. 场景与故障注入

- fragmented Tool Call 组装为一个有效调用；
- malformed Tool arguments 返回 `TOOL_ARGUMENTS_INVALID`，不会调用 MCP；
- HTTP 429 映射为可重试 `PROVIDER_RATE_LIMIT`；
- 非 JSON 响应映射为 `PROVIDER_PROTOCOL_INVALID`；
- 缺失 `[DONE]` 映射为 `PROVIDER_STREAM_INCOMPLETE`；
- headers timeout 映射为 `PROVIDER_TIMEOUT`；
- 流中取消返回 `CANCELLED`，500ms 后到达的 late SSE 内容被忽略；
- fake Provider 确认收到 Authorization，但证据未记录 Token 或完整请求内容。

执行断言：15，全部通过。

### 3. 实现约束

> **历史说明：** 本 Spike 验证的是 Chat Completions Tool Call、流式、取消、超时和错误映射的可行性。其“自研 Provider Adapter / SSE 拼接”实现约束已被 Architecture V1.9 ADR-044 替代；正式 A4 直接使用 Strands 原生 OpenAI-compatible Chat Completions 能力与 Agent-side MCP Client，并以本 Spike 的行为断言作为回归标准。

P0 继续只支持 Chat Completions，不增加 Responses API 双协议适配。

### 4. 证据索引

```text
C:\Users\TreeHey\AppData\Local\Temp\agent-music-workstation-spikes\tg004-008\evidence\tg-008-chat-completions.json
C:\Users\TreeHey\AppData\Local\Temp\agent-music-workstation-spikes\tg004-008\evidence\run-summary.json
```

---

## Spike-010：A2 Canonical ABC 白名单与 Velocity 稳定边界

- **日期**：2026-08-02
- **状态**：PASS / ADOPTED（边界探测完成；Velocity 候选已由 ADR-034 纳入 P0）
- **关联模块**：A2 Composition Pipeline
- **ABC Parser**：`abcjs@6.6.4`
- **Node.js**：`24.14.0`
- **项目 PPQ**：960
- **执行断言**：12

> 架构采用说明：本 Spike 只验证 A2 的 Canonical ABC 与领域/MIDI 边界。根据 ADR-033，A2 不构建 RuntimeSnapshot；本文更早 Spike 中出现的 RuntimeSnapshot 是 openDAW 集成技术产物，正式实现归 B3，不与 ScopeMappingCache 合并。

### 1. 目的

Spike-002 的 TG-001/TG-002 只用单音、单声部事件证明了 Canonicalization 和 Scope Mapping 机制，没有证明 PRD 所需 Rest、Chord、Tie 与 Velocity 的正式表示。本 Spike 先回答哪些语法可稳定解析、映射和生成播放事件，以及哪些输入必须由 Music Core 额外约束；不在此处冻结最终 P0 白名单。

### 2. 已稳定通过的候选能力

| 能力 | 结果 | 已验证边界 |
|---|---|---|
| Rest | PASS | 可解析并保留稳定源码 span；进入领域时间线但不产生 MIDI Note。 |
| Chord | PASS | 一个 ABC token 稳定产生多个同起点、同时值的 MIDI Note。 |
| Tie | PASS | 同小节和跨小节 Tie 可合并为一个持续发声事件；Scope Mapping 必须为一个领域事件保留多个 ABC span。 |
| Tied Chord | PASS | 三个 chord pitch 分别形成延长后的发声事件。 |
| Accidental | PASS | 升降号在同小节延续，并在下一小节按 ABC 规则重置。 |
| Octave | PASS | `,`、大写、小写和 `'` 稳定映射为 MIDI octave。 |
| Duration | PASS，需双重校验 | abcjs 无 warning 且可精确映射到整数 PPQ Tick 时可接受；任一条件失败即拒绝。 |

### 3. Velocity 结果

`abcjs` 支持以下内联指令：

```abc
[I:MIDI vol 0]C [I:MIDI vol 64]D [I:MIDI vol 127][CEG]
```

验证结果：

- `0`、`1`、`64`、`127` 均逐值进入音频事件，不发生档位化；
- 指令只作用于后续一个发声事件；
- 作用于 Chord 时，同一 Velocity 应用于 Chord 内全部 pitch；
- `-1` 和 `128` 会被 abcjs 静默截断为 `0` 和 `127`，因此 Music Core 必须在交给 abcjs 前拒绝越界值；
- `pp/mf/ff` 等动态记号会根据拍位产生不同数值，只适合作为有限音乐动态语义，不适合作为任意数值的 Canonical Velocity；
- abcjs 为内联 MIDI 指令返回的 `startChar/endChar` 是 `-1/-1`，无法仅依赖 Tune Object 构建安全 Scope span。

因此，`[I:MIDI vol N]` 是“可实现任意 Velocity”的稳定候选表示。ADR-034 已采用该表示，A2 必须有受控 tokenizer/serializer：

1. 将每条 Velocity 指令绑定到恰好一个后续 Note 或 Chord；
2. 把指令文本与 Note/Chord token 一并纳入该领域事件的 ABC span；
3. 在 abcjs 解析前验证 `N` 是产品允许范围内的整数；Spike 证明 abcjs 可传递 `0`，但最终播放领域范围由 ADR-034 决定；
4. 禁止指令悬空、连续覆盖或跨 Rest 隐式作用；
5. 明确 P0 Chord 只支持共享 Velocity，除非后续 Spike 证明可稳定表达 chord 内独立 pitch velocity。

### 4. 当前未证明的边界

以下能力不进入已稳定候选集合，后续若要纳入 P0 白名单必须追加验证：

- Chord 内每个 pitch 的独立 Velocity；
- Tuplet；
- Broken Rhythm；
- Grace Note；
- Tie 以外的 Ornament 和 Articulation；
- 一条产品轨道内的多个同时 ABC Voice。

### 5. 对 A2 的当前约束

- 所有 abcjs parser warning 均 fail-closed，包括 `Duration not representable`；
- 除检查 abcjs warning 外，仍需独立检查 `duration × 4 × 960` 是整数；
- Tie chain 是一个领域持续事件，Mapping 允许 `abcSpans[]` 包含多个 token；
- Rest 参与轨道长度和 Scope Mapping，但不产生 MIDI Note；
- Spike 原始结论只给出稳定候选与拒绝边界；最终 P0 采用结果见下节和 ADR-034/ADR-035。

### 6. D2 采用结果与实现回归

2026-08-02 的 D2 决策采用，并于 2026-08-05 根据 Standard MIDI Note On/Off 语义修正范围：

- `[I:MIDI vol N]`，`N` 为整数 `1..127`；`0` 保留为 Note Off，不作为 Note onset Velocity；
- 指令只绑定一个后续 Note/Chord onset，并与事件进入同一个 Scope span；
- Chord 内共享 Velocity，Tie continuation 不重新设置；
- 没有指令时使用默认值 `100`；
- Tuplet、Broken Rhythm、Grace、Tie 之外的 Ornament/Articulation、单轨内部多 Voice 和 Chord 内独立 pitch Velocity 不属于当前 PRD P0。

全局拍号修改的 TDD 回归还发现 abcjs `getBpm()` 会在 6/8 下将明确的 `Q:1/4=120` 派生为 80，且会按 Meter 改写整小节 Rest 的解析时长。正式 A2 因此：

- 从 Canonical `Q:1/4=N` 读取初始 Tempo，不使用 Meter 相关的 `getBpm()` 派生值；
- 从显式事件 token 与 `L:` 独立计算 Tick 时值，不接受 Meter 改写音乐事件时长；
- `updateGlobalMeter` 修改后验证 totalTicks、Note/Rest、Velocity、Tempo 和 Key 均不变；
- Global Meter 仅允许覆盖全部六轨的 `wholeProject` Scope，并重建 Standard MIDI Time Signature、Scope Mapping 与 TimelineViewModel。

### 7. 证据索引

```text
/tmp/amw-a2-spike/abc-boundary-results.json
/workspace/scratch/382953ca49ba/a2-spike/abc-boundary-spike.mjs
```
