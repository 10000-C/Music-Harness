import { describe, expect, it } from 'vitest';

import {
  MUSIC_STYLE_SKILL_NAMES,
  createMusicStyleReferenceTool,
  loadMusicStyleSkills,
} from './music-style-skills.js';

describe('music style skills', () => {
  it('loads all six style packages with the Strands strict parser', () => {
    const skills = loadMusicStyleSkills();

    expect(skills.map((skill) => skill.name).sort()).toEqual(
      [...MUSIC_STYLE_SKILL_NAMES].sort(),
    );
    expect(skills).toHaveLength(6);
    for (const skill of skills) {
      expect(skill.description.length).toBeGreaterThan(20);
      expect(skill.instructions).toContain('music_style_reference');
    }
  });

  it('reads only a packaged reference on demand', async () => {
    const tool = createMusicStyleReferenceTool();
    const result = await tool.invoke({
      skill_name: 'shoegaze',
      resource: 'style-guide.md',
    });

    expect(result).toContain('# Shoegaze Style Guide');
    expect(result).toContain('Aesthetic center');
  });

  it('rejects traversal outside a skill references directory', async () => {
    const tool = createMusicStyleReferenceTool();

    await expect(
      tool.invoke({
        skill_name: 'shoegaze',
        resource: '../SKILL.md',
      }),
    ).rejects.toThrow(/resource/i);
  });
});
