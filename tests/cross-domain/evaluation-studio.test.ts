/**
 * Evaluation Studio API tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('Evaluation Studio', () => {
  it('evaluationService has runTestSet and getRunResults', async () => {
    const { evaluationService } = await import('@domain/pipeline/core/evaluation.service.js');
    expect(typeof evaluationService.runTestSet).toBe('function');
    expect(typeof evaluationService.getRunResults).toBe('function');
  });

  it('evaluation-studio routes are registered', async () => {
    const evaluationStudioRouter = (await import('../../server/routes/evaluation-studio')).default;
    expect(evaluationStudioRouter).toBeDefined();
    expect(evaluationStudioRouter.stack).toBeDefined();
  });

  it('evaluation-studio router has expected routes', async () => {
    const router = (await import('../../server/routes/evaluation-studio')).default;
    const stack = router.stack as Array<{ route?: { path: string; methods?: Record<string, boolean> } }>;
    const paths = stack
      .filter((s) => s.route)
      .map((s) => ({ path: s.route!.path, methods: Object.keys(s.route!.methods || {}) }));
    const pathStrings = paths.map((p) => `${p.methods.join(',')} ${p.path}`).sort();
    expect(pathStrings).toContainEqual(expect.stringContaining('/test-sets'));
    expect(pathStrings.some((p) => p.includes('/cases'))).toBe(true);
    expect(pathStrings.some((p) => p.includes('/run'))).toBe(true);
    expect(pathStrings.some((p) => p.includes('/results'))).toBe(true);
    expect(pathStrings.some((p) => p.includes('/lifecycle'))).toBe(true);
    expect(pathStrings.some((p) => p.includes('/promotion-assessment'))).toBe(true);
    expect(pathStrings.some((p) => p.includes('/promote'))).toBe(true);
  });

  describe('evaluationService.checkRule', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('matches regex criteria', async () => {
      const { evaluationService } = await import('@domain/pipeline/core/evaluation.service.js');
      const rule = {
        id: 1,
        name: 'Test',
        evaluationConfig: { method: 'regex', criteria: 'success|ok' },
      } as any;
      expect(await evaluationService.checkRule(rule, 'The operation was a success')).toBe(true);
      expect(await evaluationService.checkRule(rule, 'Something failed')).toBe(false);
    });

    it('matches keyword criteria', async () => {
      const { evaluationService } = await import('@domain/pipeline/core/evaluation.service.js');
      const rule = {
        id: 1,
        name: 'Test',
        evaluationConfig: { method: 'keyword', criteria: 'error, failed, broken' },
      } as any;
      expect(await evaluationService.checkRule(rule, 'The request failed')).toBe(true);
      expect(await evaluationService.checkRule(rule, 'All good here')).toBe(false);
    });

    it('returns false for unknown method', async () => {
      const { evaluationService } = await import('@domain/pipeline/core/evaluation.service.js');
      const rule = {
        id: 1,
        name: 'Test',
        evaluationConfig: { method: 'unknown', criteria: 'x' },
      } as any;
      expect(await evaluationService.checkRule(rule, 'x')).toBe(false);
    });
  });

  describe('evaluationService.runTestSet and getRunResults', () => {
    it('runTestSet and getRunResults are defined', async () => {
      const { evaluationService } = await import('@domain/pipeline/core/evaluation.service.js');
      expect(typeof evaluationService.runTestSet).toBe('function');
      expect(typeof evaluationService.getRunResults).toBe('function');
    });
  });
});
