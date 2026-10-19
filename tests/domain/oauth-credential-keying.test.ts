/**
 * Where an OAuth token is filed, and where the callback may send the browser.
 * @vitest-environment node
 *
 * Two defects this pins, both from the first cut of the adapter:
 *
 * 1. Tokens were stored before the connector existed, under `entityId: 0`.
 *    `encryptedCredentialsService.store` upserts on (entityType, entityId,
 *    credentialType) with no organization in the match, so every organization's
 *    tokens for a platform landed on ONE row — each new connection overwriting
 *    the previous organization's — and no later read by connector id could
 *    find them again.
 *
 * 2. `returnTo` arrives from the query string and is handed to `res.redirect`
 *    after a successful connect. An absolute URL there is an open redirect
 *    carrying the credibility of the connection the user just approved.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { store, retrieve, dbUpdate } = vi.hoisted(() => ({
    store: vi.fn(async () => ({ id: 4242 })),
    retrieve: vi.fn(async () => null),
    dbUpdate: vi.fn(() => ({ set: () => ({ where: async () => undefined }) })),
}));

vi.mock("@domain/auth/core/encrypted-credentials.service.js", () => ({
    encryptedCredentialsService: { store, retrieve, delete: vi.fn() },
}));

vi.mock("@server/database_service.js", () => ({
    db: {
        update: dbUpdate,
        select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
    },
}));

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    redis: null,
}));

const { BaseOAuthAdapter, sanitizeReturnTo } = await import(
    "@domain/integrations/core/oauth/base-oauth.adapter.js"
);

const CONNECTOR_ID = 991;

class TestAdapter extends (BaseOAuthAdapter as any) {
    readonly platform = "test_provider";
    readonly callbackPath = "/api/test/oauth/callback";
    readonly config = {
        platform: "test_provider",
        authorizeUrl: "https://auth.test.example/authorize",
        tokenUrl: "https://auth.test.example/token",
        defaultScopes: ["read"],
        usePkce: true,
        supportsOfflineAccess: false,
    };

    /** What the connector row looked like when the credential was filed. */
    public credentialIdAtUpsert: number | null | undefined = undefined;

    protected getClientId() { return "client"; }
    protected getClientSecret() { return "secret"; }

    public async exchangeCodeForTokens() {
        return {
            accessToken: "at",
            refreshToken: "rt",
            tokenType: "Bearer",
            expiresAt: new Date(Date.now() + 3_600_000),
            scopes: ["read"],
        };
    }

    public async refreshAccessToken(refreshToken: string) {
        return { accessToken: "at2", refreshToken, tokenType: "Bearer", expiresAt: null };
    }

    /** Stands in for the real row, and records how it was asked for. */
    protected async upsertConnector(params: any) {
        this.credentialIdAtUpsert = params.credentialId;
        return { id: CONNECTOR_ID, orgId: params.orgId, platform: this.platform };
    }
}

describe("sanitizeReturnTo", () => {
    it("keeps a path inside the application", () => {
        expect(sanitizeReturnTo("/admin/integrations?status=jira_connected")).toBe(
            "/admin/integrations?status=jira_connected",
        );
    });

    it.each([
        ["https://evil.example/harvest", "an absolute URL"],
        ["//evil.example/harvest", "a protocol-relative URL"],
        ["/\\evil.example", "a backslash some browsers normalize"],
        ["javascript:alert(1)", "a script URL"],
        ["admin/integrations", "a path with no leading slash"],
        ["/ok\r\nLocation: https://evil.example", "a header-splitting attempt"],
    ])("refuses %s (%s)", (candidate) => {
        expect(sanitizeReturnTo(candidate)).toBe("/admin/integrations");
    });

    it("falls back when nothing was asked for", () => {
        expect(sanitizeReturnTo(undefined)).toBe("/admin/integrations");
        expect(sanitizeReturnTo(null)).toBe("/admin/integrations");
        expect(sanitizeReturnTo("")).toBe("/admin/integrations");
    });
});

describe("handleCallback credential keying", () => {
    let adapter: any;

    beforeEach(() => {
        vi.clearAllMocks();
        store.mockResolvedValue({ id: 4242 } as any);
        adapter = new TestAdapter();
    });

    const connect = async (returnTo?: string) => {
        const { stateId } = await adapter.getAuthorizationUrl({
            organizationId: 7,
            projectId: null,
            returnTo,
        });
        return adapter.handleCallback({ code: "auth-code", stateId });
    };

    it("files the token under the connector, never under entityId 0", async () => {
        await connect();

        expect(store).toHaveBeenCalledTimes(1);
        const [orgId, entityType, entityId, credentialType] = store.mock.calls[0] as any[];
        expect(orgId).toBe(7);
        expect(entityType).toBe("saas_connector");
        expect(entityId).toBe(CONNECTOR_ID);
        expect(entityId).not.toBe(0);
        expect(credentialType).toBe("test_provider_oauth_token");
    });

    it("creates the connector before the credential, since its id is the key", async () => {
        await connect();

        // The connector cannot carry a credential id it does not have yet; the
        // row is pointed at the credential immediately afterwards.
        expect(adapter.credentialIdAtUpsert).toBeNull();
        expect(dbUpdate).toHaveBeenCalledTimes(1);
    });

    it("carries only a sanitized returnTo through the state", async () => {
        const result = await connect("https://evil.example/harvest");
        expect(result.returnTo).toBe("/admin/integrations");
    });
});
