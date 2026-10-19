import fs from 'fs';
import path from 'path';
import { createLogger } from '@server/utils/logger.js';

const logger = createLogger('SkillRegistryService');

export interface RegistrySkill {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  tags: string[];
  isInstalled: boolean;
  installCount: number;
}

export class SkillRegistryService {
  private registryCatalog = new Map<string, RegistrySkill>([
    [
      'sec-auditor-v1',
      {
        id: 'sec-auditor-v1',
        name: 'Automated Vulnerability & Dependency Auditor',
        description: 'Performs SAST code scans and dependency vulnerability auditing.',
        version: '1.2.0',
        author: 'Oddjob Security Core',
        tags: ['security', 'sast', 'audit'],
        isInstalled: true,
        installCount: 1450
      }
    ],
    [
      'k8s-manifest-generator',
      {
        id: 'k8s-manifest-generator',
        name: 'Kubernetes Helm & Manifest Synthesizer',
        description: 'Generates production K8s Helm charts and HPA manifests from app architecture.',
        version: '2.0.1',
        author: 'CloudNative Labs',
        tags: ['k8s', 'helm', 'devops'],
        isInstalled: false,
        installCount: 920
      }
    ],
    [
      'jira-sprint-planner',
      {
        id: 'jira-sprint-planner',
        name: 'Jira Sprint & Epic Synthesizer',
        description: 'Decomposes high-level requirement epics into estimated Jira user stories.',
        version: '1.1.0',
        author: 'Agile Swarm Team',
        tags: ['jira', 'agile', 'pm'],
        isInstalled: true,
        installCount: 2300
      }
    ]
  ]);

  /**
   * Search available community and enterprise skills in the registry.
   */
  searchRegistry(query?: string, tag?: string): RegistrySkill[] {
    logger.info(`Searching Skill Registry [query: '${query || ''}', tag: '${tag || ''}']`);
    const all = Array.from(this.registryCatalog.values());

    return all.filter(s => {
      const matchQuery = !query || s.name.toLowerCase().includes(query.toLowerCase()) || s.description.toLowerCase().includes(query.toLowerCase());
      const matchTag = !tag || s.tags.includes(tag.toLowerCase());
      return matchQuery && matchTag;
    });
  }

  /**
   * 1-Click Installs a skill from the registry into local .agent/skills/ directory.
   */
  installSkill(skillId: string): RegistrySkill {
    const skill = this.registryCatalog.get(skillId);
    if (!skill) {
      throw new Error(`Skill '${skillId}' not found in registry.`);
    }

    logger.info(`Installing skill '${skill.name}' (${skillId}) into local workspace...`);
    const targetDir = path.join(process.cwd(), '.agent', 'skills', skillId);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const skillMdContent = [
      '---',
      `name: "${skill.name}"`,
      `description: "${skill.description}"`,
      `version: "${skill.version}"`,
      `author: "${skill.author}"`,
      `tags: [${skill.tags.map(t => `"${t}"`).join(', ')}]`,
      '---',
      '',
      `# ${skill.name}`,
      '',
      skill.description,
      '',
      `## Installed Instructions`,
      `Installed autonomously via Oddjob Skill Registry.`
    ].join('\n');

    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), skillMdContent, 'utf-8');

    skill.isInstalled = true;
    skill.installCount += 1;

    return skill;
  }
}

export const skillRegistryService = new SkillRegistryService();
