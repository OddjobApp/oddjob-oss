import { describe, expect, it } from "vitest";
import { mustSandboxUserCode } from "./sandbox-policy.js";

describe("user code sandbox policy", () => {
    it("sandboxes in production even when the job opts out", () => {
        expect(mustSandboxUserCode({ sandbox: false }, { NODE_ENV: "production" })).toBe(true);
    });

    it("honours FORCE_SANDBOX outside production", () => {
        expect(mustSandboxUserCode({ sandbox: false }, { NODE_ENV: "development", FORCE_SANDBOX: "true" })).toBe(true);
    });

    it("lets development opt out explicitly, and sandboxes by default", () => {
        expect(mustSandboxUserCode({ sandbox: false }, { NODE_ENV: "development" })).toBe(false);
        expect(mustSandboxUserCode({}, { NODE_ENV: "development" })).toBe(true);
        expect(mustSandboxUserCode(undefined, { NODE_ENV: "development" })).toBe(true);
    });
});
