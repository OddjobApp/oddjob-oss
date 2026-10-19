/**
 * Webhook Mission Trigger Tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webhookService } from '../../server/domain/integrations/core/webhook.service.js';

const mockDbSelect = vi.fn();

/** Order-independent drizzle select double (builder methods chain; the object is thenable). */
function selectChain(rows: any[]) {
    const q: any = {
        from: () => q, innerJoin: () => q, leftJoin: () => q, where: () => q,
        orderBy: () => q, groupBy: () => q, limit: () => q, offset: () => q,
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return q;
}
// vi.hoisted: the vi.mock factory below reads this at hoist time, so a plain `const`
// is still in its temporal dead zone and the whole file fails to collect.
// (mockDbSelect is safe as a plain const because it is only called from inside a
// closure, which runs later.)
const { mockMissionService } = vi.hoisted(() => ({
    mockMissionService: { launchMission: vi.fn() },
}));

// Both mock paths were wrong, so NEITHER ever applied and the service ran against the
// real database and the real mission service:
//   - server/domain/core/db.js does not exist; the db lives at @server/database_service.js
//   - '../../../server/...' resolves ABOVE the repo root from tests/feature-relationships
//     (the working import at the top of this file uses '../../server/...')
// webhook.service also imports missionService dynamically from
// @domain/mission/core/mission.service.js, which is what has to be mocked.
vi.mock('@server/database_service.js', () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
    },
}));

vi.mock('@domain/mission/core/mission.service.js', () => ({
    missionService: mockMissionService,
}));

// Spread the real module and override only what the test controls. Replacing all of
// `crypto` with a single function broke any transitive importer needing randomUUID,
// createHash and friends — the suite failed to collect at all rather than failing an
// assertion.
vi.mock('crypto', async (importOriginal) => {
    const actual = await importOriginal<typeof import('crypto')>();
    return {
        ...actual,
        default: actual,
        timingSafeEqual: vi.fn(),
    };
});

describe('Webhook Mission Trigger', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('triggerMission', () => {
        it('should launch mission with valid API key', async () => {
            const mission = {
                id: 5,
                organizationId: 1,
                triggerCredentialId: 9,
            };

            // triggerMission looks in `pipelines` first and only falls through to
            // `missions` when that misses, so the first call must return no rows.
            // The third select resolves the mission's webhook credential, whose
            // secret lives in the environment.
            vi.stubEnv('MISSION_WEBHOOK_SECRET', 'valid_key_hash');
            mockDbSelect
                .mockReturnValueOnce(selectChain([]))
                .mockReturnValueOnce(selectChain([mission]))
                .mockReturnValue(selectChain([{ id: 9, type: 'webhook', envVarName: 'MISSION_WEBHOOK_SECRET' }]));

            mockMissionService.launchMission.mockResolvedValue({
                success: true,
                missionRunId: 100,
            });

            const result = await webhookService.triggerMission(
                5,
                { 'x-api-key': 'valid_key_hash' },
                { event: 'deploy' },
                'valid_key_hash'
            );

            expect(result.success).toBe(true);
            expect(result.missionRunId).toBe(100);
            expect(mockMissionService.launchMission).toHaveBeenCalledWith(
                5,
                'webhook',
                1
            );
        });

        it('should reject invalid API key', async () => {
            const mission = { id: 5, organizationId: 1, triggerCredentialId: 9 };

            vi.stubEnv('MISSION_WEBHOOK_SECRET', 'correct_key');
            mockDbSelect
                .mockReturnValueOnce(selectChain([]))
                .mockReturnValueOnce(selectChain([mission]))
                .mockReturnValue(selectChain([{ id: 9, type: 'webhook', envVarName: 'MISSION_WEBHOOK_SECRET' }]));

            await expect(
                webhookService.triggerMission(5, { 'x-api-key': 'wrong_key' }, {}, 'wrong_key')
            ).rejects.toThrow('Invalid API key');

            expect(mockMissionService.launchMission).not.toHaveBeenCalled();
        });

        /**
         * Deliberate, and matching verifyAndTriggerPipeline: a mission with no
         * credential attached is launched without the key being checked against
         * anything. Asserted rather than left implied, because it means an
         * unconfigured mission is triggerable by anyone who knows its id — the
         * key only has to be present, not correct.
         */
        it('launches a mission with no credential without verifying the key', async () => {
            mockDbSelect
                .mockReturnValueOnce(selectChain([]))
                .mockReturnValue(selectChain([{ id: 5, organizationId: 1, triggerCredentialId: null }]));

            mockMissionService.launchMission.mockResolvedValue({ success: true, missionRunId: 101 });

            const result = await webhookService.triggerMission(5, { 'x-api-key': 'anything' }, {}, 'anything');

            expect(result.success).toBe(true);
            expect(mockMissionService.launchMission).toHaveBeenCalled();
        });

        it('should return 404 for non-existent mission', async () => {
            mockDbSelect.mockReturnValue(selectChain([]));

            await expect(
                webhookService.triggerMission(999, {}, {}, 'key')
            ).rejects.toThrow('Mission not found');
        });

        it('should pass webhook payload to mission context', async () => {
            const mission = { id: 5, organizationId: 1, triggerCredentialId: 9 };

            vi.stubEnv('MISSION_WEBHOOK_SECRET', 'key');
            mockDbSelect
                .mockReturnValueOnce(selectChain([]))
                .mockReturnValueOnce(selectChain([mission]))
                .mockReturnValue(selectChain([{ id: 9, type: 'webhook', envVarName: 'MISSION_WEBHOOK_SECRET' }]));

            mockMissionService.launchMission.mockResolvedValue({
                success: true,
                missionRunId: 100,
            });

            const payload = {
                event: 'github.push',
                repository: 'my-app',
                ref: 'main',
            };

            await webhookService.triggerMission(5, { 'x-api-key': 'key' }, payload, 'key');

            // Payload should be passed to mission launch
            expect(mockMissionService.launchMission).toHaveBeenCalled();
        });
    });
});
