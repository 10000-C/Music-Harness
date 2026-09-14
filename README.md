# Lie

### The Music Harness

An agent-first music workstation for structured, controllable, and editable composition.

> **Think Claude Code for music:** describe an intent, let the agent edit a structured project, audition the candidate, then accept or reject the change.

<p align="left">
  <a href="#license"><img src="https://img.shields.io/badge/License-Apache_2.0-blue.svg" alt="License: Apache-2.0" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows_10%2F11_First-0078D6?logo=windows&logoColor=white" alt="Platform: Windows First" />
  <img src="https://img.shields.io/badge/Node.js-%3E%3D24_%3C25-339933?logo=node.js&logoColor=white" alt="Node.js version" />
  <img src="https://img.shields.io/badge/pnpm-%3E%3D9_%3C10-F69220?logo=pnpm&logoColor=white" alt="pnpm version" />
  <img src="https://img.shields.io/badge/Architecture-Local--First_%7C_Agent--First-success" alt="Architecture" />
</p>

---

<!-- DEMO PLACEHOLDER: Add walkthrough video, GIF, or screenshot here (e.g. ![Lie Walkthrough](docs/assets/demo.gif)) -->

## The 10-Second Pitch: How Lie Works

Lie brings explicit boundaries, validation, and transactional workflows inspired by modern software engineering into music composition.

```
User Intent (Natural Language)
               │
               ▼
   Bounded Task Scope (UI-Selected Measures & Tracks)
               │
               ▼
   Agent Runtime (Strands Engine + Music Style Skills)
               │
               ▼
   Music Core MCP Tools (Constrained Musical Mutation Surface)
               │
               ▼
   Candidate Workspace (Isolated Git Worktree)
               │
               ▼
   Deterministic Validation (Barline, Meter & Velocity Diagnostics)
               │
               ▼
   A/B Audition (Compare Stable Current vs Proposed Candidate)
               │
       ┌───────┴───────┐
       ▼               ▼
[ Accept Change ]  [ Reject Change ]
(Advance Project)  (Clean Rollback)
```

---

## What is Lie?

### Comparison & Problem Space

| Dimension | Traditional DAWs & DAW-MCPs (Ableton, Logic, Cubase) | End-to-End Generative AI (Suno, Udio) | **Lie (The Music Harness)** |
| :--- | :--- | :--- | :--- |
| **Representation** | Complex project state & plugin-specific formats | Primarily rendered audio outputs | **Project Canonical ABC Profile (structured text)** |
| **AI Interaction** | External scripting overhead & GUI automation constraints | Prompt-in, flattened-waveform-out | **Constrained, domain-specific MCP tool surface** |
| **Edit Control** | Manual routing overhead; high barrier to entry | Limited fine-grained structural editing | **UI Task Scope restricts edits to designated measures/tracks** |
| **State Management**| Local undo history | Generation-oriented revision workflow | **Git-backed `Current` vs `Candidate` isolation** |
| **Verification** | Manual auditioning for errors | Output-level issues often require regeneration or external audio editing | **Deterministic syntax & duration checks with agent self-repair** |
| **Portability** | Proprietary project formats & plugin dependencies | Primarily rendered audio output | **Multi-track Standard MIDI (.mid) & rendered WAV export** |

### Core Philosophy: The Music Harness

Lie does not treat AI as a monolithic audio generator. Instead, it provides an **agentic music harness**:
- The human creator directs **what** to compose via natural language and defines **where** to compose via timeline UI selection.
- The language model reasons about harmony, arrangement, and groove, but is restricted to a **constrained MCP tool surface with explicit authorization boundaries**.
- Project mutations are validated deterministically, audited in an isolated workspace, and merged into the project only upon explicit user acceptance.

---

## Key Features

### 1. Project Canonical ABC Profile
Musical compositions are stored in a canonicalized ABC profile defined by Lie. This structured, text-based representation serves as the single source of truth from which all downstream artifacts are deterministically derived:
- Multi-track Standard MIDI (`.mid`) files
- Playback engine runtime states (openDAW / SpessaSynth)
- Rendered audio exports (`.wav`)

