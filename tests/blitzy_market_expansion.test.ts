import { describe, it, expect } from 'vitest';
import { deepBatchRunnerService } from '@domain/swarm/services/deep-batch-runner.service.js';
import { legacyCodebaseParserService } from '@domain/knowledge/services/legacy-codebase-parser.service.js';
import { automatedPrSynthesizerService } from '@domain/swarm/services/automated-pr-synthesizer.service.js';

describe('Blitzy Market Expansion Suite (Legacy Modernization & Deep Batch Engine)', () => {
  describe('Deep Batch Runner Service', () => {
    it('schedules a long-running System 2 batch job', () => {
      const job = deepBatchRunnerService.scheduleDeepBatchJob({
        jobName: 'COBOL to TypeScript Migration Job',
        targetRepository: 'legacy-core-banking',
        sourceStack: 'COBOL',
        targetStack: 'TypeScript_Node',
        estimatedDurationHours: 8
      });

      expect(job.jobId).toMatch(/^batch_/);
      expect(job.status).toBe('queued');
      expect(job.totalFiles).toBeGreaterThan(0);

      const status = deepBatchRunnerService.getJobStatus(job.jobId);
      expect(status).toBeDefined();
      expect(status?.jobName).toBe('COBOL to TypeScript Migration Job');
    });
  });

  describe('Legacy Codebase Parser Service', () => {
    it('reverse-engineers COBOL & C# files into Graph RAG AST nodes', () => {
      const parseResult = legacyCodebaseParserService.parseLegacyCodebase('banking-legacy', [
        { path: 'src/ACCOUNT-PROC.cbl', content: 'IDENTIFICATION DIVISION.\nPROGRAM-ID. ACCOUNT-PROC.\nPROCEDURE DIVISION.' },
        { path: 'src/OrderService.cs', content: 'namespace Core { public class OrderService { } }' }
      ]);

      expect(parseResult.totalLinesOfCode).toBe(4);
      expect(parseResult.extractedAstNodes.length).toBe(2);
      expect(parseResult.extractedAstNodes[0].legacyLanguage).toBe('COBOL');
      expect(parseResult.extractedAstNodes[1].legacyLanguage).toBe('C#');
    });
  });

  describe('Automated PR Synthesizer Service', () => {
    it('packages batch edits into a clean Pull Request manifest', () => {
      const pr = automatedPrSynthesizerService.synthesizePullRequest('banking-legacy', 'Migrate COBOL Account Processor to TypeScript', [
        { filePath: 'server/services/account.service.ts', action: 'create', content: 'export class AccountService {}' }
      ]);

      expect(pr.prNumber).toBeGreaterThan(0);
      expect(pr.branchName).toMatch(/^oddjob\/refactor-/);
      expect(pr.compilationVerified).toBe(true);
      expect(pr.unitTestsPassed).toBe(true);
      expect(pr.pullRequestUrl).toContain('github.com');
    });
  });
});
