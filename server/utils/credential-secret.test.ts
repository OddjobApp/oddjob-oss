import { afterEach, describe, expect, it, vi } from "vitest";
import { isReservedPlatformVariable, readCredentialSecret } from "./credential-secret.js";

describe("credential secrets never read platform variables", () => {
    afterEach(() => { vi.unstubAllEnvs(); });

    it("refuses the platform's own secrets even when they are set", () => {
        vi.stubEnv("ENCRYPTION_KEY", "master-key");
        vi.stubEnv("SESSION_SECRET", "session");
        vi.stubEnv("DATABASE_URL", "postgres://x");
        vi.stubEnv("PGPASSWORD", "pg");
        vi.stubEnv("GEMINI_API_KEY", "platform-ai");
        for (const name of ["ENCRYPTION_KEY", "SESSION_SECRET", "DATABASE_URL", "PGPASSWORD", "GEMINI_API_KEY"]) {
            expect(readCredentialSecret(name)).toBeUndefined();
        }
    });

    it("reads an ordinary credential variable", () => {
        vi.stubEnv("ACME_JIRA_TOKEN", "jira-token");
        expect(readCredentialSecret("ACME_JIRA_TOKEN")).toBe("jira-token");
        expect(isReservedPlatformVariable("ACME_JIRA_TOKEN")).toBe(false);
    });

    it("treats a missing name as no secret", () => {
        expect(readCredentialSecret(undefined)).toBeUndefined();
        expect(readCredentialSecret("")).toBeUndefined();
    });
});
