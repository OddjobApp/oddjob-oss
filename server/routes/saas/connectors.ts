import { Router, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { db } from "@server/database_service.js";
import { saasConnectors, encryptedCredentials } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { BadRequestError } from "@server/utils/errors.js";
import { generalGateway } from "@server/integrations/general-gateway.js";
import { encryptedCredentialsService } from '@domain/auth/core/encrypted-credentials.service.js';
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";
import { resolveProjectScope } from "@server/middleware/project-scope.js";
import { GOOGLE_CONNECTION_PROFILES, type GoogleConnectionProfile } from "@shared/google-connection.js";

/**
 * The project space a connection is being bound to, or null for org-wide.
 *
 * Only an explicit ?projectId counts -- resolveProjectScope would otherwise fall
 * back to the session's project and silently scope an org-wide connection. It
 * throws for a project outside the org or one the caller cannot read, so a
 * member can never bind a connector to a private project they cannot see.
 */
async function requestedProjectId(req: Request): Promise<number | null> {
    if (!req.query.projectId && !req.query.projectKey) return null;
    const scope = await resolveProjectScope(req);
    return scope?.id ?? null;
}

const logger = createLogger("SaasConnectors");

const router = Router();

// GET /api/saas/connectors - List all connectors for an organization
router.get("/connectors", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const connectors = await db
        .select()
        .from(saasConnectors)
        .where(eq(saasConnectors.orgId, organizationId));

    const mappedConnectors = connectors.map((c: any) => ({
        platform: c.platform,
        status: c.status,
        last_sync: c.lastSync,
        config_name: c.config?.name || "",
        is_enabled: c.config?.enabled ?? false,
        base_url: c.credentials?.base_url || c.baseUrl,
        username: c.credentials?.username,
        allowed_projects: c.config?.allowed_projects || [],
        error_message: c.config?.error_message
    }));

    res.json(mappedConnectors);
}));

// POST /api/saas/create-connector - Create or Update a connector
router.post("/create-connector", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform, organization_id, config, credentials } = req.body;
    const orgId = organization_id ? parseInt(organization_id) : 1;

    if (!platform) {
        throw new BadRequestError("Platform is required");
    }

    const [existing] = await db
        .select()
        .from(saasConnectors)
        .where(
            and(
                eq(saasConnectors.orgId, orgId),
                eq(saasConnectors.platform, platform)
            )
        )
        .limit(1);

    let result;
    if (existing) {
        const [updated] = await db
            .update(saasConnectors)
            .set({
                config: { ...existing.config, ...config },
                credentials: { ...existing.credentials, ...credentials },
                status: 'connected',
                updatedAt: new Date(),
            })
            .where(eq(saasConnectors.id, existing.id))
            .returning();
        result = updated;
    } else {
        const [inserted] = await db
            .insert(saasConnectors)
            .values({
                orgId,
                platform,
                config: config || {},
                credentials: credentials || {},
                status: 'connected',
            })
            .returning();
        result = inserted;
    }

    res.json({ success: true });
}));

// --- JIRA OAUTH 2.0 FLOW ---
import { jiraOAuthAdapter } from "@domain/integrations/core/oauth/jira-oauth.adapter.js";
import { googleOAuthAdapter } from "@domain/integrations/core/oauth/google-oauth.adapter.js";
import { microsoftOAuthAdapter } from "@domain/integrations/core/oauth/microsoft-oauth.adapter.js";

/**
 * GET /api/saas/connectors/jira/oauth/initiate
 * Kicks off the Jira OAuth 2.0 flow using JiraOAuthAdapter with dynamic tunnel/redirect support.
 */
router.get("/connectors/jira/oauth/initiate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const projectId = await requestedProjectId(req);
    const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/admin/integrations?status=jira_connected";

    const { url } = await jiraOAuthAdapter.getAuthorizationUrl({
        organizationId,
        projectId,
        req,
        returnTo,
    });

    res.redirect(url);
}));

/**
 * GET /api/saas/connectors/jira/oauth/callback
 * Handles the callback from Jira after user authorization.
 */
