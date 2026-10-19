import { Router, Request, Response } from "express";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { generalGateway } from "@server/integrations/general-gateway.js";
import { pythonGateway } from "@server/integrations/python-gateway.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { saasConnectorConfigService } from "@domain/integrations/saas-connector-config.service.js";
import { resolveProjectScope } from "@server/middleware/project-scope.js";

const router = Router();
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || "http://127.0.0.1:8002";

/** Optional project scope (?projectId / ?projectKey) — undefined when absent. */
async function scopedProjectId(req: Request): Promise<number | undefined> {
    if (!req.query.projectId && !req.query.projectKey) return undefined;
    return (await resolveProjectScope(req))?.id;
}

// POST /api/saas/connectors/:platform/reconnect - Re-verify stored credentials
router.post("/connectors/:platform/reconnect", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const connector = await saasConnectorConfigService.findConnector(organizationId, platform);
    if (!connector) {
        throw new NotFoundError("Connector not found");
    }

    try {
        if (platform === 'confluence') {
            const { ConfluenceClient } = await import("@domain/integrations/confluence-service.js");
            const creds = connector.credentials as any;
            const client = new ConfluenceClient(creds.base_url, creds.username, creds.api_token || creds.api_key);
            await client.getSpaces(1);

            await saasConnectorConfigService.recordReconnect(organizationId, connector, null);
            return res.json({ success: true, message: "Reconnected successfully" });
        } else if (platform === 'jira') {
            const creds = connector.credentials as any;
            const token = creds?.api_token || creds?.api_key;
            const auth = Buffer.from(`${creds.username}:${token}`).toString('base64');
            const verifyUrl = `${creds.base_url}/rest/api/3/myself`;

            const response = await generalGateway.execute({
                action: 'reconnect',
                method: 'GET',
                url: verifyUrl,
                headers: { 'Authorization': `Basic ${auth}` },
                organizationId
            });

            if (response.status < 200 || response.status >= 300) throw new Error(`Jira API returned ${response.status}`);

            await saasConnectorConfigService.recordReconnect(organizationId, connector, null);
            return res.json({ success: true, message: "Reconnected successfully" });

        } else if (platform === 'resend') {
            const creds = connector.credentials as any;
            const token = creds?.api_token || creds?.api_key;
            if (!token) throw new Error("Missing Resend api_token in stored credentials");

            const response = await generalGateway.execute({
                action: 'reconnect',
                method: 'GET',
                url: 'https://api.resend.com/domains',
                headers: { 'Authorization': `Bearer ${token}` },
                organizationId
            });

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Resend API returned ${response.status}`);
            }

            await saasConnectorConfigService.recordReconnect(organizationId, connector, null);
            return res.json({ success: true, message: "Reconnected to Resend successfully" });

        } else if (platform === 'slack') {
            const creds = connector.credentials as any;
            const token = creds?.bot_token || creds?.api_token;
            if (!token) throw new Error("Missing Slack bot_token in stored credentials");

            const { getSlackClient } = await import("@domain/integrations/slack-service.js");
            const client = await getSlackClient(token);
            const channels = await client.getChannels(1);

            await saasConnectorConfigService.recordReconnect(organizationId, connector, null);
            return res.json({ success: true, message: `Reconnected to Slack successfully. ${channels.length} channel(s) accessible.` });
        } else if (platform === 'quickbooks') {
            const { clientForConnector } = await import("@domain/integrations/quickbooks/service.js");
            const company = await clientForConnector(connector).company();

            await saasConnectorConfigService.recordReconnect(organizationId, connector, null);
            return res.json({ success: true, message: `Reconnected to QuickBooks company ${company?.CompanyName ?? ''}`.trim() });
        }

        return res.status(501).json({ error: `Reconnect not implemented for ${platform} yet.` });

    } catch (error: any) {
        await saasConnectorConfigService.recordReconnect(organizationId, connector, error.message);
        return res.status(400).json({ error: "Reconnection failed", details: error.message });
    }
}));

// POST /api/saas/connectors/:platform/discover/:resource - Discover resources (spaces, projects, etc)
router.post("/connectors/:platform/discover/:resource", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform, resource } = req.params;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    if (platform === 'confluence' && resource === 'spaces') {
        const { credentials } = req.body;
        const { base_url, username, api_token, api_key } = credentials || {};
        const { ConfluenceClient } = await import("@domain/integrations/confluence-service.js");

        let cleanUrl = base_url.trim();
        if (!cleanUrl.startsWith('http')) cleanUrl = 'https://' + cleanUrl;

        const client = new ConfluenceClient(cleanUrl, username, api_token || api_key);
        const spaces = await client.getSpaces(50);
        return res.json({ results: spaces });
    }

    const url = `${PYTHON_SERVICE_URL}/api/saas/connectors/${platform}/discover/${resource}?organization_id=${organizationId}`;
    const response = await pythonGateway.execute(
        'discover_resource',
        url,
        'POST',
        req.body,
        organizationId
    );
    res.status(response.status).json(response.body);
}));

// GET /api/saas/connectors/:platform/bidirectional-sync
router.get("/connectors/:platform/bidirectional-sync", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const { connector, syncConfig } = await saasConnectorConfigService.getSyncConfig(organizationId, platform.toLowerCase(), await scopedProjectId(req));
    if (!connector || !syncConfig) {
        return res.json({ platform, enabled: false, status: "Not Configured" });
    }

    // Return in the format expected by the frontend
    res.json({
        id: syncConfig.id,
        platform: platform.toLowerCase(),
        enabled: syncConfig.enabled,
        sync_interval: syncConfig.syncInterval,
        conflict_resolution: syncConfig.conflictResolution,
        field_mappings: syncConfig.mappings,
        filters: syncConfig.filters,
        last_sync: connector.lastSync,
        status: connector.status
    });
}));

// POST /api/saas/connectors/:platform/bidirectional-sync
router.post("/connectors/:platform/bidirectional-sync", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const { enabled, sync_interval, conflict_resolution, field_mappings, filters } = req.body;

    const result = await saasConnectorConfigService.upsertSyncConfig(organizationId, platform.toLowerCase(), {
        enabled,
        syncInterval: sync_interval,
        conflictResolution: conflict_resolution,
        mappings: field_mappings,
        filters,
    }, await scopedProjectId(req));
    if (!result) {
        throw new BadRequestError(`Connector for ${platform} not found. Please connect the platform first.`);
    }

    res.json({
        ...result,
        platform: platform.toLowerCase(),
        sync_interval: result.syncInterval,
        conflict_resolution: result.conflictResolution,
        field_mappings: result.mappings
    });
}));

// DELETE /api/saas/connectors/:platform/bidirectional-sync
router.delete("/connectors/:platform/bidirectional-sync", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const deleted = await saasConnectorConfigService.deleteSyncConfig(organizationId, platform.toLowerCase(), await scopedProjectId(req));
    if (!deleted) {
        throw new BadRequestError(`Connector for ${platform} not found.`);
    }

    res.json({ success: true, message: "Sync configuration deleted." });
}));


// GET /api/saas/connectors/:platform/event-workflows
router.get("/connectors/:platform/event-workflows", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const workflows = await saasConnectorConfigService.listEventWorkflows(organizationId, platform.toLowerCase());
    res.json({ workflows });
}));

// POST /api/saas/connectors/:platform/event-workflows
router.post("/connectors/:platform/event-workflows", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const { trigger_event, workflow_id, conditions, transformation, enabled } = req.body;

    if (typeof workflow_id !== "string" && typeof workflow_id !== "number") {
        throw new BadRequestError("workflow_id is required");
    }

    const result = await saasConnectorConfigService.upsertEventWorkflow(organizationId, platform.toLowerCase(), {
        triggerEvent: trigger_event,
        workflowId: String(workflow_id),
        conditions,
        transformation,
        enabled,
    });
    if (!result.ok) {
        throw new NotFoundError(`Mission ${workflow_id} not found in this organization`);
    }
    res.json(result.workflow);
}));

// POST /api/saas/connectors/:platform/test-event-workflow
router.post("/connectors/:platform/test-event-workflow", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const { event_type } = req.query;
    const eventData = req.body;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const { saasEventOrchestrator } = await import("@domain/integrations/saas-event-orchestrator.service.js");

    // Determine platform and trigger event from event_type (e.g. "jira:issue_created")
    const typeStr = String(event_type || "");
    const [platformName, triggerEvent] = typeStr.includes(':') ? typeStr.split(':') : [platform.toLowerCase(), typeStr];

    const results = await saasEventOrchestrator.processEvent(
        platformName || platform.toLowerCase(),
        triggerEvent,
        eventData,
        organizationId
    );

    if (results.length === 0) {
        return res.json([{
            pathway: "none",
            status: "skipped",
            message: "No matching enabled workflows found for this event."
        }]);
    }

    res.json(results);
}));

export default router;
