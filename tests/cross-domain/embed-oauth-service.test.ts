/**
 * Embed OAuth Service tests
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createOAuthState,
    consumeOAuthState,
    getAuthorizationUrl,
    exchangeCodeForTokens,
    getEmbedOAuthCookieName,
    buildEmbedOAuthCookie,
    getEmbedOAuthTokenFromCookie,
} from "@domain/auth/core/embed-oauth.service.js";

describe('Embed OAuth Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createOAuthState and consumeOAuthState', () => {
        it('creates state and consumes it successfully', () => {
            const state = createOAuthState('my-agent', 42, 1);
            expect(state).toBeDefined();
            expect(typeof state).toBe('string');
            expect(state.length).toBeGreaterThan(0);

            const entry = consumeOAuthState(state);
            expect(entry).toEqual({
                slug: 'my-agent',
                deploymentId: 42,
                organizationId: 1,
                createdAt: expect.any(Number),
            });
        });

        it('returns null when consuming invalid state', () => {
            const entry = consumeOAuthState('invalid-state-xyz');
            expect(entry).toBeNull();
        });

        it('returns null when consuming same state twice', () => {
            const state = createOAuthState('agent', 1, 1);
            expect(consumeOAuthState(state)).not.toBeNull();
            expect(consumeOAuthState(state)).toBeNull();
        });
    });

    describe('getAuthorizationUrl', () => {
        it('returns URL when config is valid', () => {
            const config = {
                embedOAuthEnabled: true,
                embedOAuthClientId: 'client-123',
                embedOAuthAuthUrl: 'https://idp.example.com/authorize',
                embedOAuthRedirectUri: 'https://oddjob.app/callback',
                embedOAuthScopes: ['openid', 'profile'],
            };
            const url = getAuthorizationUrl(config, 'state-xyz');
            expect(url).toContain('https://idp.example.com/authorize');
            expect(url).toContain('client_id=client-123');
            expect(url).toContain('state=state-xyz');
            expect(url).toContain('response_type=code');
            expect(url).toContain('scope=openid+profile');
        });

        it('returns null when OAuth not enabled', () => {
            const config = {
                embedOAuthEnabled: false,
                embedOAuthClientId: 'client-123',
                embedOAuthAuthUrl: 'https://idp.example.com/authorize',
            };
            expect(getAuthorizationUrl(config, 'state')).toBeNull();
        });

        it('returns null when clientId missing', () => {
            const config = {
                embedOAuthEnabled: true,
                embedOAuthAuthUrl: 'https://idp.example.com/authorize',
            };
            expect(getAuthorizationUrl(config, 'state')).toBeNull();
        });

        it('returns null when authUrl missing', () => {
            const config = {
                embedOAuthEnabled: true,
                embedOAuthClientId: 'client-123',
            };
            expect(getAuthorizationUrl(config, 'state')).toBeNull();
        });
    });

    describe('exchangeCodeForTokens', () => {
        it('returns tokens on successful exchange', async () => {
            const originalFetch = globalThis.fetch;
            globalThis.fetch = vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({
                    access_token: 'at-123',
                    refresh_token: 'rt-456',
                    expires_in: 3600,
                }),
            });

            const config = {
                embedOAuthTokenUrl: 'https://idp.example.com/token',
                embedOAuthClientId: 'client-123',
                embedOAuthClientSecretRef: 'TEST_OAUTH_SECRET',
            };
            process.env.TEST_OAUTH_SECRET = 'secret';

            const result = await exchangeCodeForTokens(config, 'code-xyz', 'https://oddjob.app/callback');

            expect(result).toEqual({
                accessToken: 'at-123',
                refreshToken: 'rt-456',
                expiresIn: 3600,
            });
            expect(globalThis.fetch).toHaveBeenCalledWith(
                'https://idp.example.com/token',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                })
            );

            globalThis.fetch = originalFetch;
            delete process.env.TEST_OAUTH_SECRET;
        });

        it('returns null when tokenUrl missing', async () => {
            const config = {
                embedOAuthClientId: 'client-123',
                embedOAuthClientSecretRef: 'TEST_OAUTH_SECRET',
            };
            process.env.TEST_OAUTH_SECRET = 'secret';
            const result = await exchangeCodeForTokens(config, 'code', 'https://oddjob.app/callback');
            expect(result).toBeNull();
            delete process.env.TEST_OAUTH_SECRET;
        });

        it('returns null when clientSecret missing', async () => {
            const config = {
                embedOAuthTokenUrl: 'https://idp.example.com/token',
                embedOAuthClientId: 'client-123',
                embedOAuthClientSecretRef: 'MISSING_ENV_VAR',
            };
            const result = await exchangeCodeForTokens(config, 'code', 'https://oddjob.app/callback');
            expect(result).toBeNull();
        });

        it('returns null on HTTP error', async () => {
            globalThis.fetch = vi.fn().mockResolvedValue({ ok: false });

            const config = {
                embedOAuthTokenUrl: 'https://idp.example.com/token',
                embedOAuthClientId: 'client-123',
                embedOAuthClientSecretRef: 'TEST_OAUTH_SECRET',
            };
            process.env.TEST_OAUTH_SECRET = 'secret';

            const result = await exchangeCodeForTokens(config, 'code', 'https://oddjob.app/callback');

            expect(result).toBeNull();
            delete process.env.TEST_OAUTH_SECRET;
        });
    });

    describe('getEmbedOAuthCookieName', () => {
        it('returns cookie name', () => {
            expect(getEmbedOAuthCookieName()).toBe('oddjob_embed_oauth');
        });
    });

    describe('buildEmbedOAuthCookie', () => {
        it('builds cookie string with token and maxAge', () => {
            const cookie = buildEmbedOAuthCookie('token-xyz', 3600);
            expect(cookie).toContain('oddjob_embed_oauth=token-xyz');
            expect(cookie).toContain('Max-Age=3600');
            expect(cookie).toContain('HttpOnly');
            expect(cookie).toContain('Secure');
        });
    });

    describe('getEmbedOAuthTokenFromCookie', () => {
        it('extracts token from cookie header', () => {
            const header = 'oddjob_embed_oauth=my-token; Path=/';
            expect(getEmbedOAuthTokenFromCookie(header)).toBe('my-token');
        });

        it('returns null when cookie header missing', () => {
            expect(getEmbedOAuthTokenFromCookie(undefined)).toBeNull();
        });

        it('returns null when cookie not present', () => {
            expect(getEmbedOAuthTokenFromCookie('other=value')).toBeNull();
        });
    });
});
