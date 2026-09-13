import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { tool } from '@strands-agents/sdk';
import { AgentSkills, Skill } from '@strands-agents/sdk/vended-plugins/skills';
import { z } from 'zod';

export const MUSIC_STYLE_SKILL_NAMES = [
  'shoegaze',
  'midwest-emo',
  'metal',
  'post-rock',
  'pop',
  'rap',
] as const;

type MusicStyleSkillName = (typeof MUSIC_STYLE_SKILL_NAMES)[number];

const SKILL_DIRECTORY_BY_NAME: Record<MusicStyleSkillName, string> = {
  shoegaze: 'shoegaze',
  'midwest-emo': 'midwest-emo',
  metal: 'metal',
  'post-rock': 'post-rock',
  pop: 'pop',
  rap: 'rap',
};

export const MUSIC_STYLE_SKILLS_ROOT = fileURLToPath(
  new URL('../../../../music-style-skills/', import.meta.url),
);

export const loadMusicStyleSkills = (): Skill[] =>
  Skill.fromDirectory(MUSIC_STYLE_SKILLS_ROOT, { strict: true });

export const createMusicStyleSkillsPlugin = (): AgentSkills =>
  new AgentSkills({
    skills: [MUSIC_STYLE_SKILLS_ROOT],
    strict: true,
  });

const styleNameSchema = z.enum(MUSIC_STYLE_SKILL_NAMES);

export const createMusicStyleReferenceTool = () =>
  tool({
    name: 'music_style_reference',
    description:
      'Read a reference file belonging to an activated packaged music-style skill. ' +
      'Use only when that skill instructs you to load one of its references.',
    inputSchema: z.object({
      skill_name: styleNameSchema,
      resource: z
        .string()
        .min(1)
        .describe(
          'Reference filename listed by the activated skill, for example style-guide.md',
        ),
    }),
    callback: async ({ skill_name, resource }) => {
      if (
        basename(resource) !== resource ||
        resource === '.' ||
        resource === '..'
      ) {
        throw new Error('Invalid music style reference resource name.');
      }

      const skillDirectory = SKILL_DIRECTORY_BY_NAME[skill_name];
      const referencePath = join(
        MUSIC_STYLE_SKILLS_ROOT,
        skillDirectory,
        'references',
        resource,
      );

      try {
        return await readFile(referencePath, 'utf8');
      } catch (error) {
        throw new Error(
          `Unable to read music style reference '${resource}' for '${skill_name}'.`,
          { cause: error },
        );
      }
    },
  });