router.get("/connectors/jira/oauth/callback", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { code, state } = req.query;

    if (!state || typeof state !== "string") throw new BadRequestError("Missing OAuth state parameter");
    if (!code || typeof code !== "string") throw new BadRequestError("Authorization code not present in callback");

    const result = await jiraOAuthAdapter.handleCallback({
        code,
        stateId: state,
        req,
    });

    const redirectTarget = result.returnTo || "/admin/integrations?status=jira_connected";
    res.redirect(redirectTarget);
}));


// --- GOOGLE OAUTH 2.0 FLOW (Drive / Docs connectors) ---
// The google adapter's default callbackPath is the Gmail route, which stores
// tokens under gmailService rather than a saas_connector row — so this flow
// passes its own callback path explicitly, with Gmail/Drive/combined profiles.
const GOOGLE_OAUTH_CALLBACK = "/api/saas/connectors/google/oauth/callback";

// Mirrors BaseOAuthAdapter.resolveRedirectUri: tunnels and hosted domains are
// https even when req.protocol reports http.
function connectorCallbackUri(req: Request, path: string): string {
    const host = req.get("x-forwarded-host") || req.get("host") || "localhost:5000";
    let proto = req.get("x-forwarded-proto") || req.protocol || "http";
    if (host.includes("trycloudflare.com") || host.includes(".app") || host.includes(".dev")) {
        proto = "https";
    }
    return `${proto}://${host}${path}`;
}
router.get("/connectors/google/oauth/status", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    requireOrgId(await getUserOrgContext(req));
    res.json({ configured: googleOAuthAdapter.isConfigured(), callbackUri: connectorCallbackUri(req, GOOGLE_OAUTH_CALLBACK) });
}));

router.get("/connectors/google/oauth/initiate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const projectId = await requestedProjectId(req);
    if (!googleOAuthAdapter.isConfigured()) throw new BadRequestError("Google sign-in has not been configured by your administrator.");
    const profile = req.query.for ?? "gmail";
    if (typeof profile !== "string" || !Object.hasOwn(GOOGLE_CONNECTION_PROFILES, profile)) throw new BadRequestError("Choose Gmail, Drive, Calendar, Workspace, or YouTube.");
    const scopeProfile = [...GOOGLE_CONNECTION_PROFILES[profile as GoogleConnectionProfile].scopes];
    const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/admin/integrations?status=google_connected";

    const { url } = await googleOAuthAdapter.getAuthorizationUrl({
        organizationId,
        projectId,
        req,
        scopes: scopeProfile,
        returnTo,
        customRedirectUri: connectorCallbackUri(req, GOOGLE_OAUTH_CALLBACK),
    });

    res.redirect(url);
}));

// This router is mounted under /api/saas; use a relative route here.
router.get("/connectors/google/oauth/callback", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { code, state } = req.query;

    if (!state || typeof state !== "string") throw new BadRequestError("Missing OAuth state parameter");
    if (!code || typeof code !== "string") throw new BadRequestError("Authorization code not present in callback");

    const result = await googleOAuthAdapter.handleCallback({
        code,
        stateId: state,
        req,
    });

    res.redirect(result.returnTo || "/admin/integrations?status=google_connected");
}));


// --- MICROSOFT 365 OAUTH 2.0 FLOW (OneDrive / SharePoint / Office) ---
const MICROSOFT_OAUTH_CALLBACK = "/api/saas/connectors/microsoft/oauth/callback";

router.get("/connectors/microsoft/oauth/initiate", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);
    const projectId = await requestedProjectId(req);
    const returnTo = typeof req.query.returnTo === "string" ? req.query.returnTo : "/admin/integrations?status=microsoft_connected";

    const { url } = await microsoftOAuthAdapter.getAuthorizationUrl({
        organizationId,
        projectId,
        req,
        returnTo,
        customRedirectUri: connectorCallbackUri(req, MICROSOFT_OAUTH_CALLBACK),
    });

    res.redirect(url);
}));

