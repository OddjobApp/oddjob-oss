import { describe, it, expect, beforeEach } from "vitest";
import { CoreConfidentialityUtilityService } from "../core/core-confidentiality-utility.service.js";

describe("CoreConfidentialityUtilityService", () => {
    let service: CoreConfidentialityUtilityService;

    beforeEach(() => {
        service = new CoreConfidentialityUtilityService();
    });

    it("tokenizes and reversibly detokenizes emails and phone numbers", () => {
        const input = "Contact Alice at alice.smith@enterprise.org or call 415-555-2671 for assistance.";
        const result = service.tokenize(input, { organizationId: 1 });

        expect(result.redactionCount).toBe(2);
        expect(result.tokenizedText).not.toContain("alice.smith@enterprise.org");
        expect(result.tokenizedText).not.toContain("415-555-2671");
        expect(result.tokenizedText).toMatch(/<<PAI:EMAIL:[a-f0-9]{8}>>/);
        expect(result.tokenizedText).toMatch(/<<PAI:PHONE:[a-f0-9]{8}>>/);

        const restored = service.detokenize(result.tokenizedText, { organizationId: 1 });
        expect(restored).toBe(input);
    });

    it("tokenizes and detokenizes API keys and database connection strings", () => {
        const input = "Use key sk-proj-1234567890abcdef1234567890 to connect to postgresql://admin:secret123@db.prod.internal:5432/main.";
        const result = service.tokenize(input, { organizationId: 42 });

        expect(result.redactionCount).toBe(2);
        expect(result.tokenizedText).not.toContain("sk-proj-");
        expect(result.tokenizedText).not.toContain("secret123");
        expect(result.tokenizedText).toMatch(/<<PAI:API_KEY:[a-f0-9]{8}>>/);
        expect(result.tokenizedText).toMatch(/<<PAI:DB_URI:[a-f0-9]{8}>>/);

        const restored = service.detokenize(result.tokenizedText, { organizationId: 42 });
        expect(restored).toBe(input);
    });

    it("protects cross-tenant data leakage", () => {
        const input = "Sensitive email: ceo@stealth.io";
        const result = service.tokenize(input, { organizationId: 100 });

        // Organization 200 tries to detokenize organization 100's token
        const detokenizedByOtherOrg = service.detokenize(result.tokenizedText, { organizationId: 200 });

        // Token must remain masked for foreign tenant
        expect(detokenizedByOtherOrg).toBe(result.tokenizedText);
        expect(detokenizedByOtherOrg).not.toContain("ceo@stealth.io");

        // Legitimate tenant can detokenize
        const detokenizedByOwnerOrg = service.detokenize(result.tokenizedText, { organizationId: 100 });
        expect(detokenizedByOwnerOrg).toBe(input);
    });

    it("respects token TTL expiration", async () => {
        const input = "Temporary key sk-test12345678901234567890123";
        // 10ms TTL
        const result = service.tokenize(input, { organizationId: 1, ttlMs: 10 });

        await new Promise((r) => setTimeout(r, 25));

        const purged = service.purgeExpired();
        expect(purged).toBe(1);

        const restored = service.detokenize(result.tokenizedText, { organizationId: 1 });
        // Expired token is unresolved
        expect(restored).toBe(result.tokenizedText);
    });
});
