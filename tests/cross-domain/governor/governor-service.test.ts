/**
 * GovernorService tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { governorService } from "@domain/governor/core/governor-service.js";
import { ForbiddenError } from '../../../server/utils/errors.js';

const mockDbSelect = vi.fn();

vi.mock("@server/database_service.js", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve(mockDbSelect())),
                orderBy: vi.fn(() => Promise.resolve(mockDbSelect())),
            })),
        })),
        execute: vi.fn().mockResolvedValue({ rows: [{ sum: 0 }] }),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

describe('GovernorService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockDbSelect.mockReturnValue([{ total: 0 }]);
    });

    describe('validateToolAccess', () => {
        it('allows tool when no rules', () => {
            expect(() =>
                governorService.validateToolAccess('sql_query', [])
            ).not.toThrow();
        });

        it('throws when tool in deny list', () => {
            const rules = [
                {
                    id: 1,
                    type: 'tool_deny',
                    isEnabled: true,
                    configuration: { tools: ['sql_query'] },
                },
            ] as any;

            expect(() =>
                governorService.validateToolAccess('sql_query', rules)
            ).toThrow(ForbiddenError);
        });

        it('allows tool when not in deny list', () => {
            const rules = [
                {
                    id: 1,
                    type: 'tool_deny',
                    isEnabled: true,
                    configuration: { tools: ['dangerous_tool'] },
                },
            ] as any;

            expect(() =>
                governorService.validateToolAccess('sql_query', rules)
            ).not.toThrow();
        });

        it('throws when tool not in allow list', () => {
            const rules = [
                {
                    id: 1,
                    type: 'tool_allow',
                    isEnabled: true,
                    configuration: { tools: ['list_jobs', 'get_job_details'] },
                },
            ] as any;

            expect(() =>
                governorService.validateToolAccess('sql_query', rules)
            ).toThrow(ForbiddenError);
        });

        it('allows tool when in allow list', () => {
            const rules = [
                {
                    id: 1,
                    type: 'tool_allow',
                    isEnabled: true,
                    configuration: { tools: ['sql_query', 'list_jobs'] },
                },
            ] as any;

            expect(() =>
                governorService.validateToolAccess('sql_query', rules)
            ).not.toThrow();
        });

        it('ignores disabled rules', () => {
            const rules = [
                {
                    id: 1,
                    type: 'tool_deny',
                    isEnabled: false,
                    configuration: { tools: ['sql_query'] },
                },
            ] as any;

            expect(() =>
                governorService.validateToolAccess('sql_query', rules)
            ).not.toThrow();
        });

        it('enforces an active (non-expired) scoped allow rule as a whitelist', () => {
            const future = new Date(Date.now() + 60_000).toISOString();
            const rules = [
                {
                    id: 1,
                    type: 'tool_allow',
                    isEnabled: true,
                    configuration: { tools: ['list_jobs'], expiresAt: future },
                },
            ] as any;

            // Whitelist is "armed" by the live grant, and sql_query is not in it.
            expect(() =>
                governorService.validateToolAccess('sql_query', rules)
            ).toThrow(ForbiddenError);
        });

        it('authorizes the granted tool while a scoped allow rule is live', () => {
            const future = new Date(Date.now() + 60_000).toISOString();
            const rules = [
                {
                    id: 1,
                    type: 'tool_allow',
                    isEnabled: true,
                    configuration: { tools: ['sql_query'], expiresAt: future },
                },
            ] as any;

            expect(() =>
                governorService.validateToolAccess('sql_query', rules)
            ).not.toThrow();
        });

        it('ignores an expired scoped allow rule (no longer arms the whitelist)', () => {
            const past = new Date(Date.now() - 60_000).toISOString();
            const rules = [
                {
                    id: 1,
                    type: 'tool_allow',
                    isEnabled: true,
                    configuration: { tools: ['list_jobs'], expiresAt: past },
                },
            ] as any;

            // The only allow rule has expired, so no whitelist is enforced.
            expect(() =>
                governorService.validateToolAccess('sql_query', rules)
            ).not.toThrow();
        });
    });

    describe('redactSensitiveData', () => {
        it('returns text unchanged when no PII rules', () => {
            const result = governorService.redactSensitiveData('Hello 123-45-6789', []);
            expect(result).toBe('Hello 123-45-6789');
        });

        it('redacts pattern when PII rule matches', () => {
            const rules = [
                {
                    id: 1,
                    type: 'pii_redaction',
                    isEnabled: true,
                    configuration: {
                        patterns: [{ name: 'SSN', regex: '\\d{3}-\\d{2}-\\d{4}' }],
                    },
                },
            ] as any;

            const result = governorService.redactSensitiveData('SSN: 123-45-6789', rules);
            expect(result).toContain('[REDACTED-SSN]');
            expect(result).not.toContain('123-45-6789');
        });

        it('handles invalid regex gracefully', () => {
            const rules = [
                {
                    id: 1,
                    type: 'pii_redaction',
                    isEnabled: true,
                    configuration: {
                        patterns: [{ name: 'Bad', regex: '[invalid' }],
                    },
                },
            ] as any;

            const result = governorService.redactSensitiveData('Hello', rules);
            expect(result).toBe('Hello');
        });
    });

    describe('validateBudget', () => {
        it('passes when no budget rules', async () => {
            const results = await governorService.validateBudget({ organizationId: 1 }, []);
            expect(results).toMatchObject({ allowed: true });
            expect(mockDbSelect).not.toHaveBeenCalled();
        });

        it('passes when under budget', async () => {
            mockDbSelect.mockReturnValue([{ total: 5 }]);
            const rules = [
                {
                    id: 1,
                    type: 'budget_limit',
                    isEnabled: true,
                    configuration: { maxCostUSD: 10, scope: 'organization' },
                },
            ] as any;

            const results = await governorService.validateBudget({ organizationId: 1 }, rules);
            expect(results.allowed).toBe(true);
        });

        it('returns disallowed when over budget', async () => {
            mockDbSelect.mockReturnValue([{ total: 15 }]);
            const rules = [
                {
                    id: 1,
                    type: 'budget_limit',
                    isEnabled: true,
                    configuration: { maxCostUSD: 10, scope: 'organization' },
                },
            ] as any;

            const results = await governorService.validateBudget({ organizationId: 1 }, rules);
            expect(results.allowed).toBe(false);
            expect(results.message).toMatch(/Budget limit exceeded/);
        });

        it('returns warning when near budget limit', async () => {
            mockDbSelect.mockReturnValue([{ total: 9 }]);
            const rules = [
                {
                    id: 1,
                    type: 'budget_limit',
                    isEnabled: true,
                    configuration: { maxCostUSD: 10, scope: 'organization' },
                },
            ] as any;

            const results = await governorService.validateBudget({ organizationId: 1 }, rules);
            expect(results.allowed).toBe(true);
            expect(results.warning).toMatch(/BUDGET WARNING/);
        });
    });
});