router.get('/connectors/microsoft/oauth/callback', requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { code, state } = req.query;

    if (!state || typeof state !== "string") throw new BadRequestError("Missing OAuth state parameter");
    if (!code || typeof code !== "string") throw new BadRequestError("Authorization code not present in callback");

    const result = await microsoftOAuthAdapter.handleCallback({
        code,
        stateId: state,
        req,
    });

    res.redirect(result.returnTo || "/admin/integrations?status=microsoft_connected");
}));


// POST /api/saas/connectors/:platform/test - Test connection
router.post("/connectors/:platform/test", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const credentials = req.body;

    if (!credentials) {
        throw new BadRequestError("Credentials are required");
    }

    try {
        if (platform === 'jira') {
            // Support new fields (endpoint/account/api_key) and legacy (base_url/username/api_token)
            const { endpoint, account, api_key, base_url, username, api_token } = credentials;
            const resolvedEndpoint = endpoint || base_url;
            const resolvedAccount = account || username;
            const resolvedKey = api_key || api_token;

            if (!resolvedEndpoint || !resolvedAccount || !resolvedKey) {
                throw new BadRequestError("Missing required Jira credentials (endpoint, account, api_key)");
            }

            const auth = Buffer.from(`${resolvedAccount}:${resolvedKey}`).toString('base64');
            const verifyUrl = `${resolvedEndpoint}/rest/api/3/myself`;

            const response = await generalGateway.execute({
                action: 'test_connection',
                method: 'GET',
                url: verifyUrl,
                headers: {
                    'Authorization': `Basic ${auth}`
                }
            });

            if (response.status < 200 || response.status >= 300) {
                throw new Error(`Jira API returned ${response.status}: ${JSON.stringify(response.body)}`);
            }

            return res.json({ success: true, message: `Connected as ${response.body.displayName}` });

        } else if (platform === 'confluence') {
            // Support new fields (endpoint/account/api_key) and legacy (base_url/username/api_token)
            const { endpoint, account, api_key, base_url, username, api_token } = credentials;
            const resolvedEndpoint = endpoint || base_url;
            const resolvedAccount = account || username;
            const resolvedKey = api_key || api_token;

            if (!resolvedEndpoint || !resolvedAccount || !resolvedKey) {
                throw new BadRequestError("Missing required Confluence credentials (endpoint, account, api_key)");
            }

            const { ConfluenceClient } = await import("@domain/integrations/confluence-service.js");

            let cleanUrl = resolvedEndpoint.trim();
            if (!cleanUrl.startsWith('http')) {
                cleanUrl = 'https://' + cleanUrl;
            }

            const client = new ConfluenceClient(cleanUrl, resolvedAccount, resolvedKey);

            try {
                const spaces = await client.getSpaces(1);
                return res.json({ success: true, message: `Connected successfully. Found ${spaces.length || 0} spaces.` });
            } catch (err: any) {
                const msg = err.message || '';
                if (msg.includes('401')) {
                    throw new Error("Authentication failed. Check your API Key and Account Email.");
                }
                if (msg.includes('404')) {
                    if (cleanUrl.includes('atlassian.net') && !cleanUrl.endsWith('/wiki')) {
                        throw new Error("Connection failed (404). For Confluence Cloud, ensure your Endpoint ends with '/wiki' (e.g. https://your-domain.atlassian.net/wiki).");
                    }
                }
                throw err;
            }

        } else if (platform === 'resend') {
            const { api_token, api_key } = credentials;
            const token = api_token || api_key;

            if (!token) {
                throw new BadRequestError("Missing required Resend credentials (api_token)");
            }

            const response = await generalGateway.execute({
                action: 'test_connection',
                method: 'GET',
                url: 'https://api.resend.com/domains',
                headers: {
                    'Authorization': `Bearer ${token}`,
                }
            });

            if (response.status < 200 || response.status >= 300) {
                throw new BadRequestError(`Resend API returned ${response.status}: ${JSON.stringify(response.body)}`);
            }

            return res.json({ success: true, message: "Connected to Resend successfully" });
        } else if (platform === 'servicenow') {
            // Accept endpoint/username/password (dashboard) or instance/api_token (legacy)
            const { endpoint, instance, base_url, username, account, password, api_token, api_key } = credentials;
            const resolvedInstance = endpoint || instance || base_url;
            const resolvedUser = username || account;
            const resolvedSecret = password || api_token || api_key;

            if (!resolvedInstance || !resolvedUser || !resolvedSecret) {
                throw new BadRequestError("Missing required ServiceNow credentials (endpoint, username, password)");
            }

            const { servicenowConnector } = await import("@server/integrations/servicenow-connector.js");
            servicenowConnector.configure({
                instanceUrl: resolvedInstance,
                username: resolvedUser,
                password: resolvedSecret,
            });

            try {
                const { name } = await servicenowConnector.testConnection();
                return res.json({ success: true, message: `Connected to ServiceNow as ${name}` });
            } catch (err: any) {
                const msg = err.message || '';
                if (msg.includes('401')) {
                    throw new Error("Authentication failed. Check the username and password, and that the user has the 'rest_service' role.");
                }
                if (msg.includes('404')) {
                    throw new Error("Instance not found (404). Use your instance URL, e.g. https://acme.service-now.com.");
                }
                throw err;
            }
        } else if (platform === 'slack') {
            const { bot_token, api_token } = credentials;
            const token = bot_token || api_token;

            if (!token) {
                throw new BadRequestError("Missing required Slack bot_token");
            }

            const { getSlackClient } = await import("@domain/integrations/slack-service.js");
            const client = await getSlackClient(token);
            
            try {
                const channels = await client.getChannels(1);
                return res.json({ success: true, message: `Connected to Slack successfully. Access to ${channels.length || 0} channels verified.` });
            } catch (err: any) {
                throw new Error(`Slack API error: ${err.message}`);
            }
        } else if (platform === 'jira') {
            const { base_url, endpoint, url, username, account, api_token, api_key, password } = credentials;
            const resolvedUrl = base_url || endpoint || url;
            const resolvedUser = username || account;
            const resolvedSecret = api_token || api_key || password;

            if (!resolvedUrl || !resolvedUser || !resolvedSecret) {
                throw new BadRequestError("Missing required Jira credentials (base_url, username, api_token)");
            }

            const { JiraClient } = await import("@domain/integrations/jira-service.js");
            const client = new JiraClient(resolvedUrl, resolvedUser, resolvedSecret);
            try {
                const projects = await client.getProjects(1, 0);
                return res.json({
                    success: true,
                    message: `Connected to Jira successfully at ${resolvedUrl}. Verified access (${projects.length} project(s) visible).`
                });
            } catch (err: any) {
                throw new Error(`Jira API connection error: ${err.message}`);
            }
        } else if (platform === 'github') {
            const { api_token, api_key, token, access_token, personal_access_token } = credentials;
            const resolvedToken = api_token || api_key || token || access_token || personal_access_token;
            if (!resolvedToken) {
                throw new BadRequestError("Missing required GitHub access token");
            }

            const response = await fetch("https://api.github.com/user", {
                headers: {
                    Authorization: `Bearer ${resolvedToken}`,
                    Accept: "application/vnd.github+json",
                    "User-Agent": "Oddjob-Connector-Test",
                },
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`GitHub API error ${response.status}: ${text}`);
            }

            const data = await response.json() as { login?: string };
            return res.json({
                success: true,
                message: `Connected to GitHub successfully as ${data.login || 'authenticated user'}.`
            });
        }

        throw new BadRequestError(`Testing not implemented for platform: ${platform}`);
    } catch (error: any) {
        throw new BadRequestError(error.message || "Connection test failed", { details: error.toString() });
    }
}));

