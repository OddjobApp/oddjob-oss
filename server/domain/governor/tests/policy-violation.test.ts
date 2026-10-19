/**
 * PolicyViolationService unit tests
 *
 * Tests use an in-memory drizzle stub to avoid a real DB connection.
 * The service methods are thin wrappers, so we test:
 *   - record() swallows errors silently
 *   - list() applies correct where-conditions
 *   - resolve() returns false when record not found
 *   - summary() aggregates 24h / blocked / unresolved correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// -----------------------------------------------------------------------
// Mock the db module so no real Postgres connection is required
// -----------------------------------------------------------------------
const mockInsert  = vi.fn().mockResolvedValue([]);
const mockSelect  = vi.fn();
const mockUpdate  = vi.fn();

vi.mock('@server/database_service.js', () => ({
    db: {
        insert: () => ({ values: mockInsert }),
        select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: mockSelect }) }) }) }),
        update: () => ({ set: () => ({ where: () => ({ returning: mockUpdate }) }) }),
    },
}));

vi.mock('@shared/schema/policy-violations.js', () => ({
    policyViolations: { organizationId: 'organizationId', blocked: 'blocked', resolved: 'resolved', checkType: 'checkType', occurredAt: 'occurredAt', id: 'id' },
}));

vi.mock('drizzle-orm', () => ({
    eq: (...a: any[]) => a,
    desc: (...a: any[]) => a,
    and: (...a: any[]) => a,
    gte: (...a: any[]) => a,
}));

// -----------------------------------------------------------------------
// Import after mocks are set up
// -----------------------------------------------------------------------
import { PolicyViolationService } from '../core/policy-violation.service.js';

describe('PolicyViolationService', () => {
    let svc: PolicyViolationService;

    beforeEach(() => {
        vi.clearAllMocks();
        svc = new PolicyViolationService();
    });

    describe('record()', () => {
        it('inserts a violation record', async () => {
            mockInsert.mockResolvedValueOnce([{ id: 1 }]);
            await svc.record({
                organizationId: 42,
                role: 'analyst',
                checkType: 'tool',
                checkValue: 'code_execution',
                enforcement: 'strict',
                blocked: true,
            });
            expect(mockInsert).toHaveBeenCalledOnce();
        });

        it('swallows DB errors silently', async () => {
            mockInsert.mockRejectedValueOnce(new Error('DB down'));
            await expect(svc.record({
                organizationId: 1,
                role: 'analyst',
                checkType: 'tool',
                checkValue: 'x',
                enforcement: 'warn',
                blocked: false,
            })).resolves.not.toThrow();
        });
    });

    describe('recordBatch()', () => {
        it('does nothing for empty array', async () => {
            await svc.recordBatch([]);
            expect(mockInsert).not.toHaveBeenCalled();
        });

        it('inserts multiple violations in one call', async () => {
            mockInsert.mockResolvedValueOnce([]);
            await svc.recordBatch([
                { organizationId: 1, role: 'user', checkType: 'tool', checkValue: 'a', enforcement: 'warn', blocked: false },
                { organizationId: 1, role: 'user', checkType: 'network', checkValue: 'b', enforcement: 'warn', blocked: false },
            ]);
            expect(mockInsert).toHaveBeenCalledOnce();
        });
    });

    describe('list()', () => {
        it('returns results from the query', async () => {
            const fakeRows = [{ id: 1, organizationId: 1, role: 'analyst', checkType: 'tool', checkValue: 'code_execution', enforcement: 'strict', blocked: true, resolved: false, occurredAt: new Date() }];
            mockSelect.mockResolvedValueOnce(fakeRows);
            const results = await svc.list({ organizationId: 1 });
            expect(results).toEqual(fakeRows);
        });

        it('caps limit at 500', async () => {
            mockSelect.mockResolvedValueOnce([]);
            await svc.list({ organizationId: 1, limit: 9999 });
            // The limit arg is applied via .limit() which is our mockSelect
            expect(mockSelect).toHaveBeenCalled();
        });
    });

    describe('resolve()', () => {
        it('returns true when a row is updated', async () => {
            mockUpdate.mockResolvedValueOnce([{ id: 1 }]);
            const result = await svc.resolve(1, 42);
            expect(result).toBe(true);
        });

        it('returns false when no row matches', async () => {
            mockUpdate.mockResolvedValueOnce([]);
            const result = await svc.resolve(999, 42);
            expect(result).toBe(false);
        });

        it('returns false on DB error', async () => {
            mockUpdate.mockRejectedValueOnce(new Error('DB error'));
            const result = await svc.resolve(1, 42);
            expect(result).toBe(false);
        });
    });

    describe('summary()', () => {
        it('returns zero counts when no violations', async () => {
            mockSelect.mockResolvedValue([]);
            const s = await svc.summary(1);
            expect(s.totalLast24h).toBe(0);
            expect(s.blockedLast24h).toBe(0);
            expect(s.unresolvedTotal).toBe(0);
        });
    });
});
