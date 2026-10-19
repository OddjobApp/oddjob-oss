/**
 * OAuth Adapters Framework Tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
    oauthAdapterRegistry,
    jiraOAuthAdapter,
    googleOAuthAdapter,
    slackOAuthAdapter,
    BaseOAuthAdapter,
    type OAuthProviderConfig,
    type OAuthTokens,
} from "@domain/integrations/core/oauth/index.js";

// Mock implementation of BaseOAuthAdapter for isolated testing
class MockOAuthAdapter extends BaseOAuthAdapter {
    readonly platform = "mock_provider";
    readonly callbackPath = "/api/mock/oauth/callback";

    readonly config: OAuthProviderConfig = {
        platform: "mock_provider",
        authorizeUrl: "https://auth.mockprovider.com/authorize",
        tokenUrl: "https://auth.mockprovider.com/token",
        defaultScopes: ["read:data", "write:data"],
        usePkce: true,
        supportsOfflineAccess: true,
    };

    protected getClientId(): string {
        return "mock_client_id_123";
    }

    protected getClientSecret(): string {
        return "mock_client_secret_xyz";
    }

    public async exchangeCodeForTokens(
        _code: string,
        _redirectUri: string,
        _codeVerifier?: string
    ): Promise<OAuthTokens> {
        return {
            accessToken: "mock_access_token",
            refreshToken: "mock_refresh_token",
            tokenType: "Bearer",
            expiresAt: new Date(Date.now() + 3600 * 1000),
            scopes: ["read:data", "write:data"],
        };
    }

    public async refreshAccessToken(refreshToken: string): Promise<OAuthTokens> {
        return {
            accessToken: "mock_refreshed_access_token",
            refreshToken,
            tokenType: "Bearer",
            expiresAt: new Date(Date.now() + 3600 * 1000),
        };
    }
}

describe("OAuth Adapter Framework", () => {
    let adapter: MockOAuthAdapter;

    beforeEach(() => {
        vi.clearAllMocks();
        delete process.env.API_BASE_URL;
        adapter = new MockOAuthAdapter();
    });

    describe("Dynamic Redirect URI Resolution (Cloudflare / Localhost / Custom)", () => {
        it("uses explicit custom redirect URI if provided", () => {
            const uri = adapter.resolveRedirectUri(undefined, "https://custom.domain.com/callback");
            expect(uri).toBe("https://custom.domain.com/callback");
        });

        it("uses API_BASE_URL when defined in environment", () => {
            process.env.API_BASE_URL = "https://app.oddjob.io";
            const uri = adapter.resolveRedirectUri();
            expect(uri).toBe("https://app.oddjob.io/api/mock/oauth/callback");
        });

        it("resolves dynamic Cloudflare tunnel URLs (trycloudflare.com) via request headers", () => {
            const mockReq = {
                get: (header: string) => {
                    if (header.toLowerCase() === "x-forwarded-host" || header.toLowerCase() === "host") {
                        return "bright-butterfly-1234.trycloudflare.com";
                    }
                    if (header.toLowerCase() === "x-forwarded-proto") {
                        return "https";
                    }
                    return undefined;
                },
                protocol: "https",
            } as any;

            const uri = adapter.resolveRedirectUri(mockReq);
            expect(uri).toBe("https://bright-butterfly-1234.trycloudflare.com/api/mock/oauth/callback");
        });

        it("resolves localhost request headers correctly", () => {
            const mockReq = {
                get: (header: string) => {
                    if (header.toLowerCase() === "host") return "localhost:5000";
                    return undefined;
                },
                protocol: "http",
            } as any;

            const uri = adapter.resolveRedirectUri(mockReq);
            expect(uri).toBe("http://localhost:5000/api/mock/oauth/callback");
        });
    });

    describe("Authorization URL & State Lifecycle", () => {
        it("generates authorization URL with PKCE challenge, state, and scopes", async () => {
            const { url, stateId, redirectUri } = await adapter.getAuthorizationUrl({
                organizationId: 1,
                projectId: 10,
                customRedirectUri: "https://tunnel.trycloudflare.com/api/mock/oauth/callback",
                returnTo: "/dashboard/settings",
            });

            expect(stateId).toBeDefined();
            expect(stateId.length).toBeGreaterThan(10);
            expect(redirectUri).toBe("https://tunnel.trycloudflare.com/api/mock/oauth/callback");

            const parsed = new URL(url);
            expect(parsed.origin).toBe("https://auth.mockprovider.com");
            expect(parsed.searchParams.get("client_id")).toBe("mock_client_id_123");
            expect(parsed.searchParams.get("redirect_uri")).toBe("https://tunnel.trycloudflare.com/api/mock/oauth/callback");
            expect(parsed.searchParams.get("state")).toBe(stateId);
            expect(parsed.searchParams.get("code_challenge")).toBeDefined();
            expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
            expect(parsed.searchParams.get("access_type")).toBe("offline");
        });

        it("validates and single-use consumes state", async () => {
            const { stateId } = await adapter.getAuthorizationUrl({
                organizationId: 2,
                projectId: null,
                customRedirectUri: "https://example.com/callback",
            });

            // First consumption succeeds
            const result1 = await (adapter as any).consumeState(stateId);
            expect(result1).not.toBeNull();
            expect(result1?.organizationId).toBe(2);

            // Second consumption returns null (prevents CSRF / replay)
            const result2 = await (adapter as any).consumeState(stateId);
            expect(result2).toBeNull();
        });
    });

    describe("OAuth Adapter Registry", () => {
        it("registers and discovers built-in adapters (jira, google, slack)", () => {
            const platforms = oauthAdapterRegistry.getRegisteredPlatforms();
            expect(platforms).toContain("jira");
            expect(platforms).toContain("google");
            expect(platforms).toContain("slack");

            expect(oauthAdapterRegistry.getAdapter("jira")).toBe(jiraOAuthAdapter);
            expect(oauthAdapterRegistry.getAdapter("google")).toBe(googleOAuthAdapter);
            expect(oauthAdapterRegistry.getAdapter("slack")).toBe(slackOAuthAdapter);
        });

        it("allows registering custom adapters", () => {
            oauthAdapterRegistry.register(adapter);
            expect(oauthAdapterRegistry.getAdapter("mock_provider")).toBe(adapter);
            expect(oauthAdapterRegistry.requireAdapter("mock_provider")).toBe(adapter);
        });

        it("throws error when requiring an unknown adapter", () => {
            expect(() => oauthAdapterRegistry.requireAdapter("unknown_idp")).toThrow(/Unsupported OAuth platform/);
        });
    });

    describe("Concrete Provider Adapters", () => {
        it("JiraOAuthAdapter provides Atlassian 3LO configuration", () => {
            expect(jiraOAuthAdapter.platform).toBe("jira");
            expect(jiraOAuthAdapter.config.authorizeUrl).toBe("https://auth.atlassian.com/authorize");
            expect(jiraOAuthAdapter.config.tokenUrl).toBe("https://auth.atlassian.com/oauth/token");
            expect(jiraOAuthAdapter.config.defaultScopes).toContain("read:jira-work");
            expect(jiraOAuthAdapter.config.supportsOfflineAccess).toBe(true);
        });

        it("GoogleOAuthAdapter provides Google OAuth2 configuration", () => {
            expect(googleOAuthAdapter.platform).toBe("google");
            expect(googleOAuthAdapter.config.authorizeUrl).toBe("https://accounts.google.com/o/oauth2/v2/auth");
            expect(googleOAuthAdapter.config.tokenUrl).toBe("https://oauth2.googleapis.com/token");
            expect(googleOAuthAdapter.config.defaultScopes).toContain("https://www.googleapis.com/auth/gmail.send");
            expect(googleOAuthAdapter.config.supportsOfflineAccess).toBe(true);
        });

        it("SlackOAuthAdapter provides Slack OAuth v2 configuration", () => {
            expect(slackOAuthAdapter.platform).toBe("slack");
            expect(slackOAuthAdapter.config.authorizeUrl).toBe("https://slack.com/oauth/v2/authorize");
            expect(slackOAuthAdapter.config.tokenUrl).toBe("https://slack.com/api/oauth.v2.access");
            expect(slackOAuthAdapter.config.defaultScopes).toContain("chat:write");
        });
    });
});
