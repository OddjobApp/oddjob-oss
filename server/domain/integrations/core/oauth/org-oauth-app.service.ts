import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { encryptedCredentialsService } from '@domain/auth/core/encrypted-credentials.service.js';

export type OAuthAppProvider = 'google' | 'quickbooks';
export interface OAuthAppCredentials {
    clientId: string;
    clientSecret: string;
    environment?: 'sandbox' | 'production';
}
const context = new AsyncLocalStorage<OAuthAppCredentials>();
export const currentOAuthApp = () => context.getStore();
export const oauthAppFingerprint = (app: OAuthAppCredentials) => createHash('sha256')
    .update(JSON.stringify([app.clientId, app.clientSecret, app.environment])).digest('hex');

function assertOrg(orgId: number) {
    if (!Number.isInteger(orgId) || orgId <= 0) throw new Error('OAuth app settings require an organization.');
}
export async function readOrgOAuthApp(orgId: number, provider: OAuthAppProvider): Promise<OAuthAppCredentials | null> {
    assertOrg(orgId);
    const stored = await encryptedCredentialsService.retrieve(orgId, 'organization_oauth_app', orgId, provider);
    if (!stored) {
        if (await encryptedCredentialsService.exists(orgId, 'organization_oauth_app', orgId, provider)) {
            throw new Error('Organization OAuth app could not be decrypted. Ask an organization admin to save its credentials again.');
        }
        return null;
    }
    if (typeof stored.clientId !== 'string' || !stored.clientId || typeof stored.clientSecret !== 'string' || !stored.clientSecret ||
        (provider === 'quickbooks' && stored.environment !== 'sandbox' && stored.environment !== 'production')) {
        throw new Error('Organization OAuth app configuration is invalid.');
    }
    return stored as OAuthAppCredentials;
}
export async function resolveOAuthApp(orgId: number, provider: OAuthAppProvider): Promise<OAuthAppCredentials> {
    const stored = await readOrgOAuthApp(orgId, provider);
    if (stored) return stored;
    return provider === 'google' ? {
        clientId: process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
    } : {
        clientId: process.env.QUICKBOOKS_CLIENT_ID || '', clientSecret: process.env.QUICKBOOKS_CLIENT_SECRET || '',
        environment: process.env.QUICKBOOKS_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    };
}
export async function saveOrgOAuthApp(orgId: number, provider: OAuthAppProvider, app: OAuthAppCredentials) {
    assertOrg(orgId);
    await encryptedCredentialsService.store(orgId, 'organization_oauth_app', orgId, provider, app);
}
export async function withOrgOAuthApp<T>(orgId: number, provider: string, operation: () => Promise<T>): Promise<T> {
    if (provider !== 'google' && provider !== 'quickbooks') return operation();
    return context.run(await resolveOAuthApp(orgId, provider), operation);
}
