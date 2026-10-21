import { withOrgOAuthApp, currentOAuthApp, oauthAppFingerprint } from './org-oauth-app.service.js';
/**
 * Base OAuth Adapter
 * 
 * Abstract base class providing common OAuth 2.0 / OIDC lifecycle primitives:
 * - Dynamic redirect URI resolution (Cloudflare tunnels, localhost, custom domains)
 * - PKCE code challenge & verifier management
 * - Redis-backed CSRF state generation and single-use consumption (with in-memory fallback)
 * - Token lifecycle, storage via encryptedCredentialsService, and automatic refresh before expiration.
 */

import { randomBytes, createHash } from "node:crypto";
import type { Request } from "express";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { encryptedCredentialsService } from "@domain/auth/core/encrypted-credentials.service.js";
import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { eq, and, isNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { BadRequestError } from "@server/utils/errors.js";
import {
    OAuthReauthorizationRequiredError,
    isReauthorizationRequired,
    withReauthorizationFlag,
    withoutReauthorizationFlag,
    type ReauthorizationReason,
} from "./reauthorization.js";
import type {
    OAuthAdapter,
    OAuthProviderConfig,
    OAuthStatePayload,
    OAuthTokens,
    InitiateOAuthOptions,
    HandleCallbackOptions,
    OAuthCallbackResult,
} from "./oauth-adapter.types.js";

const logger = createLogger("BaseOAuthAdapter");

// In-memory fallback for state tracking when Redis is temporarily offline or in test environments
const inMemoryStateStore = new Map<string, { payload: OAuthStatePayload; expiresAt: number }>();

/** Where the callback is allowed to send the browser once the connection succeeds. */
const DEFAULT_RETURN_TO = "/admin/integrations";

/**
 * Confines `returnTo` to a path inside this application.
 *
 * It arrives from the query string of the initiate route and is handed back to
 * `res.redirect` after a successful connect, so an absolute URL there is an open
 * redirect: a link to our own OAuth endpoint that lands the user on someone
 * else's site wearing the credibility of the connection they just approved.
 *
 * A single leading slash and nothing else — `//evil.example` is protocol-
 * relative and reads as another origin, and a backslash is normalized to a
 * slash by some browsers, so both are refused rather than escaped.
 */
export function sanitizeReturnTo(candidate?: string | null): string {
    if (!candidate) return DEFAULT_RETURN_TO;
    const trimmed = candidate.trim();
    if (!trimmed.startsWith("/")) return DEFAULT_RETURN_TO;
    if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return DEFAULT_RETURN_TO;
    if (/[\r\n]/.test(trimmed)) return DEFAULT_RETURN_TO;
    return trimmed;
}

export abstract class BaseOAuthAdapter implements OAuthAdapter {
    abstract readonly platform: string;
    abstract readonly config: OAuthProviderConfig;

    /** Path to callback endpoint, e.g. `/api/saas/connectors/jira/oauth/callback` */
    abstract readonly callbackPath: string;

    /**
     * Resolves the redirect URI dynamically.
     * Prioritizes custom explicit URI -> API_BASE_URL -> Incoming Request Host (supports Cloudflare tunnels).
     */
    public resolveRedirectUri(req?: Request, customRedirectUri?: string): string {
        if (customRedirectUri && customRedirectUri.trim()) {
            return customRedirectUri.trim();
        }

        if (process.env.API_BASE_URL && process.env.API_BASE_URL.trim()) {
            const base = process.env.API_BASE_URL.trim().replace(/\/+$/, "");
            return `${base}${this.callbackPath}`;
        }

        if (req) {
            const host = req.get("x-forwarded-host") || req.get("host") || "localhost:5000";
            let proto = req.get("x-forwarded-proto") || req.protocol || "http";
            if (host.includes("trycloudflare.com") || host.includes(".app") || host.includes(".dev")) {
                proto = "https";
            }
            return `${proto}://${host}${this.callbackPath}`;
        }

        return `http://localhost:5000${this.callbackPath}`;
    }

    /**
     * Generates a PKCE code verifier and code challenge (S256).
     */
    protected generatePkce(): { verifier: string; challenge: string } {
        const verifier = randomBytes(32)
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "");

        const challenge = createHash("sha256")
            .update(verifier)
            .digest("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=/g, "");

        return { verifier, challenge };
    }

    /**
     * Generates the authorization URL and records the state payload in Redis.
     */
    public async getAuthorizationUrl(options: InitiateOAuthOptions): Promise<{ url: string; stateId: string; redirectUri: string }> {
        return withOrgOAuthApp(options.organizationId, this.platform, () => this.createAuthorizationUrl(options));
    }

    private async createAuthorizationUrl(options: InitiateOAuthOptions) {
        const stateId = randomBytes(24).toString("hex");
        const redirectUri = this.resolveRedirectUri(options.req, options.customRedirectUri);

        let codeVerifier: string | undefined;
        let codeChallenge: string | undefined;

        if (this.config.usePkce) {
            const pkce = this.generatePkce();
            codeVerifier = pkce.verifier;
            codeChallenge = pkce.challenge;
        }

        const statePayload: OAuthStatePayload = {
            stateId,
            organizationId: options.organizationId,
            projectId: options.projectId ?? null,
            platform: this.platform,
            redirectUri,
            codeVerifier,
            returnTo: sanitizeReturnTo(options.returnTo),
            createdAt: Date.now(),
            extra: { ...options.extraState, ...(currentOAuthApp() ? { oauthAppFingerprint: oauthAppFingerprint(currentOAuthApp()!) } : {}) },
        };

        await this.storeState(stateId, statePayload);

        const authUrl = new URL(this.config.authorizeUrl);
        const scopes = options.scopes && options.scopes.length > 0 ? options.scopes : this.config.defaultScopes;

        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("client_id", this.getClientId());
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("state", stateId);

        if (scopes.length > 0) {
            authUrl.searchParams.set("scope", scopes.join(" "));
        }

        if (this.config.usePkce && codeChallenge) {
            authUrl.searchParams.set("code_challenge", codeChallenge);
            authUrl.searchParams.set("code_challenge_method", "S256");
        }

        if (this.config.supportsOfflineAccess) {
            authUrl.searchParams.set("access_type", "offline");
            authUrl.searchParams.set("prompt", "consent");
        }

        if (this.config.additionalAuthParams) {
            for (const [key, val] of Object.entries(this.config.additionalAuthParams)) {
                authUrl.searchParams.set(key, val);
            }
        }

        return {
            url: authUrl.toString(),
            stateId,
            redirectUri,
        };
    }

    /**
     * Handles the OAuth callback: verifies state, exchanges code for tokens,
     * persists encrypted credentials, and updates or creates the SaaS connector record.
     */
    public async handleCallback(options: HandleCallbackOptions): Promise<OAuthCallbackResult> {
        const { code, stateId } = options;

        if (!stateId) {
            throw new BadRequestError("Missing OAuth state parameter");
        }
        if (!code) {
            throw new BadRequestError("Missing authorization code in callback");
        }

        const statePayload = await this.consumeState(stateId);
        if (!statePayload) {
            throw new BadRequestError("Invalid or expired OAuth state — possible CSRF attempt or expired session");
        }

        await options.validateState?.(statePayload);

        const tokens = await withOrgOAuthApp(statePayload.organizationId, this.platform, async () => {
            const app = currentOAuthApp();
            if (statePayload.extra?.oauthAppFingerprint && app && statePayload.extra.oauthAppFingerprint !== oauthAppFingerprint(app)) {
                throw new BadRequestError("OAuth app settings changed during sign-in. Start again.");
            }
            return this.exchangeCodeForTokens(code, statePayload.redirectUri, statePayload.codeVerifier);
        });

        // Fetch user profile / tenant info if supported
        let userInfo: Record<string, any> | undefined;
        try {
            if (this.fetchUserInfo) {
                userInfo = await this.fetchUserInfo(tokens.accessToken);
            }
        } catch (err: any) {
            logger.warn(`Failed to fetch user info for ${this.platform}`, { error: err.message });
        }

        // Store tokens securely in encrypted credentials table
        const credentialData: Record<string, any> = {
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            tokenType: tokens.tokenType || "Bearer",
            expiresAt: tokens.expiresAt ? tokens.expiresAt.toISOString() : null,
            scopes: tokens.scopes,
            userInfo,
            raw: tokens.rawPayload,
            oauthAppFingerprint: statePayload.extra?.oauthAppFingerprint,
        };

        // The connector comes first, because its id is what the credential is
        // filed under. Storing before it exists meant filing every token under
        // entityId 0 — and `store` upserts on (entityType, entityId,
        // credentialType) with no organization in the match, so every
        // organization's tokens for a platform landed on ONE row, each new
        // connection overwriting the last organization's. The row also stayed
        // at 0 afterwards (the update below sets the connector's credentialId,
        // not the credential's entityId), so `retrieve` by connector id could
        // never find it again.
        const connector = await this.upsertConnector({
            orgId: statePayload.organizationId,
            projectId: statePayload.projectId,
            credentialId: null,
            platform: this.platform,
            status: "connected",
            userInfo,
            extra: statePayload.extra,
        });

        const storedCredential = await encryptedCredentialsService.store(
            statePayload.organizationId,
            "saas_connector",
            connector.id,
            `${this.platform}_oauth_token`,
            credentialData
        );

        await db.update(saasConnectors)
            .set({ credentialId: storedCredential.id })
            .where(eq(saasConnectors.id, connector.id));

        if (this.onTokensPersisted) {
            await this.onTokensPersisted(connector.id, tokens, statePayload);
        }

        return {
            connectorId: connector.id,
            organizationId: statePayload.organizationId,
            projectId: statePayload.projectId,
            platform: this.platform,
            tokens,
            returnTo: statePayload.returnTo,
            userInfo,
        };
    }

    /**
     * Resolves a valid access token. Automatically refreshes if token is expired
     * or within 5 minutes of expiration.
     */
    public async getValidAccessToken(connectorId: number): Promise<string> {
        const [connector] = await db.select()
            .from(saasConnectors)
            .where(eq(saasConnectors.id, connectorId))
            .limit(1);

        if (!connector) {
            throw new Error(`SaaS connector not found for ID ${connectorId}`);
        }

        // `retrieve` takes the entity triple and hands back the decrypted data
        // itself — there is no wrapper, and no lookup by credential id.
        const credential = await encryptedCredentialsService.retrieve(
            connector.orgId,
            "saas_connector",
            connectorId,
            `${this.platform}_oauth_token`
        );

        if (!credential) {
            throw new Error(`No encrypted credentials found for ${this.platform} connector ${connectorId}`);
        }

        const { accessToken, refreshToken, expiresAt } = credential;

        if (!accessToken) {
            throw new Error(`No access token stored for ${this.platform} connector ${connectorId}`);
        }

        // Check if token is still valid (with 5-minute safety threshold)
        const isExpiringSoon = expiresAt
            ? new Date(expiresAt).getTime() - Date.now() < 5 * 60 * 1000
            : false;

        if (!isExpiringSoon) {
            return accessToken;
        }

        if (!refreshToken) {
            // Still inside the safety window: the token works until it expires.
            if (new Date(expiresAt!).getTime() > Date.now()) return accessToken;
            logger.warn(`Access token for ${this.platform} connector ${connectorId} expired, and no refresh token is present.`);
            await this.markReauthorizationRequired(connector, 'no_refresh_token', credential.scopes);
            throw new OAuthReauthorizationRequiredError(this.platform, 'no_refresh_token',
                `${this.platform} authorization expired and cannot be renewed. Reconnect ${this.platform}.`);
        }

        logger.info(`Refreshing access token for ${this.platform} connector ${connectorId}...`);
        try {
            const newTokens = await withOrgOAuthApp(connector.orgId, this.platform, async () => {
                const app = currentOAuthApp();
                if (credential.oauthAppFingerprint && app && credential.oauthAppFingerprint !== oauthAppFingerprint(app)) {
                    throw new OAuthReauthorizationRequiredError(this.platform, 'refresh_rejected', 'OAuth app settings changed. Reconnect this organization.');
                }
                return this.refreshAccessToken(refreshToken);
            });

            const updatedData = {
                ...credential,
                accessToken: newTokens.accessToken,
                refreshToken: newTokens.refreshToken || refreshToken,
                expiresAt: newTokens.expiresAt ? newTokens.expiresAt.toISOString() : null,
                tokenType: newTokens.tokenType || credential.tokenType,
            };

            await encryptedCredentialsService.store(
                connector.orgId,
                "saas_connector",
                connectorId,
                `${this.platform}_oauth_token`,
                updatedData
            );

            // A successful refresh proves the grant is alive again — clear any
            // reauthorization flag left from an earlier transient rejection.
            if ((connector.config as Record<string, any> | null)?.reauth_required) {
                await db.update(saasConnectors)
                    .set({ status: "connected", config: withoutReauthorizationFlag(connector.config), updatedAt: new Date() })
                    .where(eq(saasConnectors.id, connectorId));
            }

            return newTokens.accessToken;
        } catch (refreshErr: any) {
            logger.error(`Failed to refresh OAuth token for ${this.platform} connector ${connectorId}`, { error: refreshErr.message });
            if (isReauthorizationRequired(refreshErr)) {
                await this.markReauthorizationRequired(connector, refreshErr.reason, credential.scopes);
                throw refreshErr;
            }
            throw new Error(`OAuth token refresh failed for ${this.platform}: ${refreshErr.message}`);
        }
    }

    /**
     * Flags the connector as needing a person to sign in again: the provider
     * refused the saved grant (or none exists), so no retry will fix it. Only
     * reason codes are stored — provider error text can carry
     * credential-bearing URLs.
     */
    protected async markReauthorizationRequired(
        connector: { id: number; config: Record<string, any> | null },
        reason: ReauthorizationReason,
        scopes?: string[],
    ): Promise<void> {
        await db.update(saasConnectors)
            .set({
                status: "error",
                updatedAt: new Date(),
                config: withReauthorizationFlag(connector.config, reason, scopes),
            })
            .where(eq(saasConnectors.id, connector.id));
    }

    /**
     * Revokes credentials and marks the connector disconnected.
     */
    public async disconnect(connectorId: number): Promise<void> {
        const [connector] = await db.select()
            .from(saasConnectors)
            .where(eq(saasConnectors.id, connectorId))
            .limit(1);

        if (!connector) return;

        await db.update(saasConnectors)
            .set({
                status: "disconnected",
                updatedAt: new Date(),
            })
            .where(eq(saasConnectors.id, connectorId));

        logger.info(`Disconnected ${this.platform} connector ${connectorId}`);
    }

    // --- State Storage Helpers ---

    protected async storeState(stateId: string, payload: OAuthStatePayload): Promise<void> {
        const key = `oauth_state:${this.platform}:${stateId}`;
        try {
            await redis.setex(key, 600, JSON.stringify(payload));
        } catch (err: any) {
            logger.warn(`Redis state store failed, falling back to memory store: ${err.message}`);
            inMemoryStateStore.set(key, { payload, expiresAt: Date.now() + 600 * 1000 });
        }
    }

    protected async consumeState(stateId: string): Promise<OAuthStatePayload | null> {
        const key = `oauth_state:${this.platform}:${stateId}`;
        try {
            const raw = await redis.get(key);
            if (raw) {
                await redis.del(key);
                return JSON.parse(raw);
            }
        } catch (err: any) {
            logger.warn(`Redis state retrieve failed, checking memory store: ${err.message}`);
        }

        const entry = inMemoryStateStore.get(key);
        if (entry) {
            inMemoryStateStore.delete(key);
            if (entry.expiresAt > Date.now()) {
                return entry.payload;
            }
        }

        return null;
    }

    protected async upsertConnector(params: {
        orgId: number;
        projectId?: number | null;
        credentialId: number | null;
        platform: string;
        status: string;
        userInfo?: Record<string, any>;
        extra?: Record<string, any>;
    }) {
        const whereClause = params.projectId
            ? and(
                eq(saasConnectors.orgId, params.orgId),
                eq(saasConnectors.platform, params.platform),
                eq(saasConnectors.projectId, params.projectId)
            )
            : and(
                eq(saasConnectors.orgId, params.orgId),
                eq(saasConnectors.platform, params.platform),
                isNull(saasConnectors.projectId)
            );

        const [existing] = await db.select().from(saasConnectors).where(whereClause).limit(1);

        if (existing) {
            const [updated] = await db.update(saasConnectors)
                .set({
                    status: params.status,
                    credentialId: params.credentialId,
                    config: withoutReauthorizationFlag({
                        ...(existing.config || {}),
                        ...(params.extra || {}),
                        userInfo: params.userInfo || (existing.config as any)?.userInfo,
                    }),
                    updatedAt: new Date(),
                })
                .where(eq(saasConnectors.id, existing.id))
                .returning();
            return updated;
        }

        const [created] = await db.insert(saasConnectors)
            .values({
                orgId: params.orgId,
                projectId: params.projectId ?? null,
                platform: params.platform,
                status: params.status,
                credentialId: params.credentialId,
                config: withoutReauthorizationFlag({
                    ...(params.extra || {}),
                    userInfo: params.userInfo,
                }),
            })
            .returning();
        return created;
    }

    // --- Provider-Specific Abstract Methods ---

    protected abstract getClientId(): string;
    protected abstract getClientSecret(): string;

    public abstract exchangeCodeForTokens(
        code: string,
        redirectUri: string,
        codeVerifier?: string
    ): Promise<OAuthTokens>;

    public abstract refreshAccessToken(refreshToken: string): Promise<OAuthTokens>;

    protected fetchUserInfo?(accessToken: string): Promise<Record<string, any>>;
    protected onTokensPersisted?(connectorId: number, tokens: OAuthTokens, payload: OAuthStatePayload): Promise<void>;
}
