/**
 * Atlassian Connector Bridge
 *
 * Resolves an org's JIRA or Confluence saasConnector row into an
 * authenticated client instance, using the new credential field names
 * (endpoint / account / api_key) with legacy fallbacks (base_url / username / api_token).
 *
 * All SDLC tools and cycle blueprints should use these helpers instead
 * of directly instantiating JiraClient or ConfluenceClient.
 */

import { db } from "@server/database_service.js";
import { saasConnectors } from "@shared/schema/index.js";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { JiraClient } from "./jira-service.js";
import { ConfluenceClient } from "./confluence-service.js";

const logger = createLogger("AtlassianConnectorBridge");

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveJiraCreds(creds: Record<string, any>): { endpoint: string; account: string; apiKey: string } {
    const endpoint = creds.endpoint || creds.base_url || "";
    const account  = creds.account  || creds.username  || "";
    const apiKey   = creds.api_key  || creds.api_token || creds.password || "";
    return { endpoint, account, apiKey };
}

function resolveConfluenceCreds(creds: Record<string, any>): { endpoint: string; account: string; apiKey: string } {
    // Confluence cloud endpoint is typically base_url + /wiki
    let endpoint = creds.endpoint || creds.base_url || "";
    const account  = creds.account  || creds.username  || "";
    const apiKey   = creds.api_key  || creds.api_token || creds.password || "";
    return { endpoint, account, apiKey };
}

// ---------------------------------------------------------------------------
// Exported bridge functions
// ---------------------------------------------------------------------------

/**
 * Resolves the org's Jira saasConnector and returns an authenticated JiraClient.
 * Throws if no connected Jira connector is found.
 */
export async function getJiraClientForOrg(orgId: number): Promise<JiraClient> {
    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(and(
            eq(saasConnectors.orgId, orgId),
            eq(saasConnectors.platform, "jira")
        ))
        .limit(1);

    if (!connector) {
        throw new Error(`No Jira connector found for organization ${orgId}. Connect JIRA in the Connectors Dashboard first.`);
    }

    const creds = (connector.credentials as Record<string, any>) || {};
    const { endpoint, account, apiKey } = resolveJiraCreds(creds);

    if (!endpoint || !account || !apiKey) {
        throw new Error("Jira connector is missing required credentials (endpoint, account, api_key). Please re-save the connector.");
    }

    let cleanEndpoint = endpoint.trim();
    if (!cleanEndpoint.startsWith("http")) cleanEndpoint = "https://" + cleanEndpoint;

    logger.debug(`[AtlassianBridge] Resolved Jira client for org ${orgId} → ${cleanEndpoint}`);
    return new JiraClient(cleanEndpoint, account, apiKey, orgId);
}

/**
 * Resolves the org's Confluence saasConnector and returns an authenticated ConfluenceClient.
 * Throws if no connected Confluence connector is found.
 */
export async function getConfluenceClientForOrg(orgId: number): Promise<ConfluenceClient> {
    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(and(
            eq(saasConnectors.orgId, orgId),
            eq(saasConnectors.platform, "confluence")
        ))
        .limit(1);

    if (!connector) {
        throw new Error(`No Confluence connector found for organization ${orgId}. Connect Confluence in the Connectors Dashboard first.`);
    }

    const creds = (connector.credentials as Record<string, any>) || {};
    const { endpoint, account, apiKey } = resolveConfluenceCreds(creds);

    if (!endpoint || !account || !apiKey) {
        throw new Error("Confluence connector is missing required credentials (endpoint, account, api_key). Please re-save the connector.");
    }

    let cleanEndpoint = endpoint.trim();
    if (!cleanEndpoint.startsWith("http")) cleanEndpoint = "https://" + cleanEndpoint;

    logger.debug(`[AtlassianBridge] Resolved Confluence client for org ${orgId} → ${cleanEndpoint}`);
    return new ConfluenceClient(cleanEndpoint, account, apiKey, orgId);
}

/**
 * Returns the configured default project key from the Jira connector config,
 * falling back to `fallback` when one is given.
 *
 * Throws when neither exists. The fallback used to be one customer's project
 * key, so an organization that never configured a default had its issues
 * aimed at a project it does not have.
 */
export async function getJiraDefaultProjectKey(
    orgId: number,
    fallback?: string,
    projectId: number | null = null,
): Promise<string> {
    let configured: string | undefined;
    try {
        const connector = await resolveScopedConnector(orgId, "jira", projectId);
        const config = (connector?.config as Record<string, any>) || {};
        configured = config.defaultProjectKey || config.project_key;
    } catch { /* no connector row: use the fallback */ }
    const key = configured || fallback;
    if (!key) {
        throw new Error("No Jira project key: pass projectKey, or set a default project key on the organization's Jira connector.");
    }
    return key;
}

/**
 * Returns the configured default Confluence space key from the connector
 * config, falling back to `fallback` when one is given. Throws when neither
 * exists, for the same reason as getJiraDefaultProjectKey.
 */
export async function getConfluenceDefaultSpace(
    orgId: number,
    fallback?: string,
    projectId: number | null = null,
): Promise<string> {
    let configured: string | undefined;
    try {
        const connector = await resolveScopedConnector(orgId, "confluence", projectId);
        const config = (connector?.config as Record<string, any>) || {};
        configured = config.defaultSpace || config.space_key || config.spaceKey;
    } catch { /* no connector row: use the fallback */ }
    const key = configured || fallback;
    if (!key) {
        throw new Error("No Confluence space: pass space, or set a default space on the organization's Confluence connector.");
    }
    return key;
}

/**
 * The connector a project should use: its own if it has bound one, otherwise
 * the organization's.
 *
 * Both are legitimate rows for the same platform since migration 0080, so an
 * unordered `limit(1)` would return whichever Postgres happened to reach first
 * — a project's Confluence space would resolve to the org default about half
 * the time. Ordering by projectId descending puts the project's own row first,
 * because NULL sorts last under DESC NULLS LAST.
 */
async function resolveScopedConnector(
    orgId: number,
    platform: string,
    projectId: number | null,
): Promise<{ config: Record<string, any> | null } | undefined> {
    const scopeFilter = projectId == null
        ? isNull(saasConnectors.projectId)
        : or(isNull(saasConnectors.projectId), eq(saasConnectors.projectId, projectId));

    const [connector] = await db
        .select({ config: saasConnectors.config })
        .from(saasConnectors)
        .where(and(
            eq(saasConnectors.orgId, orgId),
            eq(saasConnectors.platform, platform),
            scopeFilter,
        ))
        .orderBy(sql`${saasConnectors.projectId} DESC NULLS LAST`)
        .limit(1);

    return connector;
}