// GET /api/saas/connectors/jira/fields - Get available Jira fields
router.get("/connectors/jira/fields", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    // Find the Jira connector for this org
    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(
            and(
                eq(saasConnectors.orgId, organizationId),
                eq(saasConnectors.platform, "jira")
            )
        )
        .limit(1);

    if (!connector) {
        throw new BadRequestError("Jira connector not found for this organization");
    }

    const { getJiraClient, JiraClient } = await import("@domain/integrations/jira-service.js");
    let client;

    const credentialId = connector.config?.credentialId || (connector.credentials as any)?.credentialId;
    if (credentialId) {
        client = await getJiraClient(credentialId, organizationId);
    } else {
        const creds = connector.credentials as any;
        const token = creds?.api_token || creds?.api_key || creds?.password;
        if (!creds?.base_url || !creds?.username || !token) {
            throw new BadRequestError("Incomplete Jira credentials in connector configuration");
        }
        client = new JiraClient(creds.base_url, creds.username, token, organizationId);
    }

    const fields = await client.getFields();

    res.json(fields);
}));

// GET /api/saas/connectors/:platform/schema - Get schema for a platform (used by SyncConfigDialog)
router.get("/connectors/:platform/schema", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const { platform } = req.params;
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    if (platform === 'jira') {
        const [connector] = await db
            .select()
            .from(saasConnectors)
            .where(
                and(
                    eq(saasConnectors.orgId, organizationId),
                    eq(saasConnectors.platform, "jira")
                )
            )
            .limit(1);

        if (!connector) {
            throw new BadRequestError("Jira connector not found for this organization");
        }

        const { getJiraClient, JiraClient } = await import("@domain/integrations/jira-service.js");
        let client;

        const credentialId = connector.config?.credentialId || (connector.credentials as any)?.credentialId;
        if (credentialId) {
            client = await getJiraClient(credentialId, organizationId);
        } else {
            const creds = connector.credentials as any;
            const token = creds?.api_token || creds?.api_key || creds?.password;
            if (!creds?.base_url || !creds?.username || !token) {
                throw new BadRequestError("Incomplete Jira credentials in connector configuration");
            }
            client = new JiraClient(creds.base_url, creds.username, token, organizationId);
        }

        const fields = await client.getFields();

        // Return fields wrapped in { fields: [...] } as expected by SyncConfigDialog.tsx
        return res.json({
            platform: 'jira',
            fields: fields.map((f: any) => ({
                key: f.id,
                name: f.name,
                type: f.schema?.type || 'string'
            }))
        });
    }

    if (platform === 'confluence') {
        // Confluence pages have a fixed well-known schema
        return res.json({
            platform: 'confluence',
            fields: [
                { key: 'id',          name: 'Page ID',        type: 'string' },
                { key: 'title',       name: 'Title',          type: 'string' },
                { key: 'space',       name: 'Space Name',     type: 'string' },
                { key: 'url',         name: 'Page URL',       type: 'string' },
                { key: 'content',     name: 'Body (HTML)',    type: 'string' },
                { key: 'markdown',    name: 'Body (Markdown)',type: 'string' },
                { key: 'lastUpdated', name: 'Last Updated',   type: 'string' },
                { key: 'source',      name: 'Source',         type: 'string' },
            ]
        });
    }

    if (platform === 'slack') {
        // Slack messages have a fixed schema from conversations.history
        return res.json({
            platform: 'slack',
            fields: [
                { key: 'id',          name: 'Timestamp (ID)',  type: 'string' },
                { key: 'channel',     name: 'Channel Name',    type: 'string' },
                { key: 'channelId',   name: 'Channel ID',      type: 'string' },
                { key: 'user',        name: 'User ID',         type: 'string' },
                { key: 'text',        name: 'Message Text',    type: 'string' },
                { key: 'ts',          name: 'Timestamp',       type: 'string' },
                { key: 'thread_ts',   name: 'Thread Timestamp',type: 'string' },
                { key: 'reply_count', name: 'Reply Count',     type: 'number' },
                { key: 'lastUpdated', name: 'Last Updated',    type: 'string' },
                { key: 'source',      name: 'Source',          type: 'string' },
            ]
        });
    }

    if (platform === 'servicenow') {
        // Incident is the default sync table; these are the stock Table API columns.
        return res.json({
            platform: 'servicenow',
            fields: [
                { key: 'sys_id',            name: 'Sys ID',            type: 'string' },
                { key: 'number',            name: 'Number',            type: 'string' },
                { key: 'short_description', name: 'Short Description', type: 'string' },
                { key: 'description',       name: 'Description',       type: 'string' },
                { key: 'state',             name: 'State',             type: 'string' },
                { key: 'priority',          name: 'Priority',          type: 'string' },
                { key: 'urgency',           name: 'Urgency',           type: 'string' },
                { key: 'impact',            name: 'Impact',            type: 'string' },
                { key: 'category',          name: 'Category',          type: 'string' },
                { key: 'assigned_to',       name: 'Assigned To',       type: 'string' },
                { key: 'assignment_group',  name: 'Assignment Group',  type: 'string' },
                { key: 'caller_id',         name: 'Caller',            type: 'string' },
                { key: 'opened_at',         name: 'Opened At',         type: 'string' },
                { key: 'sys_updated_on',    name: 'Last Updated',      type: 'string' },
            ]
        });
    }

    if (platform === 'resend') {
        return res.json({
            platform: 'resend',
            fields: [
                { key: 'id',          name: 'Email ID',        type: 'string' },
                { key: 'to',          name: 'To Address',      type: 'string' },
                { key: 'from',        name: 'From Address',    type: 'string' },
                { key: 'subject',     name: 'Subject',         type: 'string' },
                { key: 'created_at',  name: 'Sent At',         type: 'string' },
                { key: 'status',      name: 'Delivery Status', type: 'string' },
            ]
        });
    }

    // Generic fallback — return empty schema so the UI doesn't hard-error
    return res.json({ platform, fields: [] });
}));

