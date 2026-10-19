import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, isOwnerBound } from "./encryption.js";

describe("owner-bound encryption", () => {
    beforeEach(() => { vi.stubEnv("ENCRYPTION_KEY", "cd".repeat(32)); });
    afterEach(() => { vi.unstubAllEnvs(); });

    it("round-trips with the owner it was sealed to", () => {
        const sealed = encrypt("secret", "organization_ai:7:gemini");
        expect(isOwnerBound(sealed)).toBe(true);
        expect(decrypt(sealed, "organization_ai:7:gemini")).toBe("secret");
    });

    it("fails for a different owner or no owner", () => {
        const sealed = encrypt("secret", "organization_ai:7:gemini");
        expect(() => decrypt(sealed, "organization_ai:8:gemini")).toThrow();
        expect(() => decrypt(sealed)).toThrow();
    });

    it("still decrypts unbound ciphertext, with or without an owner", () => {
        const legacy = encrypt("secret");
        expect(isOwnerBound(legacy)).toBe(false);
        expect(decrypt(legacy)).toBe("secret");
        expect(decrypt(legacy, "organization_ai:7:gemini")).toBe("secret");
    });
});
