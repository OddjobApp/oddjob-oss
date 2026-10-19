import { Router } from 'express';
import type { Request, Response } from 'express';
import { requireAuth } from '@domain/core/auth/security.service.js';
import { asyncHandler } from '@server/middleware/error-handler.js';
import { getUserOrgContext, requireOrgId } from '@server/utils/auth-context.js';
import { resolveProjectScope } from '@server/middleware/project-scope.js';
import { quickBooksEnvironment, quickBooksOAuthAdapter } from '@domain/integrations/core/oauth/quickbooks-oauth.adapter.js';
import { disconnectQuickBooks, findQuickBooksConnection, getQuickBooksClient } from '@domain/integrations/quickbooks/service.js';
import { BadRequestError, ForbiddenError } from '@server/utils/errors.js';
import { financeRolesService } from '@domain/projects/core/finance-roles.service.js';
const router = Router();
async function scope(req: Request) {
    const caller = await getUserOrgContext(req);
    const project = req.query.projectId || req.query.projectKey ? await resolveProjectScope(req) : null;
    return { ...caller, organizationId: requireOrgId(caller), projectId: project?.id ?? null };
}
// Connecting, reconnecting and disconnecting choose which company's books the
// organization's agents read and write. The callback upserts the connection,
// so a reconnect replaces the company as surely as a disconnect removes it:
// all three are an org admin's decision, not any member's.
const canManage = (s: { isOrgAdmin?: boolean; isSuperAdmin?: boolean }) => Boolean(s.isOrgAdmin || s.isSuperAdmin);
router.get('/connectors/quickbooks/oauth/status', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const s = await scope(req);
    const connector = await findQuickBooksConnection(s.organizationId, s.projectId);
    const config = connector?.config as Record<string, unknown> | undefined;
    res.json({ configured: quickBooksOAuthAdapter.isConfigured(), environment: quickBooksEnvironment(), canManage: canManage(s),
        callbackUri: quickBooksOAuthAdapter.resolveRedirectUri(req),
        connection: connector ? { id: connector.id, status: connector.status, realmId: config?.realmId, environment: config?.environment,
            inherited: s.projectId != null && connector.projectId == null } : null });
}));
router.get('/connectors/quickbooks/oauth/initiate', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const s = await scope(req);
    if (!canManage(s)) throw new ForbiddenError('Only an organization admin can connect QuickBooks.');
    const { url } = await quickBooksOAuthAdapter.getAuthorizationUrl({ organizationId: s.organizationId, projectId: s.projectId,
        req, returnTo: typeof req.query.returnTo === 'string' ? req.query.returnTo : '/admin/integrations', extraState: { userId: s.userId } });
    res.redirect(url);
}));
router.get('/connectors/quickbooks/oauth/callback', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (req.query.error) throw new BadRequestError('QuickBooks authorization was declined. You can try connecting again.');
    if (typeof req.query.code !== 'string' || typeof req.query.state !== 'string') throw new BadRequestError('Missing QuickBooks authorization code or state.');
    const result = await quickBooksOAuthAdapter.handleCallback({ code: req.query.code, stateId: req.query.state, req });
    res.redirect(result.returnTo ?? '/admin/integrations');
}));
router.post('/connectors/quickbooks/test', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const s = await scope(req);
    // Reads the company record: an admin checking the connection, or a finance role.
    if (!canManage(s)) await financeRolesService.assertAnyRole({ organizationId: s.organizationId, projectId: s.projectId, userId: s.userId });
    const { client } = await getQuickBooksClient(s.organizationId, s.projectId);
    const company = await client.company();
    res.json({ success: true, companyName: company?.CompanyName, realmId: client.realmId });
}));
router.post('/connectors/quickbooks/disconnect', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const s = await scope(req);
    // Disconnecting can also revoke the company's grant at Intuit.
    if (!canManage(s)) throw new ForbiddenError('Only an organization admin can disconnect QuickBooks.');
    await disconnectQuickBooks(s.organizationId, s.projectId);
    res.json({ success: true });
}));
export default router;
