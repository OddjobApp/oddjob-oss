import { Router, type Request, type Response } from 'express';
import { requireAuth } from '@domain/core/auth/security.service.js';
import { asyncHandler } from '@server/middleware/error-handler.js';
import { getUserOrgContext, requireOrgId } from '@server/utils/auth-context.js';
import { BadRequestError } from '@server/utils/errors.js';
import { findGranolaConnection, listUserConnections, updateGranolaAccount, updateGranolaSync } from '@domain/integrations/granola/service.js';
import { granolaOAuthAdapter } from '@domain/integrations/granola/granola-oauth.adapter.js';
import { GranolaMcpClient } from '@domain/integrations/granola/client.js';
import { resolveProjectScope } from '@server/middleware/project-scope.js';
import { syncGranolaConnection } from '@domain/integrations/granola/sync.js';
import { getGranolaForContext } from '@domain/integrations/granola/service.js';
import { shareMeetingIntoRoom } from '@domain/integrations/granola/rooms.js';
import { workspaceResultPayload } from '@domain/crew/core/crew-workspace-results.js';
import { listReauthorizations } from '@domain/integrations/core/oauth/reauthorization.service.js';

const router = Router();
async function caller(req: Request) {
    const context = await getUserOrgContext(req);
    const organizationId = requireOrgId(context);
    if (!context.userId) throw new BadRequestError('A signed-in user is required.');
    return { organizationId, userId: String(context.userId) };
}
function publicConnection(connection: any) {
    if (!connection) return null;
    const config = connection.config || {};
    return { id: connection.id, platform: connection.platform, status: connection.status, accountEmail: config.accountEmail ?? null,
        workspaceName: config.workspaceName ?? null, lastSyncAt: connection.lastSyncAt, sync: config.sync ?? { enabled: false } };
}

router.get('/connections', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await caller(req);
    res.json({ connections: (await listUserConnections(c.organizationId, c.userId)).map(publicConnection) });
}));

/**
 * Connections whose OAuth grant expired and cannot be renewed — the
 * "Reauthorize <Platform>" list. Project-scoped when a project is named, so a
 * room sees its own space's connectors plus org-wide ones.
 */
router.get('/connections/reauthorizations', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const context = await getUserOrgContext(req);
    const organizationId = requireOrgId(context);
    if (!context.userId) throw new BadRequestError('A signed-in user is required.');
    const project = req.query.projectId || req.query.projectKey ? await resolveProjectScope(req) : null;
    const items = await listReauthorizations({
        organizationId,
        userId: String(context.userId),
        projectId: project?.id ?? null,
        isOrgAdmin: context.isOrgAdmin,
        isSuperAdmin: context.isSuperAdmin,
    });
    res.json({ items });
}));

router.get('/connections/granola/oauth/status', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await caller(req);
    res.json({ configured: true, callbackUri: granolaOAuthAdapter.resolveRedirectUri(req), connection: publicConnection(await findGranolaConnection(c.organizationId, c.userId)) });
}));

router.get('/connections/granola/oauth/initiate', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await caller(req);
    const result = await granolaOAuthAdapter.getAuthorizationUrl({ organizationId: c.organizationId, req,
        returnTo: typeof req.query.returnTo === 'string' ? req.query.returnTo : '/settings', extraState: { userId: c.userId } });
    res.redirect(result.url);
}));

router.get('/connections/granola/oauth/callback', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (req.query.error) throw new BadRequestError('Granola authorization was declined. You can try connecting again.');
    if (typeof req.query.code !== 'string' || typeof req.query.state !== 'string') throw new BadRequestError('Missing Granola authorization code or state.');
    const c = await caller(req);
    const result = await granolaOAuthAdapter.handleCallback({ code: req.query.code, stateId: req.query.state, req, validateState: state => {
        if (state.organizationId !== c.organizationId || state.extra?.userId !== c.userId) throw new Error('Granola OAuth state belongs to a different user or organization.');
    } });
    const connectionId = result.connectorId!;
    const account = await new GranolaMcpClient(connectionId, () => granolaOAuthAdapter.getValidAccessToken(connectionId, c.organizationId, c.userId)).accountInfo().catch(() => null);
    if (account) await updateGranolaAccount(connectionId, account);
    res.redirect(result.returnTo || '/settings');
}));