### 2. Opinionated Six-Role Arrangement Model
To maintain a clear, intentionally constrained arrangement model, the current workstation scope organizes projects around a fixed six-role ensemble:
- 🥁 `track.drums`: Rhythmic foundation, groove, velocity dynamics, and fills
- 🎸 `track.bass`: Harmonic root motion and rhythmic anchor
- 🎸 `track.guitar`: Rhythmic comping, riffs, arpeggios, and lead lines
- 🎹 `track.keys`: Chords, harmonic pad textures, and counter-melodies
- 🎻 `track.strings`: Sustained pads, dynamic swells, and counterpoint
- 🎷 `track.winds`: Melodic accents, solo lines, and horn stabs

### 3. Scope-Constrained Editing (Bounded Task Scope)
When the user highlights specific measures and tracks on the timeline, that selection establishes an explicit authorization boundary (**Task Scope**):
- The Agent is authorized to modify *only* the designated tracks and time range.
- The Agent cannot alter measures or tracks outside this active scope.
- If broader modifications are required, the Agent must request a `requestScopeExtension` operation, which requires explicit user approval before execution.

### 4. Candidate Transactions & A/B Audition
- **Stable Current Baseline:** The verified baseline composition remains untouched during agent execution.
- **Isolated Candidate:** The Agent stages mutations inside an isolated Git worktree branch (`Candidate`).
- **A/B Audition:** The user can switch playback between the stable `Current` state and the proposed `Candidate` state inside the desktop shell.
- **Accept / Reject Workflow:** Accepting advances the project to the new revision; rejecting cleanly discards the candidate worktree without project state leakage.

### 5. Deterministic Validation & Autonomous Self-Repair
Before a candidate reaches user audition, it passes through an automated validation engine:
- **Barline & Duration Checks:** Verifies that every voice strictly matches the tick duration dictated by the project meter.
- **Tie-Chain Integrity:** Confirms tied notes resolve to matching pitches across measure boundaries.
- **MIDI Parameter Boundaries:** Enforces velocity bounds (`1–127`) and pitch ranges.
- **Tick-0 Authority:** Verifies that global tempo (`Q:`) and time signature (`M:`) are established exclusively at Tick-0 to prevent voice desynchronization.
- **Structured Error Feedback:** Syntax and tick discrepancy errors are returned to the Agent as structured diagnostics, enabling autonomous self-repair cycles before user evaluation.

### 6. Portable Outputs
- Export multi-track **Standard MIDI** files for further arrangement and production in external DAWs.
- Export rendered **WAV** audio stems directly from the desktop workstation.

---

## System Architecture

Lie is structured as a decoupled, multi-process desktop system to maintain responsive UI, clear process isolation, and fault boundaries.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Electron Main (Service Supervisor)                   │
│  - Process Lifecycles, Supervision & Heartbeats                        │
│  - Typed IPC Router & Security Boundaries                              │
│  - Settings & API Key Storage                                          │
└───────────────┬────────────────────────────────────────┬───────────────┘
                │                                        │
┌───────────────▼────────────────┐      ┌────────────────▼───────────────┐
│       React 19 Renderer        │      │     Agent Runtime (Strands)    │
│  - Multi-track Timeline UI     │      │  - Agentic Workflow Engine     │
│  - Transport & A/B Audition    │      │  - LLM Prompt & Reasoning Loop │
│  - openDAW / SpessaSynth SF2   │      │  - Style Skill Loader          │
│  - Playback Engine             │      │  - MCP Client                  │
└───────────────┬────────────────┘      └────────────────┬───────────────┘
                │ Typed IPC                              │ Loopback HTTP / SSE
