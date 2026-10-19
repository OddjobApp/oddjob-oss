/**
 * DecisionRouter tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelectResult = vi.hoisted(() => vi.fn());
const mockInsertReturning = vi.hoisted(() => vi.fn());
const mockGenerateToken = vi.hoisted(() => vi.fn());

vi.mock('@server/database_service.js', () => ({
    db: {
        insert: vi.fn(() => ({
            values: vi.fn(() => ({
                returning: vi.fn(() => mockInsertReturning()),
            })),
        })),
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(() => Promise.resolve(mockDbSelectResult())),
                })),
            })),
        })),
    },
}));

vi.mock('@domain/core/auth/jwt.service.js', () => ({
    generateExternalToken: (...args: unknown[]) => mockGenerateToken(...args),
}));

vi.mock('../../../server/utils/logger.js', () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// The double lacked `set`, which createClient binds for metrics before handing
// the client back — so this file failed to collect and reported 0 tests. The
// helper supplies everything createClient touches.
vi.mock('ioredis', async () => {
    const { ioredisMockModule } = await import('../../helpers/ioredis-mock.js');
    return ioredisMockModule({
        xadd: vi.fn().mockResolvedValue('redis-id'),
        xrange: vi.fn().mockResolvedValue([]),
        blpop: vi.fn().mockImplementation(() =>
            new Promise(resolve => setTimeout(() => resolve(null), 50)), // Fast timeout
        ),
    });
});

import { DecisionRouter } from '../../../server/domain/governor/core/decision-router.js';

describe('DecisionRouter', () => {
    let router: DecisionRouter;

    const baseRequest = {
        sessionId: 'sess-1',
        tool: 'sql_query',
        params: { query: 'SELECT 1' },
        goal: 'Run query',
        riskLevel: 'medium' as const,
        approverType: 'internal' as const,
        channels: ['copilot'] as const,
    };

    beforeEach(() => {
        vi.clearAllMocks();
        router = new DecisionRouter();
        mockGenerateToken.mockReturnValue('mock-token');
        mockInsertReturning.mockResolvedValue([{ id: 42 }]);
        mockDbSelectResult.mockResolvedValue([]);
    });

    describe('requestDecision', () => {
        it('persists to DB and times out when no decision', async () => {
            const result = await router.requestDecision({
                ...baseRequest,
                channels: ['copilot'],
                timeoutMs: 100,
            });

            expect(mockGenerateToken).toHaveBeenCalled();
            expect(mockInsertReturning).toHaveBeenCalled();
            expect(result.source).toBe('timeout');
            expect(result.approved).toBe(false);
            expect(result.reason).toBe('Decision timeout');
        });

        it('falls through when DB insert fails and times out', async () => {
            mockInsertReturning.mockRejectedValueOnce(new Error('DB error'));

            const result = await router.requestDecision({
                ...baseRequest,
                channels: ['copilot'],
                timeoutMs: 100,
            });

            expect(mockInsertReturning).toHaveBeenCalled();
            expect(result.source).toBe('timeout');
        });

        /**
         * The DB fallback polls every 5000ms — "slower since we have Redis
         * signals now" — so a 1500ms timeout never reached the second check and
         * these two resolved as timeouts instead. Rather than wait 5s of wall
         * clock per test, the poll is stepped with fake timers.
         */
        it('resolves with approved when DB status changes to approved', async () => {
            vi.useFakeTimers();
            try {
                mockDbSelectResult
                    .mockResolvedValueOnce([])
                    .mockResolvedValueOnce([{ id: 42, status: 'approved', comments: 'OK' }]);

                const pending = router.requestDecision({
                    ...baseRequest,
                    channels: ['inbox'],
                    timeoutMs: 30000,
                });

                await vi.advanceTimersByTimeAsync(5100);
                const result = await pending;

                expect(result.approved).toBe(true);
                expect(result.reason).toBe('OK');
                expect(result.source).toBe('db');
            } finally {
                vi.useRealTimers();
            }
        });

        it('resolves with rejected when DB status changes to rejected', async () => {
            vi.useFakeTimers();
            mockDbSelectResult
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ id: 42, status: 'rejected', comments: 'Not allowed' }]);

            const pending = router.requestDecision({
                ...baseRequest,
                channels: ['inbox'],
                timeoutMs: 30000,
            });

            await vi.advanceTimersByTimeAsync(5100);
            const result = await pending;
            vi.useRealTimers();

            expect(result.approved).toBe(false);
            expect(result.reason).toBe('Not allowed');
        });
    });
});
