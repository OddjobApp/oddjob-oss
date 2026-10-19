import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { saasConnectors, saasSyncLinks } from '@shared/schema/index.js';
import { quickBooksEnvironment, quickBooksOAuthAdapter } from '../core/oauth/quickbooks-oauth.adapter.js';
import { QuickBooksClient } from './client.js';
import { encryptedCredentialsService } from '@domain/auth/core/encrypted-credentials.service.js';

export async function findQuickBooksConnection(organizationId: number, projectId?: number | null) {
    if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error('QuickBooks requires an organization.');
    const [connector] = await db.select().from(saasConnectors).where(and(eq(saasConnectors.orgId, organizationId), eq(saasConnectors.platform, 'quickbooks'),
        projectId == null ? isNull(saasConnectors.projectId) : or(eq(saasConnectors.projectId, projectId), isNull(saasConnectors.projectId))))
        .orderBy(sql`${saasConnectors.projectId} DESC NULLS LAST`).limit(1);
    return connector ?? null;
}
export async function getQuickBooksClient(organizationId: number | null | undefined, projectId?: number | null) {
    if (organizationId == null) throw new Error('QuickBooks requires an organization context.');
    const connector = await findQuickBooksConnection(organizationId, projectId);
    if (!connector || connector.status !== 'connected') throw new Error('Connect QuickBooks Online in this project’s Integrations, or use connect_platform with platform quickbooks.');
    const config = connector.config as Record<string, unknown>;
    if (typeof config.realmId !== 'string' || (config.environment !== 'sandbox' && config.environment !== 'production')) throw new Error('QuickBooks company configuration is incomplete. Reconnect.');
    return { connectorId: connector.id, client: new QuickBooksClient(config.realmId, config.environment, () => quickBooksOAuthAdapter.getValidAccessToken(connector.id)) };
}

export async function disconnectQuickBooks(organizationId: number, projectId?: number | null) {
    const connector = await findQuickBooksConnection(organizationId, projectId);
    if (!connector) return;
    if (projectId != null && connector.projectId == null) throw new Error('Disconnect this inherited connection from organization Integrations.');
    const stored = await encryptedCredentialsService.retrieve(connector.orgId, 'saas_connector', connector.id, 'quickbooks_oauth_token');
    if (stored?.refreshToken || stored?.accessToken) {
        const realmId = (connector.config as Record<string, unknown>).realmId;
        const peers = typeof realmId === 'string' ? await findConnectorsByRealmId(realmId) : [];
        // Intuit revocation affects the app/company grant, not just this local row.
        // Keep that grant while another organization/project still uses it.
        if (!peers.some(peer => peer.id !== connector.id)) {
            const response = await fetch('https://developer.api.intuit.com/v2/oauth2/tokens/revoke', {
                method: 'POST', signal: AbortSignal.timeout(30_000),
                headers: { Authorization: `Basic ${Buffer.from(`${process.env.QUICKBOOKS_CLIENT_ID ?? ''}:${process.env.QUICKBOOKS_CLIENT_SECRET ?? ''}`).toString('base64')}`, 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ token: stored.refreshToken ?? stored.accessToken }),
            });
            if (!response.ok) throw new Error(`QuickBooks revocation failed (${response.status}). The connection has not been removed.`);
        }
    }
    if (!await encryptedCredentialsService.delete(connector.orgId, 'saas_connector', connector.id, 'quickbooks_oauth_token')) throw new Error('Could not remove QuickBooks credentials.');
    await db.update(saasConnectors).set({ status: 'disconnected', credentialId: null,
        config: sql`${saasConnectors.config} || '{"enabled":false}'::jsonb`, updatedAt: new Date() })
        .where(and(eq(saasConnectors.id, connector.id), eq(saasConnectors.orgId, organizationId)));
}

/** System-only webhook fan-out: each active grant supplies its own tenant context. Never expose this as an unscoped user lookup. */
export async function findConnectorsByRealmId(realmId: string) {
    if (!/^\d{1,30}$/.test(realmId)) return [];
    return db.select().from(saasConnectors)
        .where(and(eq(saasConnectors.platform, 'quickbooks'), eq(saasConnectors.status, 'connected'),
            sql`${saasConnectors.config}->>'realmId' = ${realmId}`,
            sql`${saasConnectors.config}->>'environment' = ${quickBooksEnvironment()}`));
}

