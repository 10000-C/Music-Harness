---
name: post-rock
description: Arrange or revise music using post-rock conventions. Use when the user asks for post-rock, cinematic or atmospheric instrumental rock, long-form crescendo writing, or motif-driven rock that develops through texture and dynamics rather than conventional song hooks.
---

# Post-Rock Arranging

Use post-rock as a motif-development and long-range dynamic-architecture lens, not as a delay-and-crescendo preset.

## Workflow

1. Inspect the current material and requested scope.
2. Identify the seed motif and the intended long-range energy shape.
3. Call `music_style_reference` with this skill name and `style-guide.md` before making style-specific decisions.
4. Decide which dimensions should evolve: motif role, register, density, articulation, rhythmic weight, drum entry, harmony, or texture.
5. Preserve meaningful repetition and change context rather than adding novelty by default.
6. Form a concrete arrangement plan, then execute it through the music-editing tools available to the agent.
7. Check that the form has an intelligible transformation arc rather than only “quiet → loud.”

## Guidance

Treat the style guide as weighted tendencies, not hard constraints. For hybrids, keep one style as the identity anchor and borrow only the supporting traits needed for the request.

Do not embed DAW, MCP, filesystem, or rendering implementation details in this skill. Those capabilities belong to the agent's tools.
