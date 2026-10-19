import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// tests/setup.ts mocks this service for every suite; this one tests the real thing.
vi.unmock("@domain/auth/core/credentials-service.js");

const mocks = vi.hoisted(() => ({
    rows: [] as any[],
    inserted: [] as any[],
    updated: [] as any[],
    save: vi.fn(),
    source: vi.fn(async () => "stored"),
}));

vi.mock("@server/database_service.js", () => {
    const chain = (rows: () => any[]) => ({
        where: () => Object.assign(Promise.resolve(rows()), {
            orderBy: async () => rows(),
            limit: async () => rows(),
        }),
        orderBy: async () => rows(),
    });
    return { db: {
        select: () => ({ from: () => chain(() => mocks.rows) }),
        insert: () => ({ values: (v: any) => ({ returning: async () => { const row = { id: 41, ...v }; mocks.inserted.push(row); return [row]; } }) }),
        update: () => ({ set: (v: any) => ({ where: () => ({ returning: async () => { mocks.updated.push(v); return [{ ...mocks.rows[0], ...v }]; } }) }) }),
        delete: () => ({ where: async () => undefined }),
    } };
});
vi.mock("./credential-secret-store.js", () => ({
    credentialSecretStore: { save: mocks.save, source: mocks.source, remove: vi.fn() },
}));

import { credentialsService } from "./credentials-service.js";

const gmailRow = {
    id: 5, name: "Gmail", type: "gmail_oauth", description: null, envVarName: "", organizationId: 7,
    createdBy: "u", createdAt: new Date(),
    metadata: { email: "ops@acme.test", refreshToken: "1//refresh", accessToken: "ya29.access", tokenExpiry: "" },
};

describe("credentialsService never hands out secrets", () => {
    beforeEach(() => {
        mocks.rows = []; mocks.inserted = []; mocks.updated = [];
        vi.clearAllMocks();
        vi.stubEnv("NODE_ENV", "test");
    });
    afterEach(() => { vi.unstubAllEnvs(); });

    it("strips secret-bearing metadata from list results", async () => {
        mocks.rows = [gmailRow];
        const [cred] = await credentialsService.list(7);
        expect(JSON.stringify(cred)).not.toMatch(/1\/\/refresh|ya29\.access/);
        expect(cred.metadata).toEqual({ email: "ops@acme.test", tokenExpiry: "" });
        expect(cred.secretSource).toBe("stored");
    });

    it("stores a new credential's secret and does not return it", async () => {
        const cred = await credentialsService.create(
            { name: "Jira", type: "jira", metadata: { baseUrl: "https://acme.atlassian.net", email: "a@acme.test" }, secret: "atl-token" } as any,
            7, 1, "admin",
        );
        expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ id: 41, organizationId: 7 }), "atl-token");
        expect(JSON.stringify(cred)).not.toContain("atl-token");
        expect(mocks.inserted[0].envVarName).toBe("");
    });

    it("requires an organization's credential to carry a secret in production", async () => {
        vi.stubEnv("NODE_ENV", "production");
        await expect(credentialsService.create({ name: "Jira", type: "jira", envVarName: "ACME_JIRA" } as any, 7, 1, "admin"))
            .rejects.toThrow(/secret/);
    });

    it("refuses a credential that names a platform secret", async () => {
        await expect(credentialsService.create({ name: "x", type: "jira", envVarName: "ENCRYPTION_KEY" } as any, 7, 1, "admin"))
            .rejects.toThrow(/reserved/);
    });

    it("lets a Google AI provider point at the org's Gemini connection without a secret", async () => {
        vi.stubEnv("NODE_ENV", "production");
        await credentialsService.create({ name: "Gemini", type: "ai_provider", metadata: { provider: "google" } } as any, 7, 1, "admin");
        expect(mocks.save).not.toHaveBeenCalled();
        expect(mocks.inserted).toHaveLength(1);
    });

    it("keeps secret metadata the client never saw when saving an edit", async () => {
        mocks.rows = [{ ...gmailRow, organizationId: null }];
        await credentialsService.update(5, { metadata: { email: "new@acme.test", tokenExpiry: "" } } as any, null, true);
        expect(mocks.updated[0].metadata).toMatchObject({ email: "new@acme.test", refreshToken: "1//refresh" });
    });
});
