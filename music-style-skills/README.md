# Music Style Skills

A standalone Agent Skill library for style-aware composition and arrangement in Agent Music Workstation.

Each style is packaged as an independent standard skill directory. The top-level `SKILL.md` contains only invocation metadata, workflow, and reference routing. Detailed genre knowledge lives under `references/` and is loaded only when needed.

## Included skills

- `shoegaze/`
- `midwest-emo/`
- `metal/`
- `post-rock/`
- `pop/`
- `rap/`

## Package contract

Each style follows this shape:

```text
<style>/
  SKILL.md
  references/
    style-guide.md
```

`SKILL.md` must contain YAML frontmatter with at least:

```yaml
---
name: style-<name>
description: <model-facing trigger description>
---
```

The skill body should:

1. define a short execution workflow;
2. point to `references/style-guide.md` before style-specific decisions;
3. preserve existing musical material when it already serves the requested direction;
4. keep style knowledge separate from DAW, MCP, filesystem, rendering, or export implementation details.

## Design principle

A style is not a fixed recipe. Each skill describes a **style centroid**: a cluster of musical decisions that commonly makes a piece read as that genre. Treat rules as weighted tendencies rather than hard constraints.

The skills distinguish **identity-bearing structure** from surface descriptors. Shoegaze is not simply “guitar + reverb,” post-rock is not simply “slow + crescendo,” metal is not simply “distortion + minor key,” and rap is not simply “808 + hi-hat.”

For hybrids, keep one style as the form/identity anchor and borrow only the signature variables needed from supporting styles. Avoid averaging every trait from both genres.

When the user cites an artist or track, translate the reference into craft variables such as groove, harmonic density, guitar language, vocal role, arrangement density, form pacing, energy curve, and production-era cues. Do not reproduce recognizable melodies, riffs, lyrics, samples, or a specific vocal identity.

## Runtime expectation

The Agent runtime should discover these directories as individual skills and expose only their metadata until a skill is invoked. The skill provides arranging knowledge; project inspection and modification remain the responsibility of the Agent's music tools.

## Verification and quality gate

Any changes or additions to Agent Skills must pass the full workspace gate:

```bash
pnpm check
```

Do not rely only on package-local test/typecheck (e.g. `pnpm --filter @agent-music/agent test`), as workspace-level ESLint rules (such as `restrict-template-expressions`, `no-unnecessary-condition`, and `no-misused-promises`) and Prettier formatting are enforced across all test and runtime code at the root level.

## Scope

These files describe durable genre conventions, not live scene trends. Current microgenre terminology and current artist/production trends should be verified separately when freshness matters.

See `SOURCES.md` for open-source research inputs and attribution.
