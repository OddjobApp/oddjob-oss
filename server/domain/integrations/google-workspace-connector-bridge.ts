import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { saasConnectors } from '@shared/schema/index.js';
import { encryptedCredentialsService } from '@domain/auth/core/encrypted-credentials.service.js';
import { googleOAuthAdapter } from './core/oauth/google-oauth.adapter.js';

export async function findGoogleConnection(orgId: number, projectId: number | null) {
  if (!Number.isInteger(orgId) || orgId <= 0) throw new Error('Google requires an organization.');
  const [connector] = await db.select().from(saasConnectors).where(and(
    eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, 'google'),
    projectId == null ? isNull(saasConnectors.projectId) : or(isNull(saasConnectors.projectId), eq(saasConnectors.projectId, projectId)),
  )).orderBy(sql`${saasConnectors.projectId} DESC NULLS LAST`).limit(1);
  return connector ?? null;
}

/** Disconnect only this org/project grant; do not revoke a Google grant used elsewhere. */
export async function disconnectGoogleConnection(orgId: number, projectId: number | null) {
  const connector = await findGoogleConnection(orgId, projectId);
  if (!connector) return;
  if (projectId != null && connector.projectId == null) throw new Error('Disconnect an inherited Google connection from organization Integrations.');
  if (!await encryptedCredentialsService.delete(orgId, 'saas_connector', connector.id, 'google_oauth_token')) throw new Error('Could not remove Google credentials.');
  await db.update(saasConnectors).set({ status: 'disconnected', credentialId: null, updatedAt: new Date() })
    .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.id, connector.id)));
}

export type GoogleAccess = 'gmail_read' | 'gmail_send' | 'drive_read' | 'drive_write' | 'calendar_read' | 'calendar_write' | 'gmail_modify' | 'youtube_read' | 'youtube_write';
const allowedScopes: Record<GoogleAccess, string[]> = {
  youtube_read: ['https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl'],
  youtube_write: ['https://www.googleapis.com/auth/youtube', 'https://www.googleapis.com/auth/youtube.force-ssl'],
  gmail_modify: ['https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'],
  calendar_write: ['https://www.googleapis.com/auth/calendar'],
  calendar_read: ['https://www.googleapis.com/auth/calendar.readonly', 'https://www.googleapis.com/auth/calendar'],
  gmail_read: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'],
  gmail_send: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.modify', 'https://mail.google.com/'],
  drive_read: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'],
  drive_write: ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/drive.file'],
};

/** Use the same encrypted OAuth connection created by the adapter UI. */
export async function getGoogleWorkspaceToken(orgId: number | null | undefined, projectId: number | null | undefined, access: GoogleAccess): Promise<string | null> {
  if (orgId == null) return null;
  const connectors = await db.select().from(saasConnectors).where(and(
    eq(saasConnectors.orgId, orgId),
    inArray(saasConnectors.platform, ['google', 'google_drive', 'google_docs', 'gmail', 'google_workspace']),
    projectId == null ? isNull(saasConnectors.projectId) : or(isNull(saasConnectors.projectId), eq(saasConnectors.projectId, projectId)),
    eq(saasConnectors.status, 'connected'),
  )).orderBy(sql`${saasConnectors.projectId} DESC NULLS LAST`);
  for (const connector of connectors) {
    const stored = await encryptedCredentialsService.retrieve(connector.orgId, 'saas_connector', connector.id, 'google_oauth_token');
    const scopes: string[] = Array.isArray(stored?.scopes) ? stored.scopes : [];
    if (!scopes.some(scope => allowedScopes[access].includes(scope))) continue;
    return googleOAuthAdapter.getValidAccessToken(connector.id);
  }
  return null;
}