export function quickBooksRecordKey(connector: { id: number; config: unknown }, entity: string, remoteId: string) {
    const realmId = (connector.config as Record<string, unknown>)?.realmId;
    if (!Number.isInteger(connector.id) || connector.id <= 0 || typeof realmId !== 'string' || !/^\d{1,30}$/.test(realmId) || !/^\d{1,30}$/.test(remoteId)) throw new Error('Invalid QuickBooks mirror identity.');
    return `qbo:${realmId}:${connector.id}:${entity.toLowerCase()}:${remoteId}`;
}

export function assertQuickBooksScope(connector: { orgId: number; status: string; platform: string }, organizationId: number) {
    if (!Number.isInteger(organizationId) || organizationId <= 0 || connector.orgId !== organizationId || connector.platform !== 'quickbooks' || connector.status !== 'connected') throw new Error('QuickBooks connector is not active in this organization.');
}

/** Client bound to a specific connector row (webhooks and scheduled sync resolve it themselves). */
export function clientForConnector(connector: { id: number; config: unknown }) {
    const config = connector.config as Record<string, unknown>;
    if (typeof config.realmId !== 'string' || (config.environment !== 'sandbox' && config.environment !== 'production'))
        throw new Error('QuickBooks company configuration is incomplete. Reconnect.');
    return new QuickBooksClient(config.realmId, config.environment, () => quickBooksOAuthAdapter.getValidAccessToken(connector.id));
}

export interface SyncLinkInput {
    direction?: 'in' | 'out';
    localCollection: string;
    localRecordId: string;
    remoteEntity: string;
    remoteId: string;
    remoteSyncToken?: string | null;
    remoteData?: Record<string, unknown>;
    remoteUpdatedAt?: Date | null;
    localHash?: string | null;
}

export async function findSyncLink(connectorId: number, remoteEntity: string, remoteId: string, orgId: number) {
    if (!Number.isInteger(orgId) || orgId <= 0) throw new Error('QuickBooks sync links require an organization.');
    const [link] = await db.select().from(saasSyncLinks).where(and(
        eq(saasSyncLinks.orgId, orgId), eq(saasSyncLinks.connectorId, connectorId), eq(saasSyncLinks.remoteEntity, remoteEntity), eq(saasSyncLinks.remoteId, remoteId))).limit(1);
    return link ?? null;
}

/** Create or refresh the remote↔local pair for one mirrored record. */
export async function upsertSyncLink(connectorId: number, orgId: number, link: SyncLinkInput) {
    if (!Number.isInteger(orgId) || orgId <= 0) throw new Error('QuickBooks sync links require an organization.');
    const [owner] = await db.select().from(saasConnectors).where(and(eq(saasConnectors.id, connectorId), eq(saasConnectors.orgId, orgId))).limit(1);
    if (!owner) throw new Error('QuickBooks connector does not belong to this organization.');
    assertQuickBooksScope(owner, orgId);
    const existing = await findSyncLink(connectorId, link.remoteEntity, link.remoteId, orgId);
    const fields = {
        direction: link.direction ?? existing?.direction ?? 'in',
        localCollection: link.localCollection,
        localRecordId: link.localRecordId,
        remoteSyncToken: link.remoteSyncToken ?? existing?.remoteSyncToken ?? null,
        remoteData: link.remoteData ?? existing?.remoteData ?? null,
        remoteUpdatedAt: link.remoteUpdatedAt ?? existing?.remoteUpdatedAt ?? null,
        localHash: link.localHash ?? existing?.localHash ?? null,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
    };
    if (existing) {
        await db.update(saasSyncLinks).set(fields)
            .where(and(eq(saasSyncLinks.id, existing.id), eq(saasSyncLinks.orgId, orgId)));
        return { ...existing, ...fields };
    }
    const [inserted] = await db.insert(saasSyncLinks).values({
        connectorId, orgId, ...fields,
        remoteEntity: link.remoteEntity, remoteId: link.remoteId,
    }).returning();
    return inserted;
}

export async function deleteSyncLink(connectorId: number, remoteEntity: string, remoteId: string, orgId: number) {
    if (!Number.isInteger(orgId) || orgId <= 0) throw new Error('QuickBooks sync links require an organization.');
    await db.delete(saasSyncLinks).where(and(
        eq(saasSyncLinks.orgId, orgId), eq(saasSyncLinks.connectorId, connectorId), eq(saasSyncLinks.remoteEntity, remoteEntity), eq(saasSyncLinks.remoteId, remoteId)));
}
