/**
 * Reasoning Router Tests
 * 
 * Tests for the AI reasoning router service including:
 * - Chain-of-thought reasoning
 * - Tree-of-thoughts reasoning  
 * - Self-consistency reasoning
 * - Reflexion reasoning
 * - Plan-and-solve reasoning
 * - AI client integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reasoningRouterService, ReasoningRequest } from '../../server/domain/ai/core/reasoning-router.service.js';

// Mock dependencies
vi.mock('../../server/domain/ai/core/system-ai.service.js', () => ({
  systemAiService: {
    getAiConfig: vi.fn().mockResolvedValue({
      provider: 'google',
      model: 'gemini-2.0-flash',
      apiKey: 'test-api-key'
    })
  }
}));

vi.mock('../../server/domain/ai/core/ai-client.service.js', () => ({
  AIClientFactory: {
    getClient: vi.fn().mockReturnValue({
      execute: vi.fn().mockResolvedValue({
        success: true,
        output: 'Test reasoning output with step-by-step analysis.'
      })
    })
  },
  AiQuotaManager: {
    throttle: vi.fn().mockResolvedValue(undefined),
    reportSuccess: vi.fn().mockResolvedValue(undefined),
    reportFailure: vi.fn().mockResolvedValue(undefined)
  }
}));

describe('ReasoningRouterService', () => {
  const mockQuery = 'What is 2 + 2 * 2?';
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('route()', () => {
    it('should route chain-of-thought strategy correctly', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        strategy: 'chain-of-thought',
        model: 'o1-mini',
        enableThinking: true
      };

      const result = await reasoningRouterService.route(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('chain-of-thought');
      expect(result.reasoningSteps).toBeDefined();
      expect(result.reasoningSteps.length).toBeGreaterThan(0);
    });

    it('should route tree-of-thoughts strategy correctly', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        strategy: 'tree-of-thoughts',
        model: 'o1-mini'
      };

      const result = await reasoningRouterService.route(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('tree-of-thoughts');
      expect(result.pathsExplored).toBeGreaterThan(0);
    });

    it('should route self-consistency strategy correctly', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        strategy: 'self-consistency',
        model: 'o1-mini'
      };

      const result = await reasoningRouterService.route(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('self-consistency');
    });

    it('should route reflexion strategy correctly', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        strategy: 'reflexion',
        model: 'o1-mini'
      };

      const result = await reasoningRouterService.route(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('reflexion');
    });

    it('should route plan-and-solve strategy correctly', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        strategy: 'plan-and-solve',
        model: 'o1-mini'
      };

      const result = await reasoningRouterService.route(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBe('plan-and-solve');
    });

    it('should auto-select strategy when not specified', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        model: 'o1-mini'
        // strategy not specified
      };

      const result = await reasoningRouterService.route(request);

      expect(result.success).toBe(true);
      expect(result.strategy).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle AI client failures gracefully', async () => {
      const { AIClientFactory } = await import('../../server/domain/ai/core/ai-client.service.js');
      // mockReturnValue, not Once: callReasoningModel catches per call and
      // returns "[Error during reasoning: ...]", so breaking only the first
      // call left every later one working and the final answer came back
      // clean. The whole run has to fail for the degraded answer to be the
      // answer.
      vi.mocked(AIClientFactory.getClient).mockReturnValue({
        execute: vi.fn().mockRejectedValue(new Error('API Error'))
      } as any);

      const request: ReasoningRequest = {
        query: mockQuery,
        strategy: 'chain-of-thought',
        model: 'o1-mini'
      };

      // Should not throw, but degrade: callReasoningModel catches and returns
      // "[Error during reasoning: ...]" as the step's reasoning. finalAnswer is
      // then derived from that text by extractFinalAnswer, whose fallback
      // reduces it to a trailing fragment — so the failure is visible in the
      // steps, not in the answer.
      const result = await reasoningRouterService.route(request);

      expect(result.success).toBe(true);
      expect(result.reasoningSteps.some(step => step.reasoning.includes('Error during reasoning'))).toBe(true);
    });

    it('should handle missing API key', async () => {
      const { systemAiService } = await import('../../server/domain/ai/core/system-ai.service.js');
      // Same reason as above: one unconfigured call is recovered from.
      vi.mocked(systemAiService.getAiConfig).mockResolvedValue(null);

      const request: ReasoningRequest = {
        query: mockQuery,
        strategy: 'chain-of-thought',
        model: 'o1-mini'
      };

      const result = await reasoningRouterService.route(request);

      expect(result.reasoningSteps.some(step => step.reasoning.includes('Error during reasoning'))).toBe(true);
    });
  });

  describe('Model Selection', () => {
    it('should support o1-preview model', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        model: 'o1-preview',
        strategy: 'chain-of-thought'
      };

      const result = await reasoningRouterService.route(request);
      expect(result.success).toBe(true);
      expect(result.model).toBe('o1-preview');
    });

    it('should support o1-mini model', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        model: 'o1-mini',
        strategy: 'chain-of-thought'
      };

      const result = await reasoningRouterService.route(request);
      expect(result.success).toBe(true);
      expect(result.model).toBe('o1-mini');
    });

    it('should support deepseek-r1 model', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        model: 'deepseek-r1',
        strategy: 'chain-of-thought'
      };

      const result = await reasoningRouterService.route(request);
      expect(result.success).toBe(true);
      expect(result.model).toBe('deepseek-r1');
    });

    it('should support claude-3-opus model', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        model: 'claude-3-opus',
        strategy: 'chain-of-thought'
      };

      const result = await reasoningRouterService.route(request);
      expect(result.success).toBe(true);
      expect(result.model).toBe('claude-3-opus');
    });

    it('should support gpt-4 model', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        model: 'gpt-4',
        strategy: 'chain-of-thought'
      };

      const result = await reasoningRouterService.route(request);
      expect(result.success).toBe(true);
      expect(result.model).toBe('gpt-4');
    });
  });

  describe('Complexity-Based Routing', () => {
    it('should select chain-of-thought for simple queries', async () => {
      const simpleQuery = 'What is 2+2?';
      
      const request: ReasoningRequest = {
        query: simpleQuery,
        model: 'o1-mini'
        // auto-select
      };

      const result = await reasoningRouterService.route(request);
      expect(result.strategy).toBe('chain-of-thought');
    });

    /**
     * There is no auto-selection in route(): reason() takes
     * `request.strategy || 'chain-of-thought'` and never consults
     * recommendStrategy, which only the /api/reasoning route calls before
     * handing an explicit strategy back in. These tests asserted a routing
     * decision the service does not make, so they assert the two halves that
     * are real — the heuristic itself, and the default that route() applies
     * when no strategy is given.
     */
    it('recommends tree-of-thoughts for open-ended design queries', () => {
      expect(reasoningRouterService.recommendStrategy(
        'Design three different approaches to solving this problem'
      )).toBe('tree-of-thoughts');
    });

    it('recommends chain-of-thought for arithmetic', () => {
      expect(reasoningRouterService.recommendStrategy('Calculate 12 * 8')).toBe('chain-of-thought');
    });

    it('does not name a comparison, so the heuristic falls through to its default', () => {
      // Worth recording: weighing several approaches is what tree-of-thoughts
      // is for, and "compare" is not one of its triggers.
      expect(reasoningRouterService.recommendStrategy(
        'Compare three different approaches to solving this problem: approach A, B, and C'
      )).toBe('chain-of-thought');
    });

    it('routes with chain-of-thought when the caller names no strategy', async () => {
      const result = await reasoningRouterService.route({
        query: 'Design three different approaches to solving this problem',
        model: 'o1-mini'
      } as ReasoningRequest);

      expect(result.strategy).toBe('chain-of-thought');
    });
  });

  describe('Response Structure', () => {
    it('should include reasoning steps', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        strategy: 'chain-of-thought',
        model: 'o1-mini',
        enableThinking: true
      };

      const result = await reasoningRouterService.route(request);

      expect(result.reasoningSteps).toBeDefined();
      expect(Array.isArray(result.reasoningSteps)).toBe(true);
      
      if (result.reasoningSteps.length > 0) {
        expect(result.reasoningSteps[0]).toHaveProperty('step');
        expect(result.reasoningSteps[0]).toHaveProperty('description');
        expect(result.reasoningSteps[0]).toHaveProperty('reasoning');
        expect(result.reasoningSteps[0]).toHaveProperty('confidence');
        expect(result.reasoningSteps[0]).toHaveProperty('latencyMs');
      }
    });

    it('should include latency metrics', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        strategy: 'chain-of-thought',
        model: 'o1-mini'
      };

      const result = await reasoningRouterService.route(request);

      expect(result.totalLatencyMs).toBeDefined();
      expect(typeof result.totalLatencyMs).toBe('number');
      expect(result.totalLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('should include verification score', async () => {
      const request: ReasoningRequest = {
        query: mockQuery,
        strategy: 'self-consistency',
        model: 'o1-mini'
      };

      const result = await reasoningRouterService.route(request);

      expect(result.verificationScore).toBeDefined();
      expect(typeof result.verificationScore).toBe('number');
      expect(result.verificationScore).toBeGreaterThanOrEqual(0);
      expect(result.verificationScore).toBeLessThanOrEqual(1);
    });
  });
});