// POST /api/saas/connectors/jira/discover/projects - Discover projects
router.post("/connectors/jira/discover/projects", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    console.log(`[JiraDiscovery] Starting for Org ID: ${organizationId}`);

    // Find the Jira connector for this org
    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(
            and(
                eq(saasConnectors.orgId, organizationId),
                eq(saasConnectors.platform, "jira")
            )
        )
        .limit(1);

    if (!connector) {
        console.warn(`[JiraDiscovery] No connector found for Org: ${organizationId}`);
        throw new BadRequestError("JIRA connector not found. Please connect JIRA first.");
    }

    console.log(`[JiraDiscovery] Found connector ${connector.id} for Org ${organizationId}, Status: ${connector.status}`);

    const { getJiraClient, JiraClient } = await import("@domain/integrations/jira-service.js");
    let client;

    const credentialId = connector.config?.credentialId || (connector.credentials as any)?.credentialId;
    if (credentialId) {
        client = await getJiraClient(credentialId, organizationId);
    } else {
        const creds = connector.credentials as any;
        const token = creds?.api_token || creds?.api_key || creds?.password;
        if (!creds?.base_url || !creds?.username || !token) {
            throw new BadRequestError("Incomplete Jira credentials in connector configuration");
        }
        client = new JiraClient(creds.base_url, creds.username, token, organizationId);
    }

    const projects = await client.getProjects(500);

    // Map to { results: [...] } format expected by UI
    res.json({
        results: projects.map((p: any) => ({
            id: p.id,
            key: p.key,
            name: p.name,
            projectTypeKey: p.projectTypeKey
        }))
    });
}));

