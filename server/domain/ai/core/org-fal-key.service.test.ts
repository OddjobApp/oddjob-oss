import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as any[], inserted: [] as any[], deleted: 0 }));
vi.mock("@server/database_service.js", () => {
    const tx = {
        select: () => ({ from: () => ({ where: () => ({ for: async () => [{ id: 7 }] }) }) }),
        delete: () => ({ where: async () => { mocks.deleted++; } }),
        insert: () => ({ values: async (v: any) => { mocks.inserted.push(v); } }),
    };
    return { db: {
        select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows }) }) }),
        delete: () => ({ where: async () => { mocks.deleted++; } }),
        transaction: (work: any) => work(tx),
    } };
});

import { orgFalKeyService } from "./org-fal-key.service.js";
import { decrypt, encrypt } from "@server/utils/encryption.js";

describe("organization fal.ai key", () => {
    const apiKey = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0:abcdef0123456789";
    beforeEach(() => {
        mocks.rows = []; mocks.inserted = []; mocks.deleted = 0;
        vi.stubEnv("ENCRYPTION_KEY", "ab".repeat(32));
    });
    afterEach(() => { vi.unstubAllEnvs(); });

    it("stores the key sealed to the organization and returns only a hint", async () => {
        const result = await orgFalKeyService.save(7, { apiKey });
        expect(JSON.stringify(result)).not.toContain(apiKey);
        expect(result.keyHint).toBe("…6789");
        const stored = mocks.inserted[0];
        expect(stored).toMatchObject({ organizationId: 7, entityType: "organization_ai", entityId: 7, credentialType: "fal" });
        expect(stored.encryptedData).not.toContain(apiKey);
        expect(decrypt(stored.encryptedData, "organization_ai:7:fal")).toBe(apiKey);
        expect(mocks.deleted).toBe(1); // replaces, never appends
    });

    it("rejects something that is not a key before storing anything", async () => {
        await expect(orgFalKeyService.save(7, { apiKey: "short" })).rejects.toThrow(/fal\.ai/);
        await expect(orgFalKeyService.save(7, { apiKey: "has spaces in it which keys do not" })).rejects.toThrow();
        expect(mocks.inserted).toHaveLength(0);
    });

    it("will not decrypt another organization's key", async () => {
        mocks.rows = [{ encryptedData: encrypt(apiKey, "organization_ai:8:fal") }];
        await expect(orgFalKeyService.resolve(7)).rejects.toThrow();
    });

    it("refuses a missing organization", async () => {
        await expect(orgFalKeyService.resolve(0)).rejects.toThrow(/organization/);
    });
});
