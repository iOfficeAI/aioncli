/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { loadSkillsFromDir } from './skillLoader.js';

describe('loadSkillsFromDir', () => {
  it('loads skills from SKILL.md frontmatter', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skills-'));
    const skillDir = path.join(root, 'demo-skill');
    await fs.mkdir(skillDir, { recursive: true });
    const skillPath = path.join(skillDir, 'SKILL.md');
    await fs.writeFile(
      skillPath,
      `---
name: demo-skill
description: Demo description
---
Skill body here.`,
      'utf8',
    );

    const skills = await loadSkillsFromDir(root);
    expect(skills).toHaveLength(1);
    expect(skills[0]?.name).toBe('demo-skill');
    expect(skills[0]?.description).toBe('Demo description');
    expect(skills[0]?.body).toBe('Skill body here.');
    expect(skills[0]?.location).toBe(skillPath);
  });
});