// POST /api/saas/connectors/confluence/discover/spaces - Discover spaces
router.post("/connectors/confluence/discover/spaces", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    // Find the Confluence connector for this org
    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(
            and(
                eq(saasConnectors.orgId, organizationId),
                eq(saasConnectors.platform, "confluence")
            )
        )
        .limit(1);

    if (!connector) {
        throw new BadRequestError("Confluence connector not found for this organization");
    }

    const { getConfluenceClient, ConfluenceClient } = await import("@domain/integrations/confluence-service.js");
    let client;

    const credentialId = connector.config?.credentialId || (connector.credentials as any)?.credentialId;
    if (credentialId) {
        client = await getConfluenceClient(credentialId, organizationId);
    } else {
        const creds = connector.credentials as any;
        const resolvedEndpoint = creds?.endpoint || creds?.base_url;
        const resolvedAccount = creds?.account || creds?.username;
        const resolvedKey = creds?.api_key || creds?.api_token || creds?.password;
        if (!resolvedEndpoint || !resolvedAccount || !resolvedKey) {
            throw new BadRequestError("Incomplete Confluence credentials in connector configuration");
        }
        client = new ConfluenceClient(resolvedEndpoint, resolvedAccount, resolvedKey, organizationId);
    }

    const spaces = await client.getSpaces(500);

    // Map to { results: [...] } format expected by UI
    res.json({
        results: spaces.map((s: any) => ({
            id: s.id,
            key: s.key,
            name: s.name,
            type: s.type
        }))
    });
}));

