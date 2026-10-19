import { describe, it, expect } from 'vitest';
import { defineSkill, defineTool } from '../packages/agent-sdk/src/index.js';
import { skillRegistryService } from '@domain/knowledge/services/skill-registry.service.js';
import { marketplaceMonetizationService } from '@domain/knowledge/services/marketplace-monetization.service.ts';
import fs from 'fs';
import path from 'path';

describe('Phase 9 Skill Hub & Agent SDK Execution Suite', () => {
  describe('Public Agent SDK (@oddjob/agent-sdk)', () => {
    it('defines custom agent skills and tools via SDK helpers', () => {
      const customTool = defineTool({
        name: 'custom_query_tool',
        description: 'Queries custom database',
        parameters: { type: 'object' },
        execute: async (args) => ({ result: 'ok', args })
      });

      const customSkill = defineSkill({
        name: 'Custom Enterprise Skill',
        description: 'Custom skill built via public Agent SDK',
        version: '1.0.0',
        tools: [customTool],
        handler: async (input) => ({ status: 'completed', input })
      });

      expect(customSkill.name).toBe('Custom Enterprise Skill');
      expect(customSkill.tools).toHaveLength(1);
      expect(customSkill.tools![0].name).toBe('custom_query_tool');
    });
  });

  describe('Skill Registry Service', () => {
    it('searches community skills by keyword and tag', () => {
      const results = skillRegistryService.searchRegistry('Kubernetes');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('k8s-manifest-generator');
    });

    it('installs a skill from the registry into .agent/skills/', () => {
      const skill = skillRegistryService.installSkill('k8s-manifest-generator');
      expect(skill.isInstalled).toBe(true);

      const installedPath = path.join(process.cwd(), '.agent', 'skills', 'k8s-manifest-generator', 'SKILL.md');
      expect(fs.existsSync(installedPath)).toBe(true);

      // Cleanup installed test skill
      fs.rmSync(path.dirname(installedPath), { recursive: true, force: true });
    });
  });

  describe('Marketplace Monetization Service', () => {
    it('meters skill usage and calculates token execution costs', () => {
      const usage = marketplaceMonetizationService.recordUsage('sec-auditor-v1', 101, 10000);
      expect(usage.executionsCount).toBe(1);
      expect(usage.totalTokensUsed).toBe(10000);
      expect(usage.estimatedCostUsd).toBe(0.02);

      const analytics = marketplaceMonetizationService.getSkillAnalytics('sec-auditor-v1');
      expect(analytics).toHaveLength(1);
    });
  });
});
