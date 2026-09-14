---
name: shoegaze
description: Arrange or revise music using shoegaze conventions. Use when the user asks for shoegaze, dream-pop-adjacent wall-of-sound guitar music, or wants an existing idea to feel more shoegaze without merely adding reverb.
---

# Shoegaze Arranging

Use shoegaze as an arranging and composition lens, not as an effects preset.

## Workflow

1. Inspect the existing musical material and the requested scope.
2. Decide which identity-bearing dimensions actually need change: texture, guitar articulation, harmonic pacing, density/register, rhythm-section clarity, vocal role, or form.
3. Call `music_style_reference` with this skill name and `style-guide.md` before making style-specific decisions.
4. Preserve strong existing material that already supports the requested direction.
5. Form a concrete arrangement plan, then execute it through the music-editing tools available to the agent.
6. Check that the result reads as shoegaze from composition and arrangement choices, not only from effect labels.

## Guidance

Treat the style guide as weighted tendencies, not hard constraints. For hybrids, keep one style as the identity anchor and borrow only the supporting traits needed for the request.

Do not embed DAW, MCP, filesystem, or rendering implementation details in this skill. Those capabilities belong to the agent's tools.