// POST /api/saas/connectors/jira/discover/fields - Discover Jira fields
router.post("/connectors/jira/discover/fields", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(
            and(
                eq(saasConnectors.orgId, organizationId),
                eq(saasConnectors.platform, "jira")
            )
        )
        .limit(1);

    if (!connector) throw new BadRequestError("JIRA connector not found");

    const { JiraClient } = await import("@domain/integrations/jira-service.js");
    const creds = connector.credentials as any;
    const resolvedEndpoint = creds?.endpoint || creds?.base_url;
    const resolvedAccount = creds?.account || creds?.username;
    const resolvedKey = creds?.api_key || creds?.api_token || creds?.password;
    const client = new JiraClient(resolvedEndpoint, resolvedAccount, resolvedKey, organizationId);

    const fields = await client.getFields();

    res.json({
        results: fields.map((f: any) => ({
            id: f.id,
            name: f.name,
            custom: f.custom,
            schema: f.schema
        }))
    });
}));

// POST /api/saas/connectors/confluence/discover/fields - Discover Confluence fields
router.post("/connectors/confluence/discover/fields", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(
            and(
                eq(saasConnectors.orgId, organizationId),
                eq(saasConnectors.platform, "confluence")
            )
        )
        .limit(1);

    if (!connector) throw new BadRequestError("Confluence connector not found");

    const { ConfluenceClient } = await import("@domain/integrations/confluence-service.js");
    const creds = connector.credentials as any;
    const resolvedEndpoint = creds?.endpoint || creds?.base_url;
    const resolvedAccount = creds?.account || creds?.username;
    const resolvedKey = creds?.api_key || creds?.api_token || creds?.password;
    const client = new ConfluenceClient(resolvedEndpoint, resolvedAccount, resolvedKey, organizationId);

    // Confluence fields are mostly fixed but can have metadata labels
    res.json({
        results: [
            { id: 'title', name: 'Page Title' },
            { id: 'body', name: 'Page Content (Storage)' },
            { id: 'space', name: 'Space' },
            { id: 'version', name: 'Version Metadata' },
            { id: 'labels', name: 'Labels' },
            { id: 'attachments', name: 'Attachments' },
            { id: 'comments', name: 'Comments' }
        ]
    });
}));

// POST /api/saas/connectors/slack/discover/channels - Discover channels
router.post("/connectors/slack/discover/channels", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const organizationId = requireOrgId(orgContext);

    // Find the Slack connector for this org
    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(
            and(
                eq(saasConnectors.orgId, organizationId),
                eq(saasConnectors.platform, "slack")
            )
        )
        .limit(1);

    if (!connector) {
        throw new BadRequestError("Slack connector not found for this organization");
    }

    const { getSlackClient } = await import("@domain/integrations/slack-service.js");
    const creds = connector.credentials as any;
    const token = creds?.bot_token || creds?.api_token || creds?.token;

    if (!token) {
        throw new BadRequestError("Incomplete Slack credentials in connector configuration");
    }

    const client = await getSlackClient(token);
    const channels = await client.getChannels(500);

    // Map to { results: [...] } format expected by UI
    res.json({
        results: channels.map((c: any) => ({
            id: c.id,
            name: c.name,
            is_private: c.is_private,
            num_members: c.num_members
        }))
    });
}));

export default router;
