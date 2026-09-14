# Music Harness

A **local-first, agent-first desktop music creation workstation**. You describe a musical idea in natural language; an agent, constrained by a local MCP tool surface, creates and edits a structured composition. The canonical [ABC](https://abcnotation.com/) file is the single source of truth, from which Standard MIDI, the openDAW runtime state, and audio export are all derived.

> **Status:** early development (`0.0.0`). The P0 product scope and architecture decisions are frozen in [`docs/`](docs/). The desktop shell, music core, timeline UI, and SpessaSynth playback are wired together; the agent runtime (`apps/agent`) is still a stub.

## How it works

- **Electron desktop app** (Windows 10/11 first) with a **React + TypeScript** renderer.
- The renderer talks to a **core service** (a separate child process) over typed IPC — not directly to the filesystem or Git.
- The core service owns the music domain: compositions are stored as a single canonical `composition.abc`, and edits are staged through a **Candidate → Task → Git worktree** transaction model before being accepted as the new `Current`.
- Playback runs in the renderer via **openDAW / SpessaSynth**.
- The **agent service** (planned) will drive edits through a local **MCP** tool surface; it is currently stubbed behind a fake-services flag.

## Repository layout

```
agent-music-workstation/
├── apps/
│   ├── workstation/        # Electron app (main + preload + React renderer)
│   │   └── src/
│   │       ├── main/       # Electron main process, service supervisor
│   │       ├── preload/    # context bridge
│   │       ├── renderer/   # React UI (timeline, transport, agent panel, playback)
│   │       ├── core/       # music domain: project, composition, candidate
│   │       └── shared/     # typed bridges shared across process boundaries
│   └── agent/              # agent runtime (Strands + MCP) — stub for now
└── packages/
    └── contracts/          # cross-boundary domain types & schemas
```

Detailed process/module boundaries are specified in [`docs/architecture/Agent Music Workstation System Architecture.md`](docs/architecture/Agent%20Music%20Workstation%20System%20Architecture.md) and the product scope in [`docs/product/Agent Music Workstation PRD.md`](docs/product/Agent%20Music%20Workstation%20PRD.md).

## Requirements

- **Node.js `>=24 <25`** (see `.node-version`)
- **pnpm `>=9 <10`** (see `package.json` `packageManager`)

## Setup

```bash
pnpm install
```

`engine-strict` is on (`.npmrc`), so the install will refuse to run on the wrong Node version.

The workstation keeps a small pnpm patch for `spessasynth_lib@4.3.14` in
[`patches/spessasynth_lib@4.3.14.patch`](patches/spessasynth_lib@4.3.14.patch).
It reconciles the package's `MIDIData.embeddedSoundBank` declaration with its
`BasicMIDI` base type and does not change runtime code. If TypeScript reports
`MIDIData`/`BasicMIDI` incompatibility after switching branches, reinstall the
workspace with Node 24 so pnpm reapplies the locked patch:

```bash
pnpm install --frozen-lockfile
```

## Running the desktop app

```bash
pnpm --filter @agent-music/workstation dev
# or: cd apps/workstation && pnpm dev
```

This starts electron-vite in dev mode: it builds the main/preload processes, serves the renderer at `http://localhost:5173`, and opens the Electron window.

There are two service-fleet modes, selected by environment variables (see [`service-entry-resolver.ts`](apps/workstation/src/main/service-entry-resolver.ts)):

| Mode | Env vars | core (project) service | agent service |
| --- | --- | --- | --- |
| UI-only (default `dev`) | `AGENT_MUSIC_FAKE_SERVICES=1` | fake stub | fake stub |
| Real core + fake agent | `AGENT_MUSIC_FAKE_AGENT=1` | real project service | fake stub |

The default `dev` script uses `AGENT_MUSIC_FAKE_SERVICES=1`, so **both** services are stubs — the UI renders, but `project.create` and other core commands are silently dropped. To actually create and edit projects, run with the real core:

```bash
# bash / zsh
cd apps/workstation
AGENT_MUSIC_FAKE_AGENT=1 AGENT_MUSIC_INCLUDE_FAKE_SERVICES=1 electron-vite dev

# PowerShell
cd apps/workstation
$env:AGENT_MUSIC_FAKE_AGENT = "1"
$env:AGENT_MUSIC_INCLUDE_FAKE_SERVICES = "1"
electron-vite dev
```

### Known gotcha: VS Code terminal

If you launch the app from VS Code's integrated terminal and get:

```
SyntaxError: The requested module 'electron' does not provide an export named 'BrowserWindow'
```

VS Code exports `ELECTRON_RUN_AS_NODE=1` into the environment, which makes the spawned Electron run in plain-Node mode. Unset it first:

```bash
unset ELECTRON_RUN_AS_NODE   # bash/zsh
# PowerShell: $env:ELECTRON_RUN_AS_NODE = $null
pnpm --filter @agent-music/workstation dev
```

## Scripts

Root:

| Command | What it does |
| --- | --- |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm lint` | ESLint |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm test` | Vitest (workspace) |
| `pnpm check` | format + lint + typecheck + test |

Workstation (`apps/workstation`):

| Command | What it does |
| --- | --- |
| `pnpm dev` | Launch the Electron app in dev mode |
| `pnpm dev:renderer` | Run only the renderer dev server |
| `pnpm build` | Production build via electron-vite |
| `pnpm test` | Unit/integration tests |
| `pnpm smoke:shell` | Desktop-shell smoke test (builds first) |
| `pnpm smoke:spessasynth` | SpessaSynth playback smoke test (builds first) |

## License

Open source, local-first. Compatible with the AGPL distribution model — see the product requirements document for the intended release terms.
