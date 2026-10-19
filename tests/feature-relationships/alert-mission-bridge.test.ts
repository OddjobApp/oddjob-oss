/**
 * Alert-to-Mission Bridge Tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { alertMissionBridge } from '../../server/domain/core/infrastructure/alert-mission-bridge.js';

const mockDbSelect = vi.fn();
const mockDbInsert = vi.fn();
const mockDbUpdate = vi.fn();

/**
 * A drizzle-ish chain that resolves wherever the caller stops.
 *
 * checkRateLimit awaits `.where(...)` directly — it counts, it does not limit —
 * so a double that only resolved at `.limit()` handed back the builder and the
 * count read 0 against a maximum, which reported "under the limit" for every
 * input including 15.
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

/** One result per db.select(), in the order the bridge asks for them. */
const selectsReturn = (...results: unknown[][]) => {
    for (const rows of results) mockDbSelect.mockReturnValueOnce(chain(rows));
    mockDbSelect.mockReturnValue(chain([]));
};

const { mockRescueService } = vi.hoisted(() => ({
    // createRescueMission calls initiateRescue, not createSession: the double
    // was missing the only method the bridge actually uses, so the call threw
    // and onAlert reported triggered: false with no reason to look at.
    mockRescueService: { initiateRescue: vi.fn(), createSession: vi.fn(), updateStatus: vi.fn() }
}));

vi.mock('@server/database_service.js', () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
        insert: (...args: unknown[]) => mockDbInsert(...args),
        update: (...args: unknown[]) => mockDbUpdate(...args),
    },
}));

vi.mock('@domain/rescue/core/rescue-service.js', () => ({
    rescueService: mockRescueService,
}));

describe('Alert-to-Mission Bridge', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        alertMissionBridge.initialize({
            autoRescueCategories: ['system_error', 'pipeline_failure'],
            minSeverity: 'error',
            cooldownMs: 300000,
            maxPerHour: 10,
            autoApprove: false,
        });
    });

    describe('qualifiesForAutoRescue', () => {
        it('should qualify critical system_error alert', () => {
            const alert = {
                severity: 'critical',
                category: 'system_error',
                details: {},
            };
            const result = alertMissionBridge.qualifiesForAutoRescue(alert as any);
            expect(result.qualifies).toBe(true);
        });

        it('should not qualify info level alert', () => {
            const alert = {
                severity: 'info',
                category: 'system_error',
                details: {},
            };
            const result = alertMissionBridge.qualifiesForAutoRescue(alert as any);
            expect(result.qualifies).toBe(false);
            expect(result.reason).toContain('Severity');
        });

        it('should not qualify non-auto-rescue category', () => {
            const alert = {
                severity: 'error',
                category: 'user_action',
                details: {},
            };
            const result = alertMissionBridge.qualifiesForAutoRescue(alert as any);
            expect(result.qualifies).toBe(false);
            expect(result.reason).toContain('not in auto-rescue list');
        });

        it('should not qualify alert with existing rescue', () => {
            const alert = {
                severity: 'error',
                category: 'system_error',
                details: { rescueSessionId: 123 },
            };
            const result = alertMissionBridge.qualifiesForAutoRescue(alert as any);
            expect(result.qualifies).toBe(false);
        });
    });

    describe('checkCooldown', () => {
        it('should pass when no recent rescues', async () => {
            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([]),
                        }),
                    }),
                }),
            });

            const result = await alertMissionBridge.checkCooldown('system_error', 1);
            expect(result.passed).toBe(true);
            expect(result.remainingMs).toBe(0);
        });

        it('should fail when recent rescue exists', async () => {
            const recentRescue = {
                createdAt: new Date(Date.now() - 60000), // 1 min ago
            };

            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        orderBy: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([recentRescue]),
                        }),
                    }),
                }),
            });

            const result = await alertMissionBridge.checkCooldown('system_error', 1);
            expect(result.passed).toBe(false);
            expect(result.remainingMs).toBeGreaterThan(0);
        });
    });

    describe('checkRateLimit', () => {
        it('should pass under rate limit', async () => {
            selectsReturn([{ count: 3 }]);

            const result = await alertMissionBridge.checkRateLimit(1);
            expect(result.passed).toBe(true);
            expect(result.count).toBe(3);
        });

        it('should fail over rate limit', async () => {
            selectsReturn([{ count: 15 }]);

            const result = await alertMissionBridge.checkRateLimit(1);
            expect(result.passed).toBe(false);
            expect(result.count).toBe(15);
        });
    });

    describe('buildTriageSummary', () => {
        it('should build summary from alert details', () => {
            const alert = {
                category: 'pipeline_failure',
                severity: 'error',
                message: 'Pipeline #42 failed',
                jobRunId: 101,
                details: {
                    error: 'Build timeout',
                    component: 'build-step',
                },
            };

            const summary = alertMissionBridge.buildTriageSummary(alert as any);

            expect(summary).toContain('pipeline_failure');
            expect(summary).toContain('Pipeline #42 failed');
            expect(summary).toContain('Build timeout');
            expect(summary).toContain('Job Run: 101');
        });
    });

    describe('categorizeServiceType', () => {
        it('should map categories to service types', () => {
            expect(alertMissionBridge.categorizeServiceType('system_error')).toBe('system');
            expect(alertMissionBridge.categorizeServiceType('pipeline_failure')).toBe('pipeline');
            expect(alertMissionBridge.categorizeServiceType('mission_stalled')).toBe('mission');
            expect(alertMissionBridge.categorizeServiceType('unknown_category')).toBe('general');
        });
    });

    describe('onAlert', () => {
        it('should trigger rescue for qualifying critical alert', async () => {
            const mockAlert = {
                id: 1,
                severity: 'critical',
                category: 'system_error',
                message: 'Database connection lost',
                details: {},
                organizationId: 1,
                jobRunId: null,
                pipelineRunId: null,
            };

            // fetch alert, cooldown check, rate limit count
            selectsReturn([mockAlert], [], [{ count: 2 }]);

            mockRescueService.initiateRescue.mockResolvedValue({
                id: 200,
                missionId: 50,
            });

            mockDbUpdate.mockReturnValue({
                set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
            });

            const result = await alertMissionBridge.onAlert(1);

            expect(result.triggered).toBe(true);
            expect(result.rescueSessionId).toBe(200);
            expect(result.reason).toContain('Auto-rescue mission created');
        });

        it('should not trigger for non-qualifying alert', async () => {
            const mockAlert = {
                id: 2,
                severity: 'info',
                category: 'system_error',
                message: 'Minor notification',
                details: {},
            };

            mockDbSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([mockAlert]),
                    }),
                }),
            });

            const result = await alertMissionBridge.onAlert(2);

            expect(result.triggered).toBe(false);
            expect(result.reason).toContain('Severity info below threshold');
        });
    });
});
