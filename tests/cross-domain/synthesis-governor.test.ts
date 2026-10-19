/**
 * Synthesis Governor Tests
 * 
 * Tests for the Pentagonal OODA 5th phase (Synthesize/Conclude) including:
 * - Outcome analysis
 * - Pattern extraction
 * - Knowledge capture
 * - Conclusion determination
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInfrastructure = vi.hoisted(() => {
  const dbQuery = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
    values: vi.fn().mockResolvedValue([]),
    returning: vi.fn().mockResolvedValue([]),
    from: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockResolvedValue([]),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
    then: (onFulfilled: (value: unknown[]) => unknown) => Promise.resolve([]).then(onFulfilled),
    catch: (onRejected: (reason: unknown) => unknown) => Promise.resolve([]).catch(onRejected),
  };

  const redis = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue('OK'),
  };

  return {
    db: {
      update: vi.fn(() => dbQuery),
      insert: vi.fn(() => dbQuery),
      select: vi.fn(() => dbQuery),
      query: {},
    },
    pool: {
      on: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ rows: [] }),
    },
    redis,
    recordMissionOutcome: vi.fn().mockResolvedValue(undefined),
    recordPerformance: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('pg', () => ({
  Pool: vi.fn(() => mockInfrastructure.pool),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => mockInfrastructure.redis),
}));

vi.mock('@server/database_service.js', () => ({
  db: mockInfrastructure.db,
  pool: mockInfrastructure.pool,
  checkDatabaseConnection: vi.fn().mockResolvedValue({ connected: true }),
}));

vi.mock('@server/utils/logger.js', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({
  redis: mockInfrastructure.redis,
  subscriber: mockInfrastructure.redis,
  publisher: mockInfrastructure.redis,
  nodeRedisClient: mockInfrastructure.redis,
  redisService: {
    client: mockInfrastructure.redis,
    subscriber: mockInfrastructure.redis,
    publisher: mockInfrastructure.redis,
    getOptions: () => ({ host: 'localhost', port: 6379 }),
  },
  redisManager: {
    client: mockInfrastructure.redis,
    subscriber: mockInfrastructure.redis,
    publisher: mockInfrastructure.redis,
    getOptions: () => ({ host: 'localhost', port: 6379 }),
  },
  getRedisClient: () => mockInfrastructure.redis,
  getRedisOptions: () => ({ host: 'localhost', port: 6379 }),
}));

vi.mock('../../server/domain/learning/core/institutional-memory.service.js', () => ({
  institutionalMemoryService: {
    recordMissionOutcome: mockInfrastructure.recordMissionOutcome,
  },
}));

vi.mock('../../server/domain/agents/core/ml-strategy-predictor/strategy-ml.service.js', () => ({
  strategyMLService: {
    recordPerformance: mockInfrastructure.recordPerformance,
  },
}));

vi.mock('../../server/domain/ai/core/system-ai.service.js', () => ({
  systemAiService: {
    getAiConfig: vi.fn().mockResolvedValue({ provider: 'google', model: 'gemini-2.0-flash', apiKey: 'test-key' }),
  },
}));

vi.mock('@domain/ai/core/ai-client.service.js', () => ({
  AIClientFactory: {
    getClient: vi.fn(() => ({
      execute: vi.fn().mockResolvedValue({ success: true, output: '{}' }),
    })),
  },
}));

vi.mock('../../server/domain/ai/core/reasoning-router.service.js', () => ({
  reasoningRouterService: {
    route: vi.fn(),
  },
}));

describe('SynthesisGovernorService', () => {
  let synthesisService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const module = await import('../../server/domain/mission/core/synthesis-governor.service.js');
    synthesisService = module.synthesisGovernorService;
  });

  describe('synthesize()', () => {
    it('should complete full synthesis pipeline', async () => {
      const context = {
        missionRunId: 123,
        missionId: 456,
        objective: 'Complete data analysis task',
        blackboard: { result: 'Analysis complete' },
        executionTrace: [
          { cycle: 1, action: 'fetch_data', result: 'success', latencyMs: 1000 },
          { cycle: 2, action: 'analyze', result: 'success', latencyMs: 2000 }
        ],
        budgetUsed: 10,
        budgetLimit: 50,
        cycleCount: 2,
        maxCycles: 20
      };

      const result = await synthesisService.synthesize(context);

      expect(result.success).toBe(true);
      expect(result.analysis).toBeDefined();
      expect(result.learning).toBeDefined();
      expect(result.knowledgeCapture).toBeDefined();
      expect(result.conclusion).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('should detect successful objective completion', async () => {
      // assessObjectiveMet requires the result to share a word of more than
      // four characters with the objective — "Test objective" against "Success
      // output" shares nothing, so the original fixture could never be judged
      // met however well it ran.
      const context = {
        missionRunId: 1,
        missionId: 1,
        objective: 'Summarise the quarterly revenue report',
        blackboard: { result: 'Quarterly revenue summarised: 4.2M, up 12% year on year' },
        executionTrace: [
          { cycle: 1, action: 'step1', result: 'success', latencyMs: 100 },
          { cycle: 2, action: 'step2', result: 'success', latencyMs: 100 }
        ],
        budgetUsed: 5,
        budgetLimit: 50,
        cycleCount: 2,
        maxCycles: 20
      };

      const result = await synthesisService.synthesize(context);

      expect(result.analysis.objectiveMet).toBe(true);
      expect(result.conclusion.completionStatus).toBe('success');
    });

    it('should detect failed objectives', async () => {
      const context = {
        missionRunId: 2,
        missionId: 2,
        objective: 'Failing task',
        blackboard: {},
        executionTrace: [
          { cycle: 1, action: 'step1', result: 'failure', error: 'Connection failed', latencyMs: 100 }
        ],
        budgetUsed: 2,
        budgetLimit: 50,
        cycleCount: 1,
        maxCycles: 20
      };

      const result = await synthesisService.synthesize(context);

      expect(result.analysis.objectiveMet).toBe(false);
      expect(result.learning.failedApproaches.length).toBeGreaterThan(0);
    });

    it('should recommend continuation for in-progress missions', async () => {
      const context = {
        missionRunId: 3,
        missionId: 3,
        objective: 'Long running task',
        blackboard: { partial: 'partial result' },
        executionTrace: [
          { cycle: 1, action: 'step1', result: 'success', latencyMs: 100 },
          { cycle: 2, action: 'step2', result: 'success', latencyMs: 100 }
        ],
        budgetUsed: 10,
        budgetLimit: 50,
        cycleCount: 2,
        maxCycles: 20
      };

      const result = await synthesisService.synthesize(context);

      // Should recommend continue or retry
      expect(['continue', 'retry']).toContain(result.conclusion.recommendation);
    });

    it('should recommend escalation at max cycles', async () => {
      const context = {
        missionRunId: 4,
        missionId: 4,
        objective: 'Stuck task',
        blackboard: {},
        executionTrace: [
          { cycle: 20, action: 'retry', result: 'failure', error: 'Still failing', latencyMs: 100 }
        ],
        budgetUsed: 40,
        budgetLimit: 50,
        cycleCount: 20,
        maxCycles: 20
      };

      const result = await synthesisService.synthesize(context);

      expect(result.conclusion.recommendation).toBe('escalate');
    });

    it('should recommend escalation at budget limit', async () => {
      const context = {
        missionRunId: 5,
        missionId: 5,
        objective: 'Expensive task',
        blackboard: {},
        executionTrace: [
          { cycle: 10, action: 'process', result: 'success', latencyMs: 100 }
        ],
        budgetUsed: 48,
        budgetLimit: 50,
        cycleCount: 10,
        maxCycles: 20
      };

      const result = await synthesisService.synthesize(context);

      expect(result.conclusion.recommendation).toBe('escalate');
    });

    it('should generate learning patterns', async () => {
      const context = {
        missionRunId: 6,
        missionId: 6,
        objective: 'Pattern test',
        blackboard: { result: 'Done' },
        executionTrace: [
          { cycle: 1, action: 'strategy_a', result: 'success', latencyMs: 100 },
          { cycle: 2, action: 'strategy_b', result: 'success', latencyMs: 100 },
          { cycle: 3, action: 'strategy_c', result: 'success', latencyMs: 100 }
        ],
        budgetUsed: 15,
        budgetLimit: 50,
        cycleCount: 3,
        maxCycles: 20
      };

      const result = await synthesisService.synthesize(context);

      expect(result.learning.detectedPatterns.length).toBeGreaterThan(0);
      expect(result.learning.successfulStrategies.length).toBe(3);
    });

    it('should handle synthesis errors gracefully', async () => {
      const context = null as any; // Invalid context

      const result = await synthesisService.synthesize(context);

      expect(result.success).toBe(false);
      expect(result.conclusion.recommendation).toBe('escalate');
    });
  });

  describe('Performance Metrics', () => {
    it('should calculate budget efficiency', async () => {
      const context = {
        missionRunId: 7,
        missionId: 7,
        objective: 'Budget test',
        blackboard: { result: 'Done' },
        executionTrace: [{ cycle: 1, action: 'test', result: 'success', latencyMs: 100 }],
        budgetUsed: 25,
        budgetLimit: 50,
        cycleCount: 1,
        maxCycles: 10
      };

      const result = await synthesisService.synthesize(context);

      expect(result.analysis.performanceMetrics.budgetEfficiency).toBe(0.5);
    });

    it('should calculate completion percentage', async () => {
      const context = {
        missionRunId: 8,
        missionId: 8,
        objective: 'Completion test',
        blackboard: { result: 'Done' },
        executionTrace: [
          { cycle: 1, action: 'step1', result: 'success', latencyMs: 100 },
          { cycle: 2, action: 'step2', result: 'failure', error: 'Error', latencyMs: 100 },
          { cycle: 3, action: 'step2', result: 'success', latencyMs: 100 }
        ],
        budgetUsed: 10,
        budgetLimit: 50,
        cycleCount: 3,
        maxCycles: 10
      };

      const result = await synthesisService.synthesize(context);

      expect(result.analysis.performanceMetrics.completionPercentage).toBe(67);
    });

    it('should keep time efficiency finite when latency is zero or missing', async () => {
      const context = {
        missionRunId: 9,
        missionId: 9,
        objective: 'Timing test',
        blackboard: { result: 'Done' },
        executionTrace: [
          { cycle: 1, action: 'instant', result: 'success', latencyMs: 0 },
          { cycle: 2, action: 'unknown', result: 'success', latencyMs: undefined }
        ],
        budgetUsed: 10,
        budgetLimit: 50,
        cycleCount: 2,
        maxCycles: 10
      };

      const result = await synthesisService.synthesize(context);

      expect(Number.isFinite(result.analysis.performanceMetrics.timeEfficiency)).toBe(true);
      expect(result.analysis.performanceMetrics.timeEfficiency).toBe(1);
    });
  });
});
