/**
 * Gmail OAuth Routes
 * 
 * Handles OAuth2 flow for Gmail integration.
 */

import { Router, Request, Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "../utils/auth-context.js";
import { gmailService } from "../domain/integrations/gmail-service.js";
import { createLogger } from "@server/utils/logger.js";
import { BadRequestError, UnauthorizedError } from "@server/utils/errors.js";

const router = Router();
const logger = createLogger('GmailRoutes');

// GET /api/gmail/status - Check Gmail configuration status
router.get("/status", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);

    const isConfigured = gmailService.isConfigured();
    const hasCredentials = await gmailService.loadCredentials(organizationId);

    res.json({
        configured: isConfigured,
        authenticated: hasCredentials,
        message: !isConfigured
            ? 'Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET environment variables'
            : !hasCredentials
                ? 'Gmail OAuth not connected. Click "Connect Gmail" to authenticate.'
                : 'Gmail is connected and ready to send emails.'
    });
}));

// GET /api/gmail/oauth/url - Get OAuth authorization URL
router.get("/oauth/url", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    if (!gmailService.isConfigured()) {
        throw new BadRequestError('Gmail OAuth not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.');
    }

    const authUrl = gmailService.getAuthUrl();
    res.json({ url: authUrl });
}));

// GET /api/gmail/oauth/callback - Handle OAuth callback
router.get("/oauth/callback", asyncHandler(async (req: Request, res: Response) => {
    const { code, error } = req.query;

    if (error) {
        logger.warn('Gmail OAuth denied', { error });
        return res.redirect('/settings?gmail=error&message=' + encodeURIComponent(String(error)));
    }

    if (!code || typeof code !== 'string') {
        throw new BadRequestError('Authorization code required');
    }

    // Get user context from session
    const userId = (req.session as any)?.userId;
    if (!userId) {
        throw new UnauthorizedError('Please log in before connecting Gmail');
    }

    const { organizationId } = await getUserOrgContext(req);

    try {
        await gmailService.handleOAuthCallback(code, organizationId, userId);
        logger.info('Gmail OAuth connected', { userId, organizationId });
        res.redirect('/settings?gmail=success');
    } catch (err: any) {
        logger.error('Gmail OAuth callback failed', { error: err.message });
        res.redirect('/settings?gmail=error&message=' + encodeURIComponent(err.message));
    }
}));

// POST /api/gmail/test - Send a test email
router.post("/test", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);
    const { to } = req.body;

    if (!to) {
        throw new BadRequestError('Recipient email required');
    }

    const loaded = await gmailService.loadCredentials(organizationId);
    if (!loaded) {
        throw new BadRequestError('Gmail not connected. Please connect Gmail first.');
    }

    const result = await gmailService.sendHilNotification(
        organizationId,
        to,
        'https://example.com/test-link',
        {
            pipelineName: 'Test Pipeline',
            stepName: 'Test HIL Step',
        },
        'Test Email from Oddjob'
    );

    if (result.success) {
        res.json({ success: true, messageId: result.messageId });
    } else {
        res.status(500).json({ success: false, error: result.error });
    }
}));

// DELETE /api/gmail/disconnect - Remove Gmail connection
router.delete("/disconnect", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { organizationId } = await getUserOrgContext(req);

    // We could implement deletion of the credential here
    // For now, just log and inform
    logger.info('Gmail disconnect requested', { organizationId });

    res.json({ success: true, message: 'To fully disconnect, delete the Gmail credential from Settings > Credentials' });
}));

export function registerGmailRoutes(app: any) {
    app.use("/api/gmail", router);
}

