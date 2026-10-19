import { db } from '@server/database_service.js';
import { saasConnectors } from '@shared/schema/index.js';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { microsoftOAuthAdapter } from './core/oauth/microsoft-oauth.adapter.js';

/** Resolve only the current project's or organization's encrypted OAuth connection. */
export async function getMicrosoftDocumentToken(orgId?: number | null, projectId?: number | null) {
    if (orgId == null) throw new Error('Microsoft 365 requires an organization connection.');
    const [connector] = await db.select({ id: saasConnectors.id }).from(saasConnectors)
        .where(and(eq(saasConnectors.orgId, orgId), eq(saasConnectors.platform, 'microsoft365'),
            projectId == null ? isNull(saasConnectors.projectId) : or(isNull(saasConnectors.projectId), eq(saasConnectors.projectId, projectId))))
        .orderBy(sql`${saasConnectors.projectId} DESC NULLS LAST`).limit(1);
    if (!connector) throw new Error('Connect Microsoft 365 in this project’s Integrations to read OneDrive or SharePoint documents.');
    return microsoftOAuthAdapter.getValidAccessToken(connector.id);
}
