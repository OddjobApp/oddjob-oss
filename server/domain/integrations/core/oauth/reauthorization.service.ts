/**
 * Lists connections whose OAuth grant can no longer be renewed and tells the
 * client where a person re-authorizes each one. Rows are flagged by
 * `markReauthorizationRequired` at refresh time; a successful reconnect clears
 * the flag, so this list is self-healing.
 */

import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { saasConnectors, userSaasConnections } from '@shared/schema/index.js';
import { GOOGLE_CONNECTION_PROFILES, type GoogleConnectionProfile } from '@shared/google-connection.js';
import type { ReauthorizationItem, ReauthorizationReason } from '@shared/oauth-reauthorization.js';

export type { ReauthorizationItem } from '@shared/oauth-reauthorization.js';

export interface ReconnectTarget {
    label: string;
    path: string;
    query?: Record<string, string>;
    opensDashboard?: boolean;
    adminOnly?: boolean;
}

const GOOGLE_IDENTITY_SCOPES = new Set(['openid', 'email', 'profile']);

/**
 * Picks the Google connection profile whose granted (non-identity) scopes are
 * all covered by the stored grant, preferring the broadest match so a combined
 * Gmail+Drive grant lands back on the workspace flow rather than a single
 * product's.
 */
function googleProfileForScopes(scopes?: string[]): GoogleConnectionProfile {
    const granted = new Set(scopes ?? []);
    let best: { profile: GoogleConnectionProfile; count: number } | null = null;
    for (const [profile, def] of Object.entries(GOOGLE_CONNECTION_PROFILES) as [GoogleConnectionProfile, { scopes: readonly string[] }][]) {
        const own = def.scopes.filter(s => !GOOGLE_IDENTITY_SCOPES.has(s));
        if (own.length === 0) continue;
        if (own.every(s => granted.has(s)) && (!best || own.length > best.count)) {
            best = { profile, count: own.length };
        }
    }
    return best?.profile ?? 'workspace';
}

export function reconnectTargetFor(platform: string, ctx: { scopes?: string[] } = {}): ReconnectTarget | undefined {
    switch (platform) {
        case 'jira':
            return { label: 'Jira', path: '/api/saas/connectors/jira/oauth/initiate' };
        case 'google': {
            const profile = googleProfileForScopes(ctx.scopes);
            return {
                label: GOOGLE_CONNECTION_PROFILES[profile].label,
                path: '/api/saas/connectors/google/oauth/initiate',
                query: { for: profile },
                adminOnly: true,
            };
        }
        case 'microsoft365':
            return { label: 'Microsoft 365', path: '/api/saas/connectors/microsoft/oauth/initiate' };
        case 'quickbooks':
            return { label: 'QuickBooks Online', path: '/api/saas/connectors/quickbooks/oauth/initiate', adminOnly: true };
        case 'slack':
            return { label: 'Slack', path: '/admin/integrations', query: { platform: 'slack' }, opensDashboard: true };
        case 'granola':
            return { label: 'Granola', path: '/api/me/connections/granola/oauth/initiate' };
        default:
            return { label: platform, path: '/admin/integrations', query: { platform }, opensDashboard: true };
    }
}

function hasReauthFlag(config: unknown): config is Record<string, any> {
    return typeof config === 'object' && config !== null && (config as Record<string, any>).reauth_required === true;
}

export async function listReauthorizations(scope: {
    organizationId: number;
    userId: string;
    projectId: number | null;
    isOrgAdmin: boolean;
    isSuperAdmin: boolean;
}): Promise<ReauthorizationItem[]> {
    const projectClause = scope.projectId == null
        ? isNull(saasConnectors.projectId)
        : or(isNull(saasConnectors.projectId), eq(saasConnectors.projectId, scope.projectId));

    const [connectors, connections] = await Promise.all([
        db.select().from(saasConnectors).where(and(
            eq(saasConnectors.orgId, scope.organizationId),
            projectClause,
            eq(saasConnectors.status, 'error'),
        )),
        db.select().from(userSaasConnections).where(and(
            eq(userSaasConnections.orgId, scope.organizationId),
            eq(userSaasConnections.userId, scope.userId),
            eq(userSaasConnections.status, 'error'),
        )),
    ]);

    const items: ReauthorizationItem[] = [];
    const push = (kind: ReauthorizationItem['kind'], row: { id: number; platform: string; config: unknown; projectId?: number | null }) => {
        if (!hasReauthFlag(row.config)) return;
        const config = row.config;
        const target = reconnectTargetFor(row.platform, { scopes: Array.isArray(config.reauth_scopes) ? config.reauth_scopes : undefined });
        if (!target) return;
        const params = new URLSearchParams({ orgId: String(scope.organizationId), ...(target.query || {}) });
        if (kind === 'organization' && row.projectId != null) params.set('projectId', String(row.projectId));
        items.push({
            kind,
            platform: row.platform,
            label: target.label,
            connectorId: row.id,
            projectId: kind === 'organization' ? row.projectId ?? null : null,
            reason: (typeof config.reauth_reason === 'string' ? config.reauth_reason : null) as ReauthorizationReason | null,
            since: typeof config.reauth_at === 'string' ? config.reauth_at : null,
            reconnectUrl: `${target.path}?${params}`,
            opensDashboard: target.opensDashboard === true,
            canReauthorize: target.adminOnly ? Boolean(scope.isOrgAdmin || scope.isSuperAdmin) : true,
        });
    };

    for (const connector of connectors) push('organization', connector);
    for (const connection of connections) push('user', connection);
    return items;
}
