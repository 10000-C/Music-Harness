---
name: metal
description: Arrange or revise music using metal conventions. Use when the user asks for metal or a metal-adjacent arrangement; first identify the intended metal lane because riff grammar, tempo, harmony, and form differ sharply across subgenres.
---

# Metal Arranging

Use metal as a riff-, rhythm-, and energy-architecture lens rather than a generic distortion preset.

## Workflow

1. Inspect the current material and requested scope.
2. Identify the anchor lane before making strong stylistic decisions.
3. Call `music_style_reference` with this skill name and `style-guide.md` before making style-specific decisions.
4. Decide which identity-bearing dimensions need change: riff rhythm/articulation, tuning and register, guitar-bass-kick coordination, section contrast, pitch language, or form.
5. Preserve strong existing riffs and avoid adding density that weakens physical impact.
6. Form a concrete arrangement plan, then execute it through the music-editing tools available to the agent.
7. Check that the result is stylistically coherent for the chosen lane rather than an average of unrelated metal subgenres.

## Guidance

Treat the style guide as weighted tendencies, not hard constraints. For hybrids, keep one lane or style as the identity anchor and borrow only the supporting traits needed for the request.

Do not embed DAW, MCP, filesystem, or rendering implementation details in this skill. Those capabilities belong to the agent's tools.
