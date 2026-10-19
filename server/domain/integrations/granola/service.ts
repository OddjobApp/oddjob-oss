import { and, eq } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { userSaasConnections } from '@shared/schema/index.js';
import type { ToolContext } from '@domain/tools/v1/capabilities/types.js';
import { granolaOAuthAdapter } from './granola-oauth.adapter.js';
import { GranolaMcpClient } from './client.js';

export async function findGranolaConnection(organizationId: number, userId: string) {
    const [connection] = await db.select().from(userSaasConnections).where(and(
        eq(userSaasConnections.orgId, organizationId),
        eq(userSaasConnections.userId, userId),
        eq(userSaasConnections.platform, 'granola'),
    )).limit(1);
    return connection ?? null;
}

export async function listUserConnections(organizationId: number, userId: string) {
    return db.select().from(userSaasConnections).where(and(eq(userSaasConnections.orgId, organizationId), eq(userSaasConnections.userId, userId)));
}

export async function updateGranolaAccount(connectionId: number, account: any) {
    const [connection] = await db.select().from(userSaasConnections).where(eq(userSaasConnections.id, connectionId)).limit(1);
    if (!connection || connection.platform !== 'granola') throw new Error('Granola connection not found.');
    const [updated] = await db.update(userSaasConnections).set({ config: { ...(connection.config || {}), accountEmail: account.email ?? account.account?.email ?? null,
        workspaceName: account.workspace_name ?? account.workspace?.name ?? null }, updatedAt: new Date() }).where(eq(userSaasConnections.id, connectionId)).returning();
    return updated;
}

export async function updateGranolaSync(connectionId: number, sync: { enabled: boolean; includeTranscripts: boolean; lookbackDays: number; projectId: number | null }) {
    const [connection] = await db.select().from(userSaasConnections).where(eq(userSaasConnections.id, connectionId)).limit(1);
    if (!connection || connection.platform !== 'granola') throw new Error('Granola connection not found.');
    const [updated] = await db.update(userSaasConnections).set({ config: { ...(connection.config || {}), sync }, updatedAt: new Date() }).where(eq(userSaasConnections.id, connectionId)).returning();
    return updated;
}

export async function getGranolaForContext(context: Pick<ToolContext, 'organizationId' | 'userId'>) {
    const organizationId = Number(context.organizationId);
    const userId = context.userId == null ? '' : String(context.userId);
    if (!Number.isInteger(organizationId) || organizationId <= 0 || !userId) throw new Error('Granola requires an organization and user context.');
    const connection = await findGranolaConnection(organizationId, userId);
    if (!connection || connection.status !== 'connected') throw new Error('Link your Granola account from Settings → Connections, or use connect_platform with platform granola.');
    return { connection, client: new GranolaMcpClient(connection.id, () => granolaOAuthAdapter.getValidAccessToken(connection.id, organizationId, userId)) };
}
