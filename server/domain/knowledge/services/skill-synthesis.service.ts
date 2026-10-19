import fs from 'fs';
import path from 'path';
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('SkillSynthesisService');

export interface SkillSynthesisParams {
  skillName: string;
  description: string;
  instructions: string;
  tags?: string[];
  authorAgentId?: number;
}

export class SkillSynthesisService {
  /**
   * Distills a successful agent workflow execution into a persistent SKILL.md file
   * in the .agent/skills/<skill_name>/ directory.
   */
  static async synthesizeSkill(params: SkillSynthesisParams): Promise<{ skillPath: string }> {
    const sanitizedName = params.skillName.toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    const targetDir = path.join(process.cwd(), '.agent', 'skills', sanitizedName);
    const targetFilePath = path.join(targetDir, 'SKILL.md');

    logger.info(`Synthesizing new skill '${sanitizedName}' at ${targetFilePath}`);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const yamlFrontmatter = [
      '---',
      `name: "${params.skillName}"`,
      `description: "${params.description.replace(/"/g, '\\"')}"`,
      `tags: [${(params.tags || ['synthesized', 'autonomous']).map(t => `"${t}"`).join(', ')}]`,
      `synthesizedAt: "${new Date().toISOString()}"`,
      `authorAgentId: ${params.authorAgentId || 1}`,
      '---'
    ].join('\n');

    const markdownBody = [
      `# ${params.skillName}`,
      '',
      `## Overview`,
      params.description,
      '',
      `## Execution Instructions`,
      params.instructions,
      '',
      `---`,
      `*Note: This skill was autonomously synthesized from a successful execution cycle in Oddjob.*`
    ].join('\n');

    const fullSkillContent = `${yamlFrontmatter}\n\n${markdownBody}\n`;

    fs.writeFileSync(targetFilePath, fullSkillContent, 'utf-8');
    logger.info(`Successfully wrote synthesized skill to ${targetFilePath}`);

    return { skillPath: targetFilePath };
  }
}
