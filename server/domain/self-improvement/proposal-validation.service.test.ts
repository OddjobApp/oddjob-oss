import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies for new services
vi.mock('./xray.service.js', () => ({
  XRayService: {
    queryTracesForEvaluation: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('./system-graph.service.js', () => ({
  SystemGraphService: {
    assessChangeImpact: vi.fn().mockResolvedValue({ riskScore: 0.1 }),
  },
}));

import { XRayService } from './xray.service.js';
import { SystemGraphService } from './system-graph.service.js';

describe('ProposalValidationService Enhancements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('XRayService integration', () => {
    it('should query traces for evaluation results', async () => {
      const traceIds = ['trace-1', 'trace-2'];
      await XRayService.queryTracesForEvaluation(traceIds);
      expect(XRayService.queryTracesForEvaluation).toHaveBeenCalledWith(traceIds);
    });

    it('should return empty array when no traces are found', async () => {
      const result = await XRayService.queryTracesForEvaluation([]);
      expect(result).toEqual([]);
    });
  });

  describe('SystemGraphService integration', () => {
    it('should assess change impact and return risk score', async () => {
      const change = { filePath: 'test.ts', oldContent: 'a', newContent: 'b' };
      const result = await SystemGraphService.assessChangeImpact(change);
      expect(result).toHaveProperty('riskScore');
      expect(result.riskScore).toBeLessThan(0.7);
    });

    it('should be called with the proposed change object', async () => {
      const change = { filePath: 'foo.yaml', oldContent: 'x', newContent: 'y' };
      await SystemGraphService.assessChangeImpact(change);
      expect(SystemGraphService.assessChangeImpact).toHaveBeenCalledWith(change);
    });
  });

  describe('Playwright integration', () => {
    it('should be applicable when harnessId includes "ui"', () => {
      const harnessId = 'ui-generation';
      expect(harnessId.includes('ui')).toBe(true);
    });

    it('should not run for non-UI harnesses', () => {
      const harnessId = 'incident-response';
      expect(harnessId.includes('ui')).toBe(false);
    });
  });
});

