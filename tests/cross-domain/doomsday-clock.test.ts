/**
 * Doomsday Clock (checkDoomsdayProtocol) tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkDoomsdayProtocol, MAX_DEPTH, MAX_SPANS_PER_TRACE } from "@domain/core/infrastructure/doomsday-clock.service.js";

const mockSelect = vi.hoisted(() => vi.fn());

vi.mock('@server/database_service.js', () => ({
    db: {
        select: (...args: unknown[]) => mockSelect(...args),
    },
}));

function createTraceContext(overrides: Partial<{ traceId: string; depth: number }> = {}): {
    traceId: string;
    spanId: string;
    traceFlags: string;
    depth: number;
} {
    return {
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        traceFlags: '01',
        depth: 0,
        ...overrides,
    };
}

describe('checkDoomsdayProtocol', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        mockSelect.mockImplementation(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve([{ count: 10 }])),
            })),
        }));
    });

    it('returns safe when depth and span count are within limits', async () => {
        const ctx = createTraceContext({ depth: 5 });
        const result = await checkDoomsdayProtocol(ctx);
        expect(result).toEqual({ safe: true });
    });

    it('returns unsafe when depth exceeds MAX_DEPTH', async () => {
        const ctx = createTraceContext({ depth: MAX_DEPTH + 1 });
        const result = await checkDoomsdayProtocol(ctx);
        expect(result).toEqual({
            safe: false,
            reason: `Recursion depth limit exceeded (${MAX_DEPTH + 1} > ${MAX_DEPTH})`,
        });
    });

    it('returns unsafe when depth equals MAX_DEPTH (boundary: still safe)', async () => {
        const ctx = createTraceContext({ depth: MAX_DEPTH });
        const result = await checkDoomsdayProtocol(ctx);
        expect(result).toEqual({ safe: true });
    });

    it('returns unsafe when span count exceeds MAX_SPANS_PER_TRACE', async () => {
        mockSelect.mockImplementationOnce(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve([{ count: MAX_SPANS_PER_TRACE + 1 }])),
            })),
        }));
        const ctx = createTraceContext({ depth: 0 });
        const result = await checkDoomsdayProtocol(ctx);
        expect(result).toEqual({
            safe: false,
            reason: `Total trace span limit exceeded (${MAX_SPANS_PER_TRACE + 1} > ${MAX_SPANS_PER_TRACE})`,
        });
    });

    it('returns safe when span count equals MAX_SPANS_PER_TRACE (boundary)', async () => {
        mockSelect.mockImplementationOnce(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => Promise.resolve([{ count: MAX_SPANS_PER_TRACE }])),
            })),
        }));
        const ctx = createTraceContext({ depth: 0 });
        const result = await checkDoomsdayProtocol(ctx);
        expect(result).toEqual({ safe: true });
    });

    it('returns safe when db throws (fail-safe)', async () => {
        mockSelect.mockImplementationOnce(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => Promise.reject(new Error('DB connection failed'))),
            })),
        }));
        const ctx = createTraceContext({ depth: 0 });

        const result = await checkDoomsdayProtocol(ctx);

        expect(result).toEqual({ safe: true });
    });
});