┌───────────────▼────────────────────────────────────────▼───────────────┐
│                       Music Core Utility Process                       │
│  - Project State & Canonical ABC Engine                                │
│  - Git Worktree Transaction Engine (Current vs Candidate)              │
│  - Domain MCP Tools (Fail-closed authorization fences)                 │
│  - Deterministic Barline, Meter & Velocity Validators                  │
└────────────────────────────────────────────────────────────────────────┘
```

### Agent Tool Surface

The Agent is not exposed filesystem, shell, or raw Git tools. All queries and musical modifications occur exclusively through typed Model Context Protocol (MCP) tools exposed by the Music Core process.

Authoritative schemas are defined in [`packages/contracts/src/mcp.ts`](packages/contracts/src/mcp.ts) and implemented in [`apps/workstation/src/core/mcp/music-core-mcp-server.ts`](apps/workstation/src/core/mcp/music-core-mcp-server.ts). The current implementation exposes 10 domain-specific tools:

| MCP Tool Name | Functionality & Constraints |
| :--- | :--- |
| `getTaskContext` | Reads active candidate task context, task ID, and scope parameters. |
| `getScopedComposition` | Returns canonical ABC fragments strictly inside the authorized Task Scope. |
| `submitGenerationPlan` | Registers a multi-step composition roadmap for initial user review. |
| `requestScopeExtension` | Submits an asynchronous operation to request expanded track/bar permissions. |
| `getOperation` | Polls the authoritative status of long-running operations (plans/extensions). |
| `cancelOperation` | Explicitly retracts a pending scope or plan operation. |
| `replaceScopedMusic` | Writes validated voice fragments exclusively into the authorized track/time window. |
| `updateMusicalProperties`| Updates global meter and initial tempo at Tick-0 authority. |
| `resizeComposition` | Adjusts project measure count (decoupled from write authorization). |
| `finishTask` | Runs final preflight validation and seals the Candidate for user audition. |

---

## Built-in Music Style Skills

Lie includes modular musical craft guides located in `music-style-skills/`. These skills direct symbolic composition parameters—harmonic density, voicing, rhythm, register, dynamics, and arrangement roles:

- 🎸 **Shoegaze (`shoegaze`):** Slow harmonic rhythm, extended chord voicings (`maj7`, `add9`, `sus2`), pedal tones across chord changes, sustained melodic beds, and understated vocal-role melodies.
- 🌧️ **Midwest Emo (`midwest-emo`):** Clean arpeggiated figures, suspended intervals, angular dynamic contrasts (loud-quiet transitions), suspended chord voicings, and syncopated drumming.
- ⚡ **Metal (`metal`):** Syncopated down-beat rhythms, pedal tones, rapid double-bass drum patterns, syncopated accents, and minor/phrygian voice-leading.
- 🌌 **Post-Rock (`post-rock`):** Long-form dynamic arcs, repeated melodic motifs across expanding registers, and gradual multi-voice density builds.
- 🎤 **Pop (`pop`):** Concise functional chord loops, syncopated four-on-the-floor kick grooves, transparent instrument register separation, and focused top-line phrases.
- 🎧 **Rap / Trap (`rap`):** Syncopated sub-bass root motion, subdivided hi-hat divisions (triplets and 32nds), snare placements, and sparse harmonic counter-lines.

---

## Repository Layout

```
Music-Harness/
├── apps/
│   ├── workstation/              # Electron desktop application
│   │   └── src/
│   │       ├── main/             # Electron main process & service supervisor
│   │       ├── preload/          # Secure IPC context bridge
│   │       ├── renderer/         # React 19 UI (timeline, transport, agent panel)
│   │       ├── core/             # Music core: ABC engine, Git transactions, MCP tools
│   │       └── shared/           # Typed IPC contracts and bridges
│   └── agent/                    # Agent runtime (Strands framework + MCP client)
├── packages/
│   └── contracts/                # Cross-boundary domain schemas, IPC types & MCP schemas
├── music-style-skills/           # Decoupled genre style knowledge bases
├── docs/                         # Architecture specifications and product PRDs
└── patches/                      # Locked pnpm patches (spessasynth_lib)
```

---

## Getting Started

### Prerequisites

- **Operating System:** Windows 10/11 is the primary tested platform. macOS/Linux support is not yet officially validated.
- **Node.js:** `>=24 <25` (enforced via `.node-version` and `.npmrc`)
- **pnpm:** `>=9 <10` (enforced via `package.json`)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/10000-C/Music-Harness.git
   cd Music-Harness
   ```

