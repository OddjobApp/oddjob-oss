/**
 * ErrorDiagnosisEngine classification.
 *
 * The engine was a stub returning { bestMatch: null, isDiagnosed: false } for every
 * input. retry-service.ts derives its decision from that value:
 *
 *     const errorCategory = diagnosis.bestMatch?.pattern.category;
 *     if (!errorCategory) return { shouldRetry: false, reason: 'Error category not recognized' };
 *
 * so automatic retries were disabled everywhere — rate limits, 5xx, network blips
 * and timeouts were all reported as unrecognised. These tests pin that real
 * categories now come back for the error shapes retry-service is configured to
 * retry on.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ insert: vi.fn(), update: vi.fn() }));

vi.mock("@server/database_service.js", () => ({
    db: {
        insert: () => ({ values: async (v: any) => { h.insert(v); } }),
        update: () => ({ set: (v: any) => ({ where: async () => { h.update(v); } }) }),
        select: () => ({ from: () => ({ where: () => ({ limit: () => [] }) }) }),
    },
}));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { errorDiagnosisEngine } from "./error-diagnosis.engine.js";

beforeEach(() => vi.clearAllMocks());

describe("errorDiagnosisEngine.diagnose", () => {
    it.each([
        ["a 429 rate limit", { error: "429 Too Many Requests: rate limit exceeded", httpStatus: 429 }, "rate_limit"],
        ["a 500 server error", { error: "Internal Server Error", httpStatus: 500 }, "server_error"],
        ["a 401 auth failure", { error: "401 Unauthorized: invalid api key", httpStatus: 401 }, "auth"],
        ["a 404", { error: "404 Not Found", httpStatus: 404 }, "not_found"],
    ])("classifies %s", async (_label, params, expected) => {
        const res = await errorDiagnosisEngine.diagnose(params as any, { persist: false });

        expect(res.isDiagnosed).toBe(true);
        expect(res.bestMatch).not.toBeNull();
        expect(res.bestMatch!.pattern.category).toBe(expected);
    });

    it("returns the category retry-service reads, rather than null", async () => {
        // Mirrors retry-service.ts exactly.
        const diagnosis = await errorDiagnosisEngine.diagnose(
            { error: "429 rate limit exceeded", httpStatus: 429 } as any,
            { persist: false },
        );
        const errorCategory = (diagnosis.bestMatch as any)?.pattern.category;

        expect(errorCategory).toBeDefined();
        expect(errorCategory).toBe("rate_limit");
    });

    it("accepts an Error object, not just a string", async () => {
        // 500 rather than 503: the knowledge base's server-error pattern triggers on
        // status 500 and the phrase "internal server error", not on 5xx generally.
        const res = await errorDiagnosisEngine.diagnose(
            { error: new Error("Internal Server Error"), httpStatus: 500 } as any,
            { persist: false },
        );
        expect(res.bestMatch?.pattern.category).toBe("server_error");
    });

    it("reports no match for an unrecognisable error instead of inventing one", async () => {
        const res = await errorDiagnosisEngine.diagnose(
            { error: "wibble frotz " + "z".repeat(40) } as any,
            { persist: false },
        );
        expect(res.bestMatch).toBeNull();
        expect(res.isDiagnosed).toBe(false);
        expect(res.recommendations).toEqual([]);
    });

    it("orders recommendations by confidence", async () => {
        const res = await errorDiagnosisEngine.diagnose(
            { error: "429 rate limit exceeded", httpStatus: 429 } as any,
            { persist: false },
        );
        const confidences = res.recommendations.map(r => r.confidence);
        expect(confidences).toEqual([...confidences].sort((a, b) => b - a));
    });

    it("records the diagnosis, scaling the 0-1 score to the integer column", async () => {
        const res = await errorDiagnosisEngine.diagnose({ error: "429 rate limit exceeded", httpStatus: 429 } as any);

        expect(h.insert).toHaveBeenCalledTimes(1);
        const row = h.insert.mock.calls[0][0];
        expect(row.matchedPatternId).toBeTruthy();
        expect(Number.isInteger(row.matchedPatternScore)).toBe(true);
        expect(row.matchedPatternScore).toBeGreaterThan(0);
        expect(res.diagnosisId).toBeTruthy();
    });

    it("still returns a diagnosis when recording fails", async () => {
        h.insert.mockImplementationOnce(() => { throw new Error("db down"); });
        const res = await errorDiagnosisEngine.diagnose({ error: "429 rate limit exceeded", httpStatus: 429 } as any);

        expect(res.bestMatch).not.toBeNull();
        expect(res.diagnosisId).toBeNull();
    });
});

describe("errorDiagnosisEngine.recordFeedback", () => {
    it("maps helpful=false onto the stored rating", async () => {
        await errorDiagnosisEngine.recordFeedback("abc", { helpful: false });
        expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ userFeedback: "not_helpful" }));
    });

    it("persists appliedFixId and fixSuccessful", async () => {
        await errorDiagnosisEngine.recordFeedback("abc", { appliedFixId: "fix-1", fixSuccessful: true });
        expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ appliedFixId: "fix-1", fixSuccessful: true }));
    });

    it("writes nothing when given no usable feedback", async () => {
        await errorDiagnosisEngine.recordFeedback("abc", {});
        expect(h.update).not.toHaveBeenCalled();
    });
});
