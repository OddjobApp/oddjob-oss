/**
 * Rescue Knowledge Bridge Tests
 * @vitest-environment node
 *
 * Rewritten against the bridge that exists. The previous version described a
 * different one: captureSuccessPattern was expected to answer
 * `{ captured, merged, reason, patternId }` where it answers
 * `{ success, nodeId, message }`; the pattern lookup was expected to go through
 * knowledgeService.searchNodes, where the bridge queries knowledgeNodes
 * directly; and the last two tests called getRescuePatternsForProblem, which
 * does not exist — the method is findRelevantPatterns(orgId, description,
 * limit), and it sorts in SQL rather than in JavaScript.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rescueKnowledgeBridge } from '../../server/domain/rescue/core/rescue-knowledge-bridge.js';

const { mockDbSelect, mockDbInsert, mockDbUpdate, mockDbExecute } = vi.hoisted(() => ({
    mockDbSelect: vi.fn(),
    mockDbInsert: vi.fn(),
    mockDbUpdate: vi.fn(),
    // updatePatternSuccess increments the count through raw SQL, not the query
    // builder — without this the call threw into captureSuccessPattern's catch
    // and the merge case reported success: false.
    mockDbExecute: vi.fn(),
}));

vi.mock('@server/database_service.js', () => ({
    db: {
        select: (...args: unknown[]) => mockDbSelect(...args),
        insert: (...args: unknown[]) => mockDbInsert(...args),
        update: (...args: unknown[]) => mockDbUpdate(...args),
        execute: (...args: unknown[]) => mockDbExecute(...args),
    },
}));

/** A drizzle-ish chain that resolves wherever the caller stops. */
const chain = (rows: unknown[]) => {
    const q: any = {
        select: () => q,
        from: () => q,
        where: () => q,
        limit: () => q,
        orderBy: () => q,
        leftJoin: () => q,
        then: (resolve: any, reject: any) => Promise.resolve(rows).then(resolve, reject),
    };
    return q;
};

/** One result per db.select(), in the order the bridge asks for them. */
const selectsReturn = (...results: unknown[][]) => {
    for (const rows of results) mockDbSelect.mockReturnValueOnce(chain(rows));
    mockDbSelect.mockReturnValue(chain([]));
};

const resolvedSession = {
    id: 1,
    problemType: 'credential_rotation',
    status: 'COMPLETED',
    triageSummary: 'API key expired, rotated successfully',
    recoveryOptions: [{ strategy: 'Rotate the credential' }],
    organizationId: 1,
};

const appliedEvents = [
    { eventType: 'TRIAGE', notes: 'API key expired' },
    { eventType: 'RECOVERY_OPTION_APPLIED', notes: 'Rotated cred 42' },
];

describe('Rescue Knowledge Bridge', () => {
    beforeEach(() => {
        // mockReset, not clearAllMocks: clearing wipes recorded calls but leaves
        // the mockReturnValueOnce queue in place, so results queued by one test
        // are handed to the next and every sequence after the first is shifted.
        mockDbSelect.mockReset();
        mockDbInsert.mockReset();
        mockDbUpdate.mockReset();
        mockDbExecute.mockReset();
        mockDbExecute.mockResolvedValue(undefined);
        mockDbUpdate.mockReturnValue({
            set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
        });
    });

    describe('captureSuccessPattern', () => {
        it('writes a new pattern node when nothing similar exists', async () => {
            // session, events, findSimilarPattern (none), ensureRescueTopic
            selectsReturn([resolvedSession], appliedEvents, [], [{ id: 7 }]);
            mockDbInsert.mockReturnValue({
                values: vi.fn().mockReturnValue({
                    returning: vi.fn().mockResolvedValue([{ id: 100 }]),
                }),
            });

            const result = await rescueKnowledgeBridge.captureSuccessPattern(1);

            expect(result.success).toBe(true);
            expect(result.nodeId).toBe(100);
            expect(mockDbInsert).toHaveBeenCalled();
        });

        it('refuses a session that has not reached a success state', async () => {
            selectsReturn([{ id: 2, status: 'ACTIVE', organizationId: 1 }]);

            const result = await rescueKnowledgeBridge.captureSuccessPattern(2);

            expect(result.success).toBe(false);
            expect(result.message).toContain('not a success state');
            // Nothing is written for a session still in flight.
            expect(mockDbInsert).not.toHaveBeenCalled();
        });

        it('counts a repeat against the existing pattern instead of duplicating it', async () => {
            // session, events, findSimilarPattern returns one
            selectsReturn([resolvedSession], appliedEvents, [{ id: 50 }]);

            const result = await rescueKnowledgeBridge.captureSuccessPattern(1);

            expect(result.success).toBe(true);
            expect(result.nodeId).toBe(50);
            expect(result.message).toContain('Updated existing pattern');
            expect(mockDbExecute).toHaveBeenCalled();
            expect(mockDbInsert).not.toHaveBeenCalled();
        });

        it('refuses when no recovery strategy was ever applied', async () => {
            selectsReturn(
                [{ ...resolvedSession, recoveryOptions: [] }],
                [{ eventType: 'TRIAGE', notes: 'looked at it' }],
            );

            const result = await rescueKnowledgeBridge.captureSuccessPattern(1);

            expect(result.success).toBe(false);
            expect(result.message).toContain('No recovery strategy');
        });
    });

    describe('findRelevantPatterns', () => {
        it('flattens each stored node into the pattern the caller reads', async () => {
            selectsReturn([
                { id: 1, name: 'Pattern A', data: { problemType: 'credential_rotation', recoveryStrategy: 'Rotate', successCount: 5 } },
                { id: 2, name: 'Pattern B', data: { problemType: 'credential_rotation', recoveryStrategy: 'Reissue', successCount: 3 } },
            ]);

            const patterns = await rescueKnowledgeBridge.findRelevantPatterns(1, 'credential_rotation');

            expect(patterns).toHaveLength(2);
            expect(patterns[0].problemType).toBe('credential_rotation');
            expect(patterns[0].recoveryStrategy).toBe('Rotate');
            expect(patterns[0].successCount).toBe(5);
        });

        it('defaults a pattern with no recorded successes to one', async () => {
            selectsReturn([{ id: 3, name: 'Pattern C', data: { problemType: 'timeout' } }]);

            const [pattern] = await rescueKnowledgeBridge.findRelevantPatterns(1, 'timeout');

            // Ordering is the database's job — `order by (data->>'successCount')::int
            // desc` — so what is worth asserting here is the mapping.
            expect(pattern.successCount).toBe(1);
        });
    });
});
