import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { WeaknessMiningService } from './weakness-mining.service.js';
import { AIClientFactory } from '@domain/ai/core/ai-client.service.js';
import { db } from '@server/database_service.js';
import { failurePatterns } from '@shared/schema/index.js';
import { eq } from 'drizzle-orm';

// Mock AIClientFactory and db
vi.mock('@domain/ai/core/ai-client.service.js');
vi.mock('@server/database_service.js');

describe('WeaknessMiningService', () => {
  let weaknessMiningService: WeaknessMiningService;
  let mockAIClient: any;
  let mockReturnedPattern: any = null;

  const mockSet = vi.fn().mockReturnThis();
  const mockWhere = vi.fn().mockReturnThis();
  const mockReturning = vi.fn().mockImplementation(() => Promise.resolve([mockReturnedPattern]));
  const mockInsertValues = vi.fn().mockReturnValue({
    returning: mockReturning
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockSet.mockClear();
    mockWhere.mockClear();
    mockReturning.mockClear();
    mockInsertValues.mockClear();

    mockReturnedPattern = null;

    weaknessMiningService = new WeaknessMiningService();

    // Mock the AI client to return a predictable response
    mockAIClient = {
      execute: vi.fn(),
    };
    (AIClientFactory.getClient as Mock).mockReturnValue(mockAIClient);

    // Mock db interactions for inserting and selecting failure patterns
    (db.insert as Mock).mockReturnValue({
      values: mockInsertValues,
    });
    
    (db.select as Mock).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([]), // No existing patterns by default
    });
    
    // Mock db.update specifically
    (db.update as Mock).mockReturnValue({
      set: mockSet,
    });
    mockSet.mockReturnValue({
      where: mockWhere,
    });
  });

  describe('tenant scoping', () => {
    const failing = (orgId: number | null) => [{
      id: 1, organizationId: orgId, harnessId: 'test-harness', harnessVersion: '1.0.0',
      timestamp: new Date(), status: 'fail', metrics: null, traceId: null, failureReason: null,
    }];

    // These tables had no organization column at all, so clustering merged every
    // tenant's failures on a harness into one pattern.
    it.each([0, -1, NaN, undefined as any, null as any])(
      'refuses to mine without a resolved organizationId (%s)',
      async (badOrg) => {
        await expect(
          weaknessMiningService.mineWeaknesses(badOrg, 'test-harness', '1.0.0', failing(42)),
        ).rejects.toThrow(/resolved organizationId/i);
        expect(AIClientFactory.getClient).not.toHaveBeenCalled();
      },
    );

    it('refuses results belonging to a different organization', async () => {
      await expect(
        weaknessMiningService.mineWeaknesses(42, 'test-harness', '1.0.0', failing(99)),
      ).rejects.toThrow(/another organization/i);
      expect(AIClientFactory.getClient).not.toHaveBeenCalled();
    });

    it('accepts unattributed legacy results without cross-tenant contamination', async () => {
      // organizationId === null is a pre-migration row, not another tenant's.
      await expect(
        weaknessMiningService.mineWeaknesses(42, 'test-harness', '1.0.0', failing(null)),
      ).resolves.toBeDefined();
    });
  });

  it('should not mine weaknesses if no failed or partial results are provided', async () => {
    const results = [{ id: 1, organizationId: 42, harnessId: 'test-harness', harnessVersion: '1.0.0', timestamp: new Date(), status: 'pass', metrics: null, traceId: null, failureReason: null }];
    const patterns = await weaknessMiningService.mineWeaknesses(42, 'test-harness', '1.0.0', results);
    expect(patterns).toEqual([]);
    expect(AIClientFactory.getClient).not.toHaveBeenCalled();
  });

  it('should mine weaknesses for incident-response harness and store new patterns', async () => {
    const failedResult = {
      id: 1,
      organizationId: 42,
      harnessId: 'incident-response',
      harnessVersion: '1.0.0',
      timestamp: new Date(),
      status: 'fail',
      metrics: { mttr_minutes: 120 },
      traceId: 'trace-1',
      failureReason: { code: 'DB_ERROR', message: 'Database connection exhausted' },
    };
    const results = [failedResult];

    mockAIClient.execute.mockResolvedValue({
      output: JSON.stringify({
        signature: { root_cause: 'db_connection_exhaustion', impact: 'service_outage' },
        description: 'Database connection pool exhaustion leading to service outage.',
      }),
    });

    mockReturnedPattern = {
      id: 1,
      organizationId: 42,
      harnessId: 'incident-response',
      harnessVersion: '1.0.0',
      patternSignature: { root_cause: 'db_connection_exhaustion', impact: 'service_outage' },
      clusterSize: 1,
      representativeTraces: ['trace-1'],
      actionabilityScore: 0
    };

    const patterns = await weaknessMiningService.mineWeaknesses(42, 'incident-response', '1.0.0', results);

    expect(patterns.length).toBe(1);
    expect(patterns[0].patternSignature).toEqual({ root_cause: 'db_connection_exhaustion', impact: 'service_outage' });
    expect(mockAIClient.execute).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    // Verify the prompt content for incident-response
    const callArgs = mockAIClient.execute.mock.calls[0][0];
    expect(callArgs.userPrompt).toContain('Analyze the following incident evaluation result');
  });

  it('should mine weaknesses for software-audit harness and store new patterns', async () => {
    const failedResult = {
      id: 1,
      organizationId: 42,
      harnessId: 'software-audit',
      harnessVersion: '1.0.0',
      timestamp: new Date(),
      status: 'fail',
      metrics: { critical_vulnerabilities: 5, code_quality_score: 60 },
      traceId: 'audit-trace-1',
      failureReason: { code: 'HIGH_VULN', message: 'High severity vulnerability found' },
    };
    const results = [failedResult];

    mockAIClient.execute.mockResolvedValue({
      output: JSON.stringify({
        signature: { category: 'security', type: 'sql_injection', file_type: 'ts' },
        description: 'SQL injection vulnerability identified in TypeScript file.',
      }),
    });

    mockReturnedPattern = {
      id: 2,
      organizationId: 42,
      harnessId: 'software-audit',
      harnessVersion: '1.0.0',
      patternSignature: { category: 'security', type: 'sql_injection', file_type: 'ts' },
      clusterSize: 1,
      representativeTraces: ['audit-trace-1'],
      actionabilityScore: 0
    };

    const patterns = await weaknessMiningService.mineWeaknesses(42, 'software-audit', '1.0.0', results);

    expect(patterns.length).toBe(1);
    expect(patterns[0].patternSignature).toEqual({ category: 'security', type: 'sql_injection', file_type: 'ts' });
    expect(mockAIClient.execute).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledTimes(1);
    // Verify the prompt content for software-audit
    const callArgs = mockAIClient.execute.mock.calls[0][0];
    expect(callArgs.userPrompt).toContain('Analyze the following software audit evaluation result');
  });

  it('should update an existing pattern if a similar one is found', async () => {
    const failedResult = {
      id: 1,
      organizationId: 42,
      harnessId: 'incident-response',
      harnessVersion: '1.0.0',
      timestamp: new Date(),
      status: 'fail',
      metrics: { mttr_minutes: 130 },
      traceId: 'trace-2',
      failureReason: { code: 'DB_ERROR', message: 'Another database connection exhausted' },
    };
    const results = [failedResult];

    const existingPatternInDb = {
      id: 100,
      organizationId: 42,
      harnessId: 'incident-response',
      harnessVersion: '1.0.0',
      patternSignature: { root_cause: 'db_connection_exhaustion', impact: 'service_outage' },
      clusterSize: 5,
      representativeTraces: ['trace-10', 'trace-11'],
      actionabilityScore: 0,
    };

    (db.select as Mock).mockReturnValue({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue([existingPatternInDb]), // Mock an existing pattern
    });

    mockAIClient.execute.mockResolvedValue({
      output: JSON.stringify({
        signature: { root_cause: 'db_connection_exhaustion', impact: 'service_outage' },
        description: 'Database connection pool exhaustion leading to service outage.',
      }),
    });

    const patterns = await weaknessMiningService.mineWeaknesses(42, 'incident-response', '1.0.0', results);

    expect(patterns.length).toBe(0); // No new pattern should be inserted, only updated
    expect(mockAIClient.execute).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.update).toHaveBeenCalledWith(failurePatterns);
    expect(mockSet).toHaveBeenCalledWith(expect.objectContaining({
        clusterSize: existingPatternInDb.clusterSize + 1,
    }));
    expect(mockSet.mock.calls[0][0].representativeTraces).toContain('trace-2');
    expect(mockWhere).toHaveBeenCalledWith(eq(failurePatterns.id, existingPatternInDb.id));
  });

  it('should handle LLM response parsing errors gracefully', async () => {
    const failedResult = {
      id: 1,
      organizationId: 42,
      harnessId: 'test-harness',
      harnessVersion: '1.0.0',
      timestamp: new Date(),
      status: 'fail',
      metrics: {},
      traceId: 'trace-error',
      failureReason: { code: 'GENERIC', message: 'Generic failure' },
    };
    const results = [failedResult];

    mockAIClient.execute.mockResolvedValue({
      output: 'invalid json response', // Simulate invalid JSON
    });

    const patterns = await weaknessMiningService.mineWeaknesses(42, 'test-harness', '1.0.0', results);

    expect(patterns).toEqual([]);
    expect(mockAIClient.execute).toHaveBeenCalledTimes(1);
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
});
