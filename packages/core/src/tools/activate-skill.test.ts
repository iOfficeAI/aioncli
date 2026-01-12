/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ActivateSkillTool } from './activate-skill.js';
import { ToolErrorType } from './tool-error.js';
import { getFolderStructure } from '../utils/getFolderStructure.js';
import type { Config } from '../config/config.js';

vi.mock('../utils/getFolderStructure.js', () => ({
  getFolderStructure: vi.fn().mockResolvedValue('mock-structure'),
}));

describe('ActivateSkillTool', () => {
  const skill = {
    name: 'test-skill',
    description: 'Test skill',
    location: '/tmp/skills/test-skill/SKILL.md',
    body: 'Do the thing.',
  };

  const getConfig = () => {
    const skillManager = {
      getSkills: vi.fn().mockReturnValue([skill]),
      getSkill: vi.fn().mockReturnValue(skill),
      activateSkill: vi.fn(),
    };
    const workspaceContext = {
      addDirectory: vi.fn(),
    };
    return {
      getSkillManager: () => skillManager,
      getWorkspaceContext: () => workspaceContext,
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('activates a skill and returns instructions and resources', async () => {
    const config = getConfig() as unknown as Config;
    const tool = new ActivateSkillTool(config);
    const invocation = tool.build({ name: 'test-skill' });
    const result = await invocation.execute(new AbortController().signal);

    expect(config.getSkillManager().activateSkill).toHaveBeenCalledWith(
      'test-skill',
    );
    expect(config.getWorkspaceContext().addDirectory).toHaveBeenCalledWith(
      '/tmp/skills/test-skill',
    );
    expect(getFolderStructure).toHaveBeenCalledWith('/tmp/skills/test-skill');
    expect(String(result.llmContent)).toContain(
      '<activated_skill name="test-skill">',
    );
    expect(String(result.llmContent)).toContain('Do the thing.');
    expect(String(result.returnDisplay)).toContain(
      'Skill **test-skill** activated.',
    );
  });

  it('returns an error when the skill is missing', async () => {
    const config = getConfig() as unknown as Config;
    config.getSkillManager().getSkills.mockReturnValue([]);
    config.getSkillManager().getSkill.mockReturnValue(null);
    const tool = new ActivateSkillTool(config);
    const invocation = tool.build({ name: 'missing' });
    const result = await invocation.execute(new AbortController().signal);

    expect(result.error?.type).toBe(ToolErrorType.INVALID_TOOL_PARAMS);
    expect(String(result.returnDisplay)).toContain(
      'Skill "missing" not found.',
    );
  });
});
