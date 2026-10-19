import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An in-memory encrypted_credentials table, matched on the four columns the
 * store scopes by. Hermetic: no database is touched.
 */
const table = vi.hoisted(() => ({ rows: [] as any[], nextId: 1 }));

vi.mock("@server/database_service.js", async () => {
    const { PgDialect } = await import("drizzle-orm/pg-core");
    const dialect = new PgDialect();
    // Read the bound params of the store's `and(eq, eq, eq, eq)` scope in order:
    // organizationId, entityType, entityId, credentialType.
    const match = (where: any) => {
        const [organizationId, entityType, entityId, credentialType] = dialect.sqlToQuery(where).params;
        return (r: any) => r.organizationId === organizationId && r.entityType === entityType
            && r.entityId === entityId && r.credentialType === credentialType;
    };
    const api = {
        select: () => ({ from: () => ({ where: (where: any) => ({
            limit: async () => table.rows.filter(match(where)),
        }) }) }),
        insert: () => ({ values: async (v: any) => { table.rows.push({ id: table.nextId++, ...v }); } }),
        delete: () => ({ where: async (where: any) => {
            const m = match(where);
            table.rows = table.rows.filter((r) => !m(r));
        } }),
    };
    return { db: { ...api, transaction: async (work: any) => work(api) } };
});

import { credentialSecretStore, resolveCredentialSecret } from "./credential-secret-store.js";
import { encrypt } from "@server/utils/encryption.js";

describe("credential secret store", () => {
    beforeEach(() => {
        table.rows = [];
        vi.stubEnv("ENCRYPTION_KEY", "ef".repeat(32));
        vi.stubEnv("NODE_ENV", "test");
    });
    afterEach(() => { vi.unstubAllEnvs(); });

    const acme = { id: 11, organizationId: 7, envVarName: "ACME_JIRA_TOKEN" };

    it("stores the secret encrypted and resolves it, never in plain text", async () => {
        await credentialSecretStore.save(acme, "jira-token-123");
        expect(JSON.stringify(table.rows)).not.toContain("jira-token-123");
        expect(await resolveCredentialSecret(acme)).toBe("jira-token-123");
        expect(await credentialSecretStore.source(acme)).toBe("stored");
    });

    it("will not resolve one organization's secret for another", async () => {
        await credentialSecretStore.save(acme, "jira-token-123");
        // Same credential id claimed under a different org: no row, and a moved
        // row would not decrypt because it is sealed to org 7.
        expect(await resolveCredentialSecret({ ...acme, organizationId: 8, envVarName: null })).toBeUndefined();
        table.rows[0].organizationId = 8;
        await expect(resolveCredentialSecret({ ...acme, organizationId: 8 })).rejects.toThrow();
    });

    it("refuses the environment for an organization's credential in production", async () => {
        vi.stubEnv("ACME_JIRA_TOKEN", "operator-token");
        expect(await resolveCredentialSecret(acme)).toBe("operator-token");
        vi.stubEnv("NODE_ENV", "production");
        expect(await resolveCredentialSecret(acme)).toBeUndefined();
        expect(await credentialSecretStore.source(acme)).toBe("missing");
        // A platform-level credential (no org) may still name a variable.
        expect(await resolveCredentialSecret({ id: 12, organizationId: null, envVarName: "ACME_JIRA_TOKEN" })).toBe("operator-token");
    });

    it("moves a cycle-integration value into the store on first read", async () => {
        table.rows.push({ id: 99, organizationId: 7, entityType: "cycle_integration_credential", entityId: 11,
            credentialType: "env_value", encryptedData: encrypt(JSON.stringify({ value: "legacy-secret" })) });
        expect(await resolveCredentialSecret(acme)).toBe("legacy-secret");
        expect(table.rows.map((r) => r.entityType)).toEqual(["credential"]);
        expect(await resolveCredentialSecret(acme)).toBe("legacy-secret");
    });

    it("removes the secret, including any legacy copy", async () => {
        await credentialSecretStore.save(acme, "jira-token-123");
        await credentialSecretStore.remove(acme);
        expect(table.rows).toHaveLength(0);
        expect(await credentialSecretStore.source({ ...acme, envVarName: null })).toBe("missing");
    });

    it("cannot store a secret for a platform-level credential", async () => {
        await expect(credentialSecretStore.save({ id: 1, organizationId: null }, "x")).rejects.toThrow();
    });
});
