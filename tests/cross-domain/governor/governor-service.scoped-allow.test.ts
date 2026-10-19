/**
 * GovernorService.createScopedAllowRule tests
 *
 * Regression coverage for the HIL `approve_tool` path (suggestion-apply.service),
 * which previously called a method that did not exist (silent runtime TypeError,
 * masked by the service's `as any` cast).
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted state so the vi.mock factory (which is hoisted above imports) can see it.
const h = vi.hoisted(() => ({
    selectQueue: [] as any[][],
    insertQueue: [] as any[][],
    insertedTables: [] as unknown[],
    insertedValues: [] as any[],
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve(h.selectQueue.shift() ?? [])),
            })),
        })),
        insert: vi.fn((table: unknown) => {
            h.insertedTables.push(table);
            return {
                values: vi.fn((values: any) => {
                    h.insertedValues.push(values);
                    return {
                        returning: vi.fn(() => Promise.resolve(h.insertQueue.shift() ?? [])),
                    };
                }),
            };
        }),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

// Imported after the mocks are registered.
import { governorService } from "@domain/governor/core/governor-service.js";

describe('GovernorService.createScopedAllowRule', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.selectQueue.length = 0;
        h.insertQueue.length = 0;
        h.insertedTables.length = 0;
        h.insertedValues.length = 0;
    });

    it('resolves the org from the mission run and creates an expiring tool_allow rule', async () => {
        // 1) mission run lookup -> org 7; 2) runtime policy lookup -> not found (create it)
        h.selectQueue.push([{ organizationId: 7 }], []);
        // 1) inserted policy row; 2) inserted rule row
        h.insertQueue.push([{ id: 100 }], [{ id: 555, type: 'tool_allow' }]);

        const before = Date.now();
        const rule = await governorService.createScopedAllowRule({
            toolName: 'sql_query',
            missionRunId: 42,
            expiresAfterMs: 3_600_000,
        });

        expect(rule).toMatchObject({ id: 555, type: 'tool_allow' });

        // The rule insert (second insert) carries tools + missionRunId + a future expiry.
        const ruleValues = h.insertedValues[1];
        expect(ruleValues.policyId).toBe(100);
        expect(ruleValues.type).toBe('tool_allow');
        expect(ruleValues.configuration.tools).toEqual(['sql_query']);
        expect(ruleValues.configuration.missionRunId).toBe(42);
        const expiry = Date.parse(ruleValues.configuration.expiresAt);
        expect(expiry).toBeGreaterThanOrEqual(before + 3_600_000);
    });

    it('reuses an existing runtime-approval policy instead of creating a new one', async () => {
        // 1) mission run -> org 7; 2) runtime policy lookup -> found (id 200)
        h.selectQueue.push([{ organizationId: 7 }], [{ id: 200, name: 'Runtime Scoped Approvals' }]);
        h.insertQueue.push([{ id: 556, type: 'tool_allow' }]);

        const rule = await governorService.createScopedAllowRule({
            toolName: 'shell_exec',
            missionRunId: 42,
        });

        expect(rule).toMatchObject({ id: 556 });
        // Only ONE insert (the rule) — the policy already existed.
        expect(h.insertedValues).toHaveLength(1);
        expect(h.insertedValues[0].policyId).toBe(200);
        expect(h.insertedValues[0].configuration.tools).toEqual(['shell_exec']);
    });

    it('defaults to a 1h expiry when expiresAfterMs is omitted', async () => {
        h.selectQueue.push([{ organizationId: 7 }], [{ id: 200 }]);
        h.insertQueue.push([{ id: 557 }]);

        const before = Date.now();
        await governorService.createScopedAllowRule({ toolName: 'read_file', missionRunId: 1 });

        const expiry = Date.parse(h.insertedValues[0].configuration.expiresAt);
        // ~1h out (allow a generous window for test execution time).
        expect(expiry).toBeGreaterThanOrEqual(before + 3_600_000 - 5_000);
        expect(expiry).toBeLessThanOrEqual(Date.now() + 3_600_000 + 5_000);
    });

    it('falls back to a global (null-org) policy when no missionRunId is provided', async () => {
        // No mission run lookup happens; first select is the policy lookup -> not found.
        h.selectQueue.push([]);
        h.insertQueue.push([{ id: 300 }], [{ id: 558 }]);

        const rule = await governorService.createScopedAllowRule({ toolName: 'web_fetch' });

        expect(rule).toMatchObject({ id: 558 });
        // policy insert + rule insert
        expect(h.insertedValues).toHaveLength(2);
        expect(h.insertedValues[1].configuration.missionRunId).toBeUndefined();
    });
});
