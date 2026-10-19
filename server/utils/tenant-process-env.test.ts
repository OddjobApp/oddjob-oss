import { describe, expect, it } from "vitest";
import { tenantProcessEnv } from "./tenant-process-env.js";

describe("tenant process environment", () => {
    const host = {
        Path: "C:\\nodejs",
        SystemRoot: "C:\\Windows",
        TEMP: "C:\\Temp",
        ENCRYPTION_KEY: "master",
        SESSION_SECRET: "session",
        DATABASE_URL: "postgres://platform",
        GEMINI_API_KEY: "platform-ai",
        STRIPE_SECRET_KEY: "sk_live",
        SOME_FUTURE_SECRET: "x",
    } as NodeJS.ProcessEnv;

    it("passes what an OS and toolchain need, whatever their case", () => {
        const env = tenantProcessEnv({}, host);
        expect(env).toMatchObject({ Path: "C:\\nodejs", SystemRoot: "C:\\Windows", TEMP: "C:\\Temp" });
    });

    it("never passes a platform secret, including ones nobody listed", () => {
        const env = tenantProcessEnv({}, host);
        for (const name of ["ENCRYPTION_KEY", "SESSION_SECRET", "DATABASE_URL", "GEMINI_API_KEY", "STRIPE_SECRET_KEY", "SOME_FUTURE_SECRET"]) {
            expect(env[name]).toBeUndefined();
        }
    });

    it("adds the caller's explicit variables", () => {
        expect(tenantProcessEnv({ PORT: "4100", NODE_ENV: "production", UNSET: undefined }, host))
            .toMatchObject({ PORT: "4100", NODE_ENV: "production" });
        expect("UNSET" in tenantProcessEnv({ UNSET: undefined }, host)).toBe(false);
    });
});
