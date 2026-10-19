import { describe, it, expect } from "vitest";
import { generatePreviewShareToken, verifyPreviewShareToken } from "../../server/domain/apps/preview-share-token.js";

describe("Preview Share Token (Phase 7)", () => {
    it("generates a valid share token that verifies successfully", () => {
        const token = generatePreviewShareToken({ appId: 42, organizationId: 1 });
        expect(token).toBeDefined();
        expect(token).toContain(".");

        const res = verifyPreviewShareToken(token, 42);
        expect(res.valid).toBe(true);
        expect(res.payload?.appId).toBe(42);
        expect(res.payload?.organizationId).toBe(1);
    });

    it("rejects token for mismatched app ID", () => {
        const token = generatePreviewShareToken({ appId: 42 });
        const res = verifyPreviewShareToken(token, 99);
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("app_id_mismatch");
    });

    it("rejects expired share token", () => {
        // Generate with negative expiresInHours
        const token = generatePreviewShareToken({ appId: 42, expiresInHours: -1 });
        const res = verifyPreviewShareToken(token, 42);
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("token_expired");
    });

    it("rejects tampered token signature", () => {
        const token = generatePreviewShareToken({ appId: 42 });
        const parts = token.split(".");
        const tampered = `${parts[0]}.badsignature123456`;
        const res = verifyPreviewShareToken(tampered, 42);
        expect(res.valid).toBe(false);
        expect(res.reason).toBe("invalid_signature");
    });

    it("handles missing or malformed token gracefully", () => {
        expect(verifyPreviewShareToken(undefined, 42).valid).toBe(false);
        expect(verifyPreviewShareToken("", 42).valid).toBe(false);
        expect(verifyPreviewShareToken("just-one-part", 42).valid).toBe(false);
    });
});
