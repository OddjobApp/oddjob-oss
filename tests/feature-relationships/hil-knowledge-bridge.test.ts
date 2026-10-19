/**
 * HIL Knowledge Bridge Tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hilKnowledgeBridge } from '../../server/domain/integrations/core/hil-knowledge-bridge.js';

// vi.hoisted, because the factories below are hoisted above these declarations.
// As plain consts they sat in the temporal dead zone — which only became
// visible once the mocks pointed at modules that exist and the factories
// actually ran.
const { mockDbSelect, mockDbInsert, mockDbUpdate, mockLongTermMemory } = vi.hoisted(() => ({
    mockDbSelect: vi.fn(),
    mockDbInsert: vi.fn(),
    mockDbUpdate: vi.fn(),
    mockLongTermMemory: { remember: vi.fn() },
}));

// These named two modules that do not exist — server/domain/core/db.js and
// agents/core/ltm.service.js — at `../../../`, which from tests/ resolves above
// the repository. Nothing was mocked: every test ran against the real database
// and the real long-term memory service, and all five failed. The bridge imports
// @server/database_service.js and @domain/agents/core/long-term-memory.service.js,
// which is what has to be intercepted, and its siblings in this directory
// already mock by alias.
vi.mock('@server/database_service.js', () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
        insert: (...args: unknown[]) => mockDbInsert(...args),
        update: (...args: unknown[]) => mockDbUpdate(...args),
    },
}));

vi.mock('@domain/agents/core/long-term-memory.service.js', () => ({
    longTermMemoryService: mockLongTermMemory,
}));

/**
 * A drizzle-ish chain that resolves wherever the caller stops.
 *
 * The doubles here only resolved at `.limit()`, but the bridge awaits
 * `.where(...)` directly in predictApprovalLikelihood and stops at `.orderBy()`
 * elsewhere — so those calls got the builder object back instead of rows, and
 * `patterns.reduce is not a function` was swallowed into a default answer.
 * Being thenable means the stop point no longer has to be guessed.
 */
const chain = (rows: unknown[]) => {
    const q: any = {
        from: () => q,
        where: () => q,
        limit: () => q,
        orderBy: () => q,
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return q;
};

/** Queue one result per db.select() call, in the order the bridge makes them. */
const selectsReturn = (...results: unknown[][]) => {
    for (const rows of results) mockDbSelect.mockReturnValueOnce(chain(rows));
    mockDbSelect.mockReturnValue(chain([]));
};

describe('HIL Knowledge Bridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('captureDecision', () => {
        it('should create new pattern for first-time approval', async () => {
            const mockRequest = {
                id: 1,
                approverId: 'user-123',
                approverEmail: 'user@example.com',
                status: 'approved',
                createdAt: new Date(Date.now() - 300000), // 5 min ago
                decidedAt: new Date(),
                modifiedOutput: { plan: { tasks: [{ name: 'Deploy' }] } },
                organizationId: 1,
            };

            // In call order: the approval request, the HIL Patterns topic
            // (ensureHILTopic runs between the two), then no existing pattern.
            selectsReturn([mockRequest], [{ id: 42 }], []);

            mockDbInsert.mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 100 }]),
                }),
            });

            const result = await hilKnowledgeBridge.captureDecision(1);

            expect(result.success).toBe(true);
            expect(result.patternId).toBe(100);
            expect(mockDbInsert).toHaveBeenCalled();
        });

        it('should update existing pattern for similar approval', async () => {
            const mockRequest = {
                id: 2,
                approverId: 'user-123',
                approverEmail: 'user@example.com',
                status: 'approved',
                createdAt: new Date(Date.now() - 120000),
                decidedAt: new Date(),
                modifiedOutput: { plan: { tasks: [{ name: 'Deploy' }] } },
                organizationId: 1,
            };

            const existingPattern = {
                id: 50,
                data: {
                    approverId: 'user-123',
                    contextType: 'plan_approval',
                    decision: 'approved',
                    similarApprovalCount: 3,
                    avgDecisionTime: 180000,
                },
            };

            selectsReturn([mockRequest], [{ id: 42 }], [existingPattern]);

            mockDbUpdate.mockReturnValue({
                set: vi.fn().mockReturnValue({
                    where: vi.fn().mockResolvedValue(undefined),
                }),
            });

            const result = await hilKnowledgeBridge.captureDecision(2);

            expect(result.success).toBe(true);
            expect(result.patternId).toBe(50);
            expect(result.message).toContain('updated');
        });

        it('should skip non-finalized decisions', async () => {
            const mockRequest = {
                id: 3,
                status: 'pending',
            };

            selectsReturn([mockRequest]);

            const result = await hilKnowledgeBridge.captureDecision(3);

            expect(result.success).toBe(false);
            expect(result.message).toContain('not yet finalized');
        });
    });

    describe('classifyContext', () => {
        it('should classify plan approval context', () => {
            const context = { plan: { tasks: [{ name: 'Test' }] } };
            const result = hilKnowledgeBridge.classifyContext(context);
            expect(result).toBe('plan_approval');
        });

        it('should classify dynamic action context', () => {
            const context = { dynamicAction: { intent: 'deploy' } };
            const result = hilKnowledgeBridge.classifyContext(context);
            expect(result).toBe('dynamic_action');
        });

        it('should return general for empty context', () => {
            const result = hilKnowledgeBridge.classifyContext(null);
            expect(result).toBe('general');
        });
    });

    describe('predictApprovalLikelihood', () => {
        it('should predict high likelihood for frequent approver', async () => {
            const mockPatterns = [
                { data: { decision: 'approved', similarApprovalCount: 8 } },
                { data: { decision: 'approved', similarApprovalCount: 5 } },
                { data: { decision: 'rejected', similarApprovalCount: 1 } },
            ];

            selectsReturn(mockPatterns);

            const result = await hilKnowledgeBridge.predictApprovalLikelihood(
                'user-123',
                { plan: { tasks: [] } },
                1
            );

            expect(result.likelihood).toBe('high');
            expect(result.confidence).toBeGreaterThan(0.8);
        });

        it('should return medium likelihood with no history', async () => {
            selectsReturn([]);

            const result = await hilKnowledgeBridge.predictApprovalLikelihood(
                'unknown-user',
                {},
                1
            );

            expect(result.likelihood).toBe('medium');
            expect(result.confidence).toBe(0.5);
        });
    });

    describe('getApproverPatterns', () => {
        it('should return patterns for approver', async () => {
            const mockPatterns = [
                {
                    data: {
                        approverId: 'user-123',
                        approverEmail: 'user@example.com',
                        decision: 'approved',
                        avgDecisionTime: 120000,
                        contextType: 'plan_approval',
                        similarApprovalCount: 5,
                    },
                },
            ];

            selectsReturn(mockPatterns);

            const patterns = await hilKnowledgeBridge.getApproverPatterns('user-123', 1);

            expect(patterns).toHaveLength(1);
            expect(patterns[0].decision).toBe('approved');
        });
    });
});
