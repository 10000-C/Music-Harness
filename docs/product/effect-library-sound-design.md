# Effect Library 音色方案

## 产品概念

音色系统由 **Instrument** 和 **Effect Chain** 两部分组成。

- **Instrument** 决定音轨如何发声，例如钢琴、贝斯、鼓或合成器。它表示音源及其自身配置，可以对应 SoundFont、采样器或合成器预设。
- **Effect Chain** 决定 Instrument 产生的声音随后经过哪些处理。Effect Chain 按顺序引用 Effect Library 中的一个或多个 Effect。

例如：

```text
Bass Instrument
→ Compressor
→ Saturation
→ EQ
```

## Effect Library

**Effect Library（效果器库）** 保存可跨项目复用的效果器资产。

每个 Effect 包含：

- 音频处理逻辑；
- 可调参数定义；
- 默认参数值；
- 不可变的版本标识。

例如 Reverb 可以定义 decay、pre-delay、damping、wet 等参数；Compressor 可以定义 threshold、ratio、attack、release 等参数。

Effect 独立于具体项目，可以被不同项目和音轨复用。项目引用明确的 Effect 版本，以保证旧项目能够稳定复现原有声音。

Effect 可以由系统内置，也可以在后续由 Agent 创建。Agent 创建新的 Effect 时，可以编写新的 DSP 处理逻辑、定义参数并设置默认值；验证通过后进入 Effect Library，并可以像内置效果器一样挂载到任意音轨。

## 项目中的音色配置

项目文件只保存每条音轨的 **Instrument 配置** 和 **Effect Chain**，不复制完整的 Effect 实现。

```text
Effect Library
├── Reverb A@1
├── Compressor B@1
├── Chorus C@2
└── Agent Effect D@1

Project
└── Track
    ├── Instrument: Bass Preset A
    └── Effect Chain
        ├── Compressor B@1
        └── Agent Effect D@1
```

项目保存的是“这条轨道使用什么音源，以及声音经过哪些效果器”；Effect Library 保存的是“效果器本身如何处理音频”。

## Audio Runtime

Instrument 和 Effect Chain 都属于项目的音色配置，不直接等同于底层音频引擎参数。

播放时由 Audio Compiler / Runtime Adapter 根据项目配置加载对应 Instrument 和 Effect，并构建底层 Runtime Audio Graph：

```text
Track Music Events
        ↓
Instrument
        ↓
Effect Chain
        ↓
Audio Compiler / Runtime Adapter
        ↓
Runtime Audio Graph
        ↓
Audio Output
```

因此项目层不依赖某个具体音频引擎的内部对象或参数格式，底层 Runtime 可以独立替换。

## 长期扩展

音色能力可以从选择 Instrument 和组合现有效果器，逐步扩展到 Agent 自主创建效果器。最终 Agent 可以通过真实 DSP 参数和新的处理算法完成 sound design，并把生成的 Effect 作为新的可复用资产沉淀到 Effect Library。
