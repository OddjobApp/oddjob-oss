/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Captures what the bridge hands to the Drive client: the service-account JSON
// it resolved and whether the caller asked for a writable scope. OAuth
// connections come through `fromAccessToken` instead of the constructor.
const clientCalls: Array<{ json: string; options?: { writable?: boolean } }> = [];
vi.mock("./google-drive-service.js", () => ({
    GoogleDriveClient: class {
        static fromAccessToken(token: string) {
            clientCalls.push({ json: `oauth:${token}` });
            return new this(token);
        }
        constructor(json: string, options?: { writable?: boolean }) {
            clientCalls.push({ json, options });
        }
    },
}));

// OAuth-connected connectors keep their tokens here, not on the row.
let oauthTokenData: Record<string, any> | null = null;
vi.mock("@domain/auth/core/encrypted-credentials.service.js", () => ({
    encryptedCredentialsService: {
        retrieve: vi.fn(async () => oauthTokenData),
    },
}));

vi.mock("./core/oauth/oauth-adapter.registry.js", () => ({
    oauthAdapterRegistry: {
        getAdapter: vi.fn(() => ({
            getValidAccessToken: vi.fn(async () => "fresh-oauth-token"),
        })),
    },
}));

// Query chains used by the bridge:
//   connectors:      select().from().where().orderBy().limit()
//   credential by id: select({envVarName}).from().where().limit(1)
//   legacy lookup:    select({envVarName, metadata}).from().where()
let connectorRows: any[] = [];
let credentialRows: any[] = [];
let credentialByIdRows: any[] = [];

vi.mock("@server/database_service.js", () => ({
    db: {
        select: (fields?: any) => ({
            from: () => {
                if (!fields) {
                    // Connector query
                    return { where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(connectorRows) }) }) };
                }
                if (fields.metadata === undefined) {
                    // credentialId lookup — select({ envVarName })
                    return { where: () => ({ limit: () => Promise.resolve(credentialByIdRows) }) };
                }
                // Legacy cloud_storage lookup — select({ envVarName, metadata })
                return { where: () => Promise.resolve(credentialRows) };
            },
        }),
    },
}));

import { getGoogleDriveClientForOrg } from "./google-drive-connector-bridge.js";

describe("google-drive-connector-bridge", () => {
    beforeEach(() => {
        clientCalls.length = 0;
        connectorRows = [];
        credentialRows = [];
        credentialByIdRows = [];
        oauthTokenData = null;
        delete process.env.GDRIVE_TEST_SA;
    });

    it("uses the OAuth token store for google connectors and refreshes through the adapter", async () => {
        connectorRows = [{
            id: 11,
            platform: "google",
            projectId: 42,
            credentialId: 555,
            credentials: {},
            config: {},
        }];
        oauthTokenData = {
            accessToken: "stale-token",
            refreshToken: "refresh",
            scopes: ["openid", "https://www.googleapis.com/auth/drive"],
        };

        const client = await getGoogleDriveClientForOrg(291, 42);
        expect(client).not.toBeNull();
        // Fresh token via the adapter, not the stale stored one.
        expect(clientCalls[0].json).toBe("oauth:fresh-oauth-token");
    });

    it("rejects OAuth connections that were not granted a Drive scope", async () => {
        connectorRows = [{
            id: 12,
            platform: "google",
            projectId: null,
            credentialId: null,
            credentials: {},
            config: {},
        }];
        oauthTokenData = {
            accessToken: "token",
            scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.send"],
        };

        await expect(getGoogleDriveClientForOrg(291, null)).rejects.toThrow(/Drive access/);
    });

    it("prefers a project-scoped connector and honours the writable flag", async () => {
        connectorRows = [{
            id: 7,
            platform: "google_drive",
            projectId: 42,
            credentialId: null,
            credentials: {},
            config: { envVarName: "GDRIVE_TEST_SA" },
        }];
        process.env.GDRIVE_TEST_SA = JSON.stringify({ client_email: "sa@proj.iam.gserviceaccount.com" });

        const client = await getGoogleDriveClientForOrg(291, 42, { writable: true });
        expect(client).not.toBeNull();
        expect(clientCalls[0].json).toContain("sa@proj.iam.gserviceaccount.com");
        expect(clientCalls[0].options).toMatchObject({ writable: true });
    });

    it("falls back to the org-scoped connector when the project has none", async () => {
        connectorRows = [{
            id: 3,
            platform: "google_drive",
            projectId: null,
            credentialId: null,
            credentials: { serviceAccountJson: '{"client_email":"org@x.iam"}' },
            config: {},
        }];

        const client = await getGoogleDriveClientForOrg(291, 999);
        expect(client).not.toBeNull();
        expect(clientCalls[0].options).toMatchObject({ writable: false });
    });

    it("uses the legacy cloud_storage credential when no connector exists", async () => {
        credentialRows = [{
            envVarName: "GDRIVE_TEST_SA",
            metadata: { provider: "google_drive" },
        }];
        process.env.GDRIVE_TEST_SA = '{"client_email":"legacy@x.iam"}';

        const client = await getGoogleDriveClientForOrg(291, null);
        expect(client).not.toBeNull();
        expect(clientCalls[0].json).toContain("legacy@x.iam");
    });

    it("returns null when the org has no Drive connection at all", async () => {
        expect(await getGoogleDriveClientForOrg(291, 1)).toBeNull();
    });

    it("never reads an env var a connector row names unless it is a Drive service-account variable", async () => {
        // config is written from the request body; naming SESSION_SECRET used to
        // hand that secret to the JSON parser, whose error quoted its first characters.
        connectorRows = [{
            id: 8,
            platform: "google_drive",
            projectId: null,
            credentialId: null,
            credentials: {},
            config: { envVarName: "SESSION_SECRET" },
        }];
        process.env.SESSION_SECRET = "not-for-tenants";

        expect(await getGoogleDriveClientForOrg(291, null)).toBeNull();
        expect(clientCalls).toHaveLength(0);
    });
});
