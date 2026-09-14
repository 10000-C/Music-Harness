---
name: midwest-emo
description: Arrange or revise music using Midwest emo conventions. Use when the user asks for Midwest emo, twinkly emo, math-rock-adjacent emo, or wants intimate interlocking guitar writing and dynamic catharsis.
---

# Midwest Emo Arranging

Use Midwest emo as an arranging and composition lens centered on guitar conversation, voicing, phrasing, and cathartic contrast.

## Workflow

1. Inspect the current material and requested scope.
2. Identify which dimensions need style-specific work: guitar interplay, voicing and voice-leading, rhythmic phrasing, bass/drum interaction, or dynamic architecture.
3. Call `music_style_reference` with this skill name and `style-guide.md` before making style-specific decisions.
4. Preserve memorable existing motifs and avoid adding complexity that does not strengthen the phrase.
5. Form a concrete arrangement plan, then execute it through the music-editing tools available to the agent.
6. Check that the result remains identifiable without relying on stereotypical tapping or effect choices.

## Guidance

Treat the style guide as weighted tendencies, not hard constraints. For hybrids, keep one style as the identity anchor and borrow only the supporting traits needed for the request.

Do not embed DAW, MCP, filesystem, or rendering implementation details in this skill. Those capabilities belong to the agent's tools.
