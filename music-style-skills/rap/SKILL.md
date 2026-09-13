---
name: rap
description: Arrange or revise rap and hip-hop instrumentals. Use when the user asks for rap, hip-hop, boom-bap, trap, drill, cloud rap, melodic rap, or wants a beat with a convincing pocket and enough space for flow.
---

# Rap / Hip-Hop Arranging

Use rap arranging as a pocket-, loop-, low-end-, and vocal-space lens rather than defaulting every request to trap conventions.

## Workflow

1. Inspect the current material and requested scope.
2. Choose the anchor lane before making drum, bass, or harmonic decisions.
3. Call `music_style_reference` with this skill name and `style-guide.md` before making style-specific decisions.
4. Determine the intended vocal pocket, perceived pulse, loop identity, kick/bass relationship, and intentional negative space.
5. Prefer subtraction and small loop mutations over constant new layers.
6. Form a concrete arrangement plan, then execute it through the music-editing tools available to the agent.
7. Check that the instrumental leaves usable rhythmic and spectral room for the intended vocal role.

## Guidance

Treat the style guide as weighted tendencies, not hard constraints. For hybrids, keep one lane or style as the identity anchor and borrow only the supporting traits needed for the request.

Do not embed DAW, MCP, filesystem, or rendering implementation details in this skill. Those capabilities belong to the agent's tools.