2. **Install workspace dependencies:**
   ```bash
   pnpm install --frozen-lockfile
   ```
   > **Note:** `.npmrc` enforces `engine-strict=true`. Installation will fail if run on an unsupported Node.js version.
   > The workspace includes a locked patch (`patches/spessasynth_lib@4.3.14.patch`) that reconciles `spessasynth_lib` type definitions with `BasicMIDI`.

### Running the Desktop App

To start the Electron application in development mode:

```bash
# UI-only development (default stubs)
pnpm --filter @agent-music/workstation dev
```

To run with the **real Music Core service** (enabling project creation, Git worktrees, and ABC compilation):

```bash
# Bash / Zsh
cd apps/workstation
AGENT_MUSIC_FAKE_AGENT=1 AGENT_MUSIC_INCLUDE_FAKE_SERVICES=1 electron-vite dev

# PowerShell (Windows)
cd apps/workstation
$env:AGENT_MUSIC_FAKE_AGENT = "1"
$env:AGENT_MUSIC_INCLUDE_FAKE_SERVICES = "1"
electron-vite dev
```

### Common Gotchas

#### VS Code Terminal (`ELECTRON_RUN_AS_NODE`)
If launching from VS Code's integrated terminal results in:
```
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
```
VS Code injects `ELECTRON_RUN_AS_NODE=1` into child terminal environments. Unset it before running:
```bash
# Bash / Zsh
unset ELECTRON_RUN_AS_NODE
pnpm --filter @agent-music/workstation dev

# PowerShell
$env:ELECTRON_RUN_AS_NODE = $null
pnpm --filter @agent-music/workstation dev
```

---

## Scripts Reference

### Root Workspace

| Command | Description |
| :--- | :--- |
| `pnpm check` | Runs full CI checks (`format:check` + `lint` + `typecheck` + `test`) |
| `pnpm typecheck` | TypeScript type checking across all workspace packages |
| `pnpm lint` | Runs ESLint |
| `pnpm format` | Auto-formats code with Prettier |
| `pnpm test` | Executes workspace test suite via Vitest |

### Workstation (`apps/workstation`)

| Command | Description |
| :--- | :--- |
| `pnpm dev` | Starts Electron workstation in dev mode |
| `pnpm dev:renderer` | Runs only the Vite renderer server |
| `pnpm build` | Production build via electron-vite |
| `pnpm test` | Runs workstation unit and integration tests |
| `pnpm smoke:shell` | Desktop shell smoke test suite |
| `pnpm smoke:spessasynth` | SpessaSynth playback smoke test suite |

---

## Roadmap

- [ ] **Acoustic / Neural Rendering:** Explore pairing Lie's structured ABC harness with open-weights neural acoustic decoders (e.g., yue2) for high-fidelity audio synthesis while maintaining full symbolic control.
- [ ] **LLM-Programmable Timbre & DSP Effects:** Enable the Agent to author and modulate DSP effects (reverbs, delays, distortions, filter chains) directly through natural language.
- [ ] **Hybrid Graphical & Symbolic Editing:** Add interactive **Piano Roll**, **Guitar Tablature**, and **Automation Curves** to the timeline alongside symbolic ABC generation.
- [ ] **Community Style & SoundFont Ecosystem:** Standardize specifications for user-contributed musical style skills and SoundFont (SF2/SFZ) instrument banks.

---

## Contributing

Contributions are welcome! Please ensure:
1. All changes pass `pnpm check`.
2. Any music mutation preserves the canonical ABC invariants and permission boundaries.
3. Commit messages follow conventional commit guidelines.

---

## License

Lie (Music Harness) is licensed under the **Apache License, Version 2.0**. See the [LICENSE](LICENSE) file in the repository root for the full license text.