router.post('/connections/granola/test', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await caller(req);
    const connection = await findGranolaConnection(c.organizationId, c.userId);
    if (!connection || connection.status !== 'connected') throw new BadRequestError('Granola is not connected.');
    const account = await new GranolaMcpClient(connection.id, () => granolaOAuthAdapter.getValidAccessToken(connection.id, c.organizationId, c.userId)).accountInfo();
    res.json({ success: true, account });
}));

router.patch('/connections/granola', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await caller(req);
    const connection = await findGranolaConnection(c.organizationId, c.userId);
    if (!connection) throw new BadRequestError('Granola is not connected.');
    const enabled = req.body?.sync?.enabled === true;
    const includeTranscripts = req.body?.sync?.includeTranscripts === true;
    const lookbackDays = Math.min(3650, Math.max(1, Number(req.body?.sync?.lookbackDays) || 90));
    const project = enabled && (req.query.projectId || req.query.projectKey)
        ? await resolveProjectScope(req)
        : null;
    if (enabled && !project) throw new BadRequestError('Choose a project before enabling Granola knowledge sync.');
    const updated = await updateGranolaSync(connection.id, { enabled, includeTranscripts, lookbackDays, projectId: project?.id ?? null });
    res.json({ connection: publicConnection(updated) });
}));

router.post('/connections/granola/sync', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await caller(req);
    const connection = await findGranolaConnection(c.organizationId, c.userId);
    if (!connection) throw new BadRequestError('Granola is not connected.');
    res.json(await syncGranolaConnection(connection));
}));

/**
 * The caller's own Granola matches, for the private card a room search posts.
 * Reads only the caller's account, so another person opening that card sees
 * their own meetings, never the asker's; the card shows the list only to its owner.
 */
router.get('/connections/granola/meetings', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await caller(req);
    const { client } = await getGranolaForContext(c);
    const q = (name: string) => (typeof req.query[name] === 'string' ? String(req.query[name]) : undefined);
    const query = q('query');
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    const list: Record<string, unknown> = {};
    for (const key of ['start_date', 'end_date'] as const) { const v = q(key); if (v && datePattern.test(v)) list[key] = v; }
    const folder = q('folder_id'); if (folder) list.folder_id = folder.slice(0, 500);
    const limit = Number(q('limit')); if (Number.isInteger(limit) && limit >= 1 && limit <= 100) list.limit = limit;
    const data = query ? await client.searchMeetings(query.slice(0, 2000)) : await client.listMeetings(list);
    const payload = workspaceResultPayload(query ? 'granola_search_meetings' : 'granola_list_meetings', data, {});
    res.json({ meetings: (payload?.items ?? []).map(({ body: _body, ...item }) => item) });
}));

/**
 * Share one of the caller's meetings into a room they can open: its notes are
 * posted as a turn from them, and become what the room's agents read.
 */
router.post('/connections/granola/share', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await caller(req);
    const context = await getUserOrgContext(req);
    const sessionKey = typeof req.body?.sessionKey === 'string' ? req.body.sessionKey : '';
    const meetingId = typeof req.body?.meetingId === 'string' ? req.body.meetingId.trim().slice(0, 500) : '';
    if (!sessionKey || !meetingId) throw new BadRequestError('A room and a meeting are required.');
    res.json(await shareMeetingIntoRoom({ ...c, isSuperAdmin: context.isSuperAdmin, isOrgAdmin: context.isOrgAdmin }, sessionKey, meetingId));
}));

router.post('/connections/granola/disconnect', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const c = await caller(req);
    const connection = await findGranolaConnection(c.organizationId, c.userId);
    if (connection) await granolaOAuthAdapter.disconnect(connection.id, c.organizationId, c.userId);
    res.json({ success: true });
}));

export default router;
