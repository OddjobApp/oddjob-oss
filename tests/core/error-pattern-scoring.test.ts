/**
 * The error matcher could not classify the two error classes most worth retrying.
 *
 * retry-service.ts reads `diagnosis.bestMatch?.pattern.category` and bails out with
 * `shouldRetry: false` when it is absent, so a pattern that fails to clear
 * getBestMatch's 0.30 threshold is never retried. Two things kept the real errors
 * under it:
 *
 *   1. The score was divided by the summed weight of ALL triggers, including ones
 *      with no evidence to inspect. request-timeout weights HTTP 408/504 at 3 each
 *      against two text triggers at 2, so an internal timeout carrying no HTTP status
 *      could reach at most 2/10 = 0.20.
 *   2. Trigger lists are alternatives, not cumulative evidence — network-error lists
 *      ECONNREFUSED, ETIMEDOUT and getaddrinfo, and a socket failure is exactly one of
 *      them — but matching one of three scored as weak partial agreement: 2/7.5 = 0.27.
 *
 * All three error_diagnoses rows in the database are "Supervisor plan failed: Timeout"
 * with a NULL matched_pattern_id, which is this bug in production.
 */
import { describe, it, expect } from "vitest";
import { matchPatterns, getBestMatch } from "../../shared/utils/errorKnowledgeBase.js";

describe("error pattern scoring — the errors that were never classified", () => {
    it("classifies the supervisor timeout that is actually in error_diagnoses", () => {
        const best = getBestMatch("Supervisor plan failed: Timeout");
        expect(best?.pattern.category).toBe("timeout");
        expect(best!.score).toBeGreaterThanOrEqual(0.3);
    });

    it("classifies a timeout phrased as 'timed out'", () => {
        expect(getBestMatch("Planning timed out after 120s")?.pattern.category).toBe("timeout");
    });

    it("classifies a socket failure from one decisive alternative", () => {
        expect(getBestMatch("ECONNREFUSED 127.0.0.1:5433")?.pattern.category).toBe("network");
        expect(getBestMatch("getaddrinfo ENOTFOUND api.example.com")?.pattern.category).toBe("network");
    });
});

describe("error pattern scoring — no evidence is not a match", () => {
    it.each([
        "totally unrelated gibberish xyzzy",
        "Pipeline completed successfully",
        "User cancelled the operation",
        "Budget exceeded for organization 3",
    ])("does not invent a diagnosis for %j", (msg) => {
        expect(getBestMatch(msg)).toBeNull();
    });

    it("skips a pattern whose triggers all had nothing to inspect", () => {
        // jira-search-deprecated is driven purely by url_contains and status; judged
        // from an error string alone it has no applicable trigger, and absence of
        // evidence must not read as agreement.
        const ids = matchPatterns("some error text", undefined, undefined).map((m) => m.pattern.id);
        expect(ids).not.toContain("jira-search-deprecated");
    });
});

describe("error pattern scoring — previously working cases still work", () => {
    it.each([
        ['relation "foo" does not exist', undefined, "server_error"],
        ['column "bar" does not exist', undefined, "server_error"],
        ["Request failed", 500, "server_error"],
        ["429 Too Many Requests", 429, "rate_limit"],
        ["Invalid credentials supplied", 401, "auth"],
        ["Forbidden: insufficient scope", 403, "permission"],
        ["Unexpected token < in JSON at position 0", undefined, "data_format"],
    ])("%j (status %s) still classifies as %s", (msg, status, category) => {
        expect(getBestMatch(msg as string, status as number | undefined)?.pattern.category).toBe(category);
    });
});

describe("error pattern scoring — the score still carries information", () => {
    it("ranks a fully corroborated match above a single-alternative one", () => {
        // Scoring on decisiveness alone made every match exactly 1.00, which cleared the
        // threshold but left matched_pattern_score meaningless.
        const exact = getBestMatch('relation "foo" does not exist')!.score;
        const single = getBestMatch("ECONNREFUSED 127.0.0.1:5433")!.score;
        expect(exact).toBeGreaterThan(single);
        expect(new Set([exact, single]).size).toBe(2);
    });

    it("keeps every score a real proportion", () => {
        for (const msg of ["Supervisor plan failed: Timeout", "Request failed", "ECONNREFUSED"]) {
            for (const m of matchPatterns(msg, undefined)) {
                expect(m.score).toBeGreaterThan(0);
                expect(m.score).toBeLessThanOrEqual(1);
            }
        }
    });
});
