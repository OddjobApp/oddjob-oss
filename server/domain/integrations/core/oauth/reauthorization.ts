/**
 * OAuth reauthorization signalling.
 *
 * When a provider refuses a refresh grant (HTTP 400/401: invalid_grant,
 * revoked) or no refresh token exists, the failure is permanent until a person
 * signs in again — retrying will never succeed. These primitives let adapters
 * mark that state on the connector/connection config so the
 * `/api/me/connections/reauthorizations` surface can prompt the user.
 */

import type { ReauthorizationReason } from '@shared/oauth-reauthorization.js';

export type { ReauthorizationReason } from '@shared/oauth-reauthorization.js';

export class OAuthReauthorizationRequiredError extends Error {
    readonly code = 'OAUTH_REAUTHORIZATION_REQUIRED';
    constructor(
        readonly platform: string,
        readonly reason: ReauthorizationReason,
        message?: string,
    ) {
        super(message ?? `${platform} authorization expired. Reconnect ${platform}.`);
        this.name = 'OAuthReauthorizationRequiredError';
    }
}

export function isReauthorizationRequired(err: unknown): err is OAuthReauthorizationRequiredError {
    return err instanceof OAuthReauthorizationRequiredError
        || (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'OAUTH_REAUTHORIZATION_REQUIRED');
}

export const REAUTH_CONFIG_KEYS = ['reauth_required', 'reauth_reason', 'reauth_at', 'reauth_scopes'] as const;

export function withReauthorizationFlag(
    config: Record<string, any> | null | undefined,
    reason: ReauthorizationReason,
    scopes?: string[],
): Record<string, any> {
    return {
        ...(config || {}),
        reauth_required: true,
        reauth_reason: reason,
        reauth_at: new Date().toISOString(),
        reauth_scopes: scopes,
    };
}

export function withoutReauthorizationFlag(config: Record<string, any> | null | undefined): Record<string, any> {
    const next = { ...(config || {}) };
    for (const key of REAUTH_CONFIG_KEYS) delete next[key];
    return next;
}
