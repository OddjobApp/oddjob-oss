import { describe, it, expect } from "vitest";
import { validateEnvironment } from "./env.js";

/**
 * These assert the *policy*, not the schema shape: the point of this module is
 * that a missing variable is reported rather than absorbed by a fallback, so
 * each test names a real degradation that previously went unreported.
 */

const base = { DATABASE_URL: "postgresql://u:p@localhost:5432/db" } as NodeJS.ProcessEnv;

describe("validateEnvironment", () => {
    it("rejects shared AI keys and overrides in production BYOK", () => {
        const production = { ...base, NODE_ENV: "production", SESSION_SECRET: "s".repeat(64), ENCRYPTION_KEY: "ab".repeat(32) };
        expect(validateEnvironment(production).ok).toBe(true);
        expect(validateEnvironment({ ...production, GEMINI_API_KEY: "platform-key" }).errors.join(" ")).toMatch(/organization-owned/);
        expect(validateEnvironment({ ...production, LOCAL_SLM_ENABLED: "true" }).ok).toBe(false);
        expect(validateEnvironment({ ...production, FAL_KEY: "platform-video" }).errors.join(" ")).toMatch(/organization-owned/);
        expect(validateEnvironment({ ...production, SANDBOX_ALLOW_UNSANDBOXED: "true" }).errors.join(" ")).toMatch(/SANDBOX_ALLOW_UNSANDBOXED/);
        expect(validateEnvironment(production).degraded.join(" ")).not.toMatch(/AI inference/);
    });
    it("fails without DATABASE_URL in any environment", () => {
        const report = validateEnvironment({ NODE_ENV: "development" } as NodeJS.ProcessEnv);
        expect(report.ok).toBe(false);
        expect(report.errors.join(" ")).toMatch(/DATABASE_URL/);
    });

    it("passes in development with only DATABASE_URL set", () => {
        const report = validateEnvironment({ ...base, NODE_ENV: "development" });
        expect(report.ok).toBe(true);
    });

    it("refuses to boot in production without SESSION_SECRET", () => {
        const report = validateEnvironment({ ...base, NODE_ENV: "production" });
        expect(report.ok).toBe(false);
        expect(report.errors.join(" ")).toMatch(/SESSION_SECRET/);
    });

    it("rejects a SESSION_SECRET too short to be a real key", () => {
        const report = validateEnvironment({
            ...base,
            NODE_ENV: "production",
            SESSION_SECRET: "short",
            ENCRYPTION_KEY: "ab".repeat(32),
        });
        expect(report.ok).toBe(false);
        expect(report.errors.join(" ")).toMatch(/SESSION_SECRET/);
    });

    it("accepts APP_TOKEN_ENCRYPTION_KEY in place of ENCRYPTION_KEY", () => {
        const report = validateEnvironment({
            ...base,
            NODE_ENV: "production",
            SESSION_SECRET: "s".repeat(64),
            APP_TOKEN_ENCRYPTION_KEY: "ab".repeat(32),
        });
        expect(report.ok).toBe(true);
    });

    it("requires one of the two encryption key names in production", () => {
        const report = validateEnvironment({
            ...base,
            NODE_ENV: "production",
            SESSION_SECRET: "s".repeat(64),
        });
        expect(report.ok).toBe(false);
        expect(report.errors.join(" ")).toMatch(/ENCRYPTION_KEY/);
    });

    it("reports audit-report signing as degraded rather than failing", () => {
        // This is the exact case that shipped silently: exports render with the
        // literal word "Unsigned" and are still handed to a procurement reviewer.
        const report = validateEnvironment({ ...base, NODE_ENV: "development" });
        expect(report.ok).toBe(true);
        expect(report.degraded.join(" ")).toMatch(/Audit report attestation/);
    });

    it("treats GEMINI_API_KEY and GOOGLE_API_KEY as interchangeable", () => {
        const withGoogle = validateEnvironment({ ...base, GOOGLE_API_KEY: "k" });
        expect(withGoogle.degraded.join(" ")).not.toMatch(/AI inference/);

        const withGemini = validateEnvironment({ ...base, GEMINI_API_KEY: "k" });
        expect(withGemini.degraded.join(" ")).not.toMatch(/AI inference/);

        const withNeither = validateEnvironment({ ...base });
        expect(withNeither.degraded.join(" ")).toMatch(/AI inference/);
    });
});
