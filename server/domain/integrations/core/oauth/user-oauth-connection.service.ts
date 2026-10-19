import { and, eq } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { encryptedCredentialsService, type CredentialData } from '@domain/auth/core/encrypted-credentials.service.js';
import { userSaasConnections, type UserSaasConnection } from '@shared/schema/index.js';
import type { OAuthTokens } from './oauth-adapter.types.js';
import {
    OAuthReauthorizationRequiredError,
    isReauthorizationRequired,
    withReauthorizationFlag,
    withoutReauthorizationFlag,
    type ReauthorizationReason,
} from './reauthorization.js';

export interface UserOAuthConnectionScope {
    organizationId: number;
    userId: string;
}

export interface ConnectUserOAuthInput extends UserOAuthConnectionScope {
    config?: Record<string, unknown>;
    tokens: OAuthTokens;
}

export class UserOAuthConnectionService {
    private readonly refreshes = new Map<number, Promise<string>>();

    constructor(readonly platform: string, readonly credentialType = `${platform}_oauth_token`) {}

    async find(scope: UserOAuthConnectionScope) {
        const [connection] = await db.select().from(userSaasConnections).where(and(
            eq(userSaasConnections.orgId, scope.organizationId),
            eq(userSaasConnections.userId, scope.userId),
            eq(userSaasConnections.platform, this.platform),
        )).limit(1);
        return connection ?? null;
    }

    async get(connectionId: number, scope: UserOAuthConnectionScope) {
        const [connection] = await db.select().from(userSaasConnections).where(and(
            eq(userSaasConnections.id, connectionId),
            eq(userSaasConnections.orgId, scope.organizationId),
            eq(userSaasConnections.userId, scope.userId),
            eq(userSaasConnections.platform, this.platform),
        )).limit(1);
        return connection ?? null;
    }

    async connect(input: ConnectUserOAuthInput) {
        const existing = await this.find(input);
        const config = withoutReauthorizationFlag({ ...(existing?.config || {}), ...(input.config || {}), scopes: input.tokens.scopes });
        const values = { status: 'connected', config, updatedAt: new Date() };
        const [connection] = existing
            ? await db.update(userSaasConnections).set(values).where(and(eq(userSaasConnections.id, existing.id), eq(userSaasConnections.orgId, input.organizationId), eq(userSaasConnections.userId, input.userId))).returning()
            : await db.insert(userSaasConnections).values({ orgId: input.organizationId, userId: input.userId, platform: this.platform, ...values }).returning();
        const credential = await this.storeTokens(connection, input.tokens);
        const [updated] = await db.update(userSaasConnections).set({ credentialId: credential.id }).where(and(eq(userSaasConnections.id, connection.id), eq(userSaasConnections.orgId, input.organizationId), eq(userSaasConnections.userId, input.userId))).returning();
        return updated;
    }

    async credentials(connection: UserSaasConnection) {
        this.assertPlatform(connection);
        return encryptedCredentialsService.retrieve(connection.orgId, 'user_connection', connection.id, this.credentialType);
    }

    async storeTokens(connection: UserSaasConnection, tokens: OAuthTokens, prior?: CredentialData) {
        this.assertPlatform(connection);
        return encryptedCredentialsService.store(connection.orgId, 'user_connection', connection.id, this.credentialType, {
            ...prior,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken || prior?.refreshToken,
            tokenType: tokens.tokenType || prior?.tokenType || 'Bearer',
            expiresAt: tokens.expiresAt?.toISOString() ?? null,
            scopes: tokens.scopes || prior?.scopes,
        });
    }

    async validAccessToken(connection: UserSaasConnection, refresh: (refreshToken: string, connection: UserSaasConnection) => Promise<OAuthTokens>) {
        this.assertPlatform(connection);
        if (connection.status !== 'connected') throw new Error(`${this.platform} is not connected.`);
        const pending = this.refreshes.get(connection.id);
        if (pending) return pending;
        const operation = (async () => {
            const stored = await this.credentials(connection);
            if (!stored?.accessToken) {
                await this.markReauthorizationRequired(connection, 'credentials_missing');
                throw new OAuthReauthorizationRequiredError(this.platform, 'credentials_missing',
                    `${this.platform} credentials are missing. Reconnect ${this.platform}.`);
            }
            const expiring = stored.expiresAt && new Date(stored.expiresAt).getTime() - Date.now() < 5 * 60_000;
            if (!expiring) return String(stored.accessToken);
            if (!stored.refreshToken) {
                // Still inside the safety window: the token works until it expires.
                if (new Date(stored.expiresAt!).getTime() > Date.now()) return String(stored.accessToken);
                await this.markReauthorizationRequired(connection, 'no_refresh_token', stored.scopes);
                throw new OAuthReauthorizationRequiredError(this.platform, 'no_refresh_token',
                    `${this.platform} authorization expired. Reconnect ${this.platform}.`);
            }
            try {
                const refreshed = await refresh(String(stored.refreshToken), connection);
                await this.storeTokens(connection, refreshed, stored);
                if ((connection.config as Record<string, unknown> | null)?.reauth_required) {
                    await db.update(userSaasConnections).set({ status: 'connected', config: withoutReauthorizationFlag(connection.config), updatedAt: new Date() }).where(and(
                        eq(userSaasConnections.id, connection.id), eq(userSaasConnections.orgId, connection.orgId), eq(userSaasConnections.userId, connection.userId),
                    ));
                }
                return refreshed.accessToken;
            } catch (err) {
                if (isReauthorizationRequired(err)) {
                    await this.markReauthorizationRequired(connection, err.reason, stored.scopes);
                }
                throw err;
            }
        })();
        this.refreshes.set(connection.id, operation);
        try { return await operation; } finally { this.refreshes.delete(connection.id); }
    }

    async disconnect(connection: UserSaasConnection) {
        this.assertPlatform(connection);
        const deleted = await encryptedCredentialsService.delete(connection.orgId, 'user_connection', connection.id, this.credentialType);
        if (!deleted) throw new Error(`Could not remove ${this.platform} credentials.`);
        await db.update(userSaasConnections).set({ status: 'disconnected', credentialId: null, updatedAt: new Date() }).where(and(
            eq(userSaasConnections.id, connection.id), eq(userSaasConnections.orgId, connection.orgId), eq(userSaasConnections.userId, connection.userId), eq(userSaasConnections.platform, this.platform),
        ));
    }

    private async markReauthorizationRequired(connection: UserSaasConnection, reason: ReauthorizationReason, scopes?: string[]) {
        await db.update(userSaasConnections).set({
            status: 'error',
            config: withReauthorizationFlag(connection.config, reason, scopes),
            updatedAt: new Date(),
        }).where(and(
            eq(userSaasConnections.id, connection.id), eq(userSaasConnections.orgId, connection.orgId), eq(userSaasConnections.userId, connection.userId), eq(userSaasConnections.platform, this.platform),
        ));
    }

    private assertPlatform(connection: UserSaasConnection) {
        if (connection.platform !== this.platform) throw new Error(`Connection ${connection.id} does not belong to ${this.platform}.`);
    }
}
