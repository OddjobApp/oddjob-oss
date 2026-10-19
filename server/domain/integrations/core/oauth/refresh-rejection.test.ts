import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@server/database_service.js', () => ({ db: {} }));
vi.mock('@domain/core/infrastructure/redis/redis-client.js', () => ({ redis: {} }));
vi.mock('@domain/auth/core/encrypted-credentials.service.js', () => ({ encryptedCredentialsService: {} }));
vi.mock('@server/utils/auth-context.js', () => ({ getUserOrgContext: vi.fn(), requireOrgId: (c: any) => c.organizationId }));

import { JiraOAuthAdapter } from './jira-oauth.adapter.js';
import { GoogleOAuthAdapter } from './google-oauth.adapter.js';
import { MicrosoftOAuthAdapter } from './microsoft-oauth.adapter.js';
import { SlackOAuthAdapter } from './slack-oauth.adapter.js';
import { QuickBooksOAuthAdapter } from './quickbooks-oauth.adapter.js';
import { GranolaOAuthAdapter } from '@domain/integrations/granola/granola-oauth.adapter.js';
import { isReauthorizationRequired } from './reauthorization.js';

const ENV: Record<string, string> = {
    JIRA_CLIENT_ID: 'id', JIRA_CLIENT_SECRET: 'secret',
    GMAIL_CLIENT_ID: 'id', GMAIL_CLIENT_SECRET: 'secret',
    MICROSOFT_CLIENT_ID: 'id', MICROSOFT_CLIENT_SECRET: 'secret',
    SLACK_CLIENT_ID: 'id', SLACK_CLIENT_SECRET: 'secret',
    QUICKBOOKS_CLIENT_ID: 'id', QUICKBOOKS_CLIENT_SECRET: 'secret', QUICKBOOKS_ENVIRONMENT: 'sandbox',
    GRANOLA_CLIENT_ID: 'id',
};

const adapters = [
    ['jira', () => new JiraOAuthAdapter()],
    ['google', () => new GoogleOAuthAdapter()],
    ['microsoft365', () => new MicrosoftOAuthAdapter()],
    ['slack', () => new SlackOAuthAdapter()],
    ['quickbooks', () => new QuickBooksOAuthAdapter()],
    ['granola', () => new GranolaOAuthAdapter()],
] as const;

function httpError(status: number) {
    return { ok: false, status, text: async () => 'provider-error', json: async () => ({}) };
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(adapters)('%s refresh rejection', (_platform, make) => {
    it('throws OAuthReauthorizationRequiredError when the provider answers 401', async () => {
        for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(httpError(401)));
        const err = await make().refreshAccessToken('refresh-token').catch((e: unknown) => e);
        expect(isReauthorizationRequired(err)).toBe(true);
        expect((err as { reason?: string }).reason).toBe('refresh_rejected');
    });

    it('keeps a 503 as a plain transient error', async () => {
        for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(httpError(503)));
        const err = await make().refreshAccessToken('refresh-token').catch((e: unknown) => e);
        expect(isReauthorizationRequired(err)).toBe(false);
        expect(err).toBeInstanceOf(Error);
    });
});

describe('slack api-level rejection', () => {
    it('flags invalid_refresh_token even on HTTP 200', async () => {
        for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: 'invalid_refresh_token' }) }));
        const err = await new SlackOAuthAdapter().refreshAccessToken('r').catch((e: unknown) => e);
        expect(isReauthorizationRequired(err)).toBe(true);
    });

    it('does not flag other slack errors', async () => {
        for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: false, error: 'ratelimited' }) }));
        const err = await new SlackOAuthAdapter().refreshAccessToken('r').catch((e: unknown) => e);
        expect(isReauthorizationRequired(err)).toBe(false);
    });
});
