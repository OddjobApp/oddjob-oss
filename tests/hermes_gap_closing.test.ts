import { describe, it, expect } from 'vitest';
import { parseReasoningTokens } from '@domain/xray/listeners/xray-event-listener.js';
import { SkillSynthesisService } from '@domain/knowledge/services/skill-synthesis.service.js';
import fs from 'fs';
import path from 'path';

describe('Hermes AI Gap-Closing Features', () => {
  describe('Open-Weight Reasoning Token Parser', () => {
    it('extracts <THINKING> and <PLAN> tags cleanly from model output', () => {
      const rawOutput = `
        <THINKING>
        Analyzing database query performance for large index updates.
        </THINKING>
        <PLAN>
        1. Add CONCURRENTLY flag to index creation.
        2. Verify execution time under 50ms.
        </PLAN>
        I have analyzed the query and recommended the index creation plan.
      `;

      const steps = parseReasoningTokens(rawOutput);
      expect(steps).toHaveLength(2);
      expect(steps[0]).toEqual({
        type: 'thinking',
        content: 'Analyzing database query performance for large index updates.'
      });
      expect(steps[1]).toEqual({
        type: 'plan',
        content: '1. Add CONCURRENTLY flag to index creation.\n        2. Verify execution time under 50ms.'
      });
    });

    it('returns empty array if no reasoning tags are present', () => {
      const steps = parseReasoningTokens('Plain text output without XML tags.');
      expect(steps).toHaveLength(0);
    });
  });

  describe('Skill Synthesis Service', () => {
    it('synthesizes a new skill into .agent/skills/ directory', async () => {
      const skillName = 'Test Auto Synthesized Skill';
      const result = await SkillSynthesisService.synthesizeSkill({
        skillName,
        description: 'Autonomously generated test skill for verifying synthesis service.',
        instructions: '1. Execute step A.\n2. Execute step B.',
        tags: ['test', 'synthesis']
      });

      expect(fs.existsSync(result.skillPath)).toBe(true);
      const content = fs.readFileSync(result.skillPath, 'utf-8');
      expect(content).toContain('name: "Test Auto Synthesized Skill"');
      expect(content).toContain('Autonomously generated test skill');

      // Cleanup test file
      fs.rmSync(path.dirname(result.skillPath), { recursive: true, force: true });
    });
  });
});
