import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
    saasConnectors,
    saasSyncConfigs,
    saasSchemaSnapshots,
    projectSaasBindings,
} from "@shared/schema/index.js";
import { projects } from "@shared/schema/projects.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SaasAdapterInventory");

/**
 * What a room needs to know about a SaaS adapter to reason about it.
 *
 * The pieces live in three tables and a JSON blob: the connection in
 * `saas_connectors`, the cadence in `saas_sync_configs`, the captured field
 * definitions in `saas_schema_snapshots`, and the bound external resource — a
 * Jira project key or a Confluence space key — inside `config`. Resolving that
 * in one place keeps the surface, the tool and the Atlassian bridge agreeing on
 * what "the ENG space" means.
 */
export interface SaasAdapterSummary {
    connectorId: number;
    platform: string;
    status: string;
    /** NULL project means the connector serves the whole organization. */
    projectId: number | null;
    projectKey: string | null;
    scope: "project" | "organization";
    /** The Jira project / Confluence space this adapter is bound to, if any. */
    boundResource: { kind: string; value: string } | null;
    baseUrl: string | null;
    /**
     * `null` means never synced — distinct from a sync that ran and found
     * nothing. The surface must not render one as the other.
     */
    lastSync: string | null;
    syncConfig: {
        enabled: boolean;
        syncIntervalMinutes: number;
        conflictResolution: string;
    } | null;
    /**
     * `null` when no snapshot has ever been captured. The capture path runs
     * through the sync service, so an adapter can be connected and still have
     * no schema — reporting 0 fields would claim a measurement never taken.
     */
    schemaSnapshot: {
        name: string;
        version: number;
        fieldCount: number;
        capturedAt: string | null;
    } | null;
    /**
     * The external resources this project reaches through this connection.
     *
     * Empty is a real answer — a connection with nothing bound is reachable but
     * unused, which is different from no connection at all.
     */
    bindings: Array<{
        id: number;
        resourceKind: string;
        resourceKey: string;
        resourceName: string | null;
        resourceType: string | null;
        webUrl: string | null;
        boundBy: string | null;
        boundAt: string | null;
    }>;
}

/** Where each platform keeps the name of the thing it is bound to. */
const BOUND_RESOURCE_KEYS: Record<string, { kind: string; keys: string[] }> = {
    quickbooks: { kind: "QuickBooks company", keys: ["realmId"] },
    jira: { kind: "Jira project", keys: ["defaultProjectKey", "project_key", "projectKey"] },
    confluence: { kind: "Confluence space", keys: ["defaultSpace", "space_key", "spaceKey"] },
    github: { kind: "Repository", keys: ["defaultRepo", "repo", "repository"] },
    slack: { kind: "Channel", keys: ["defaultChannel", "channel"] },
};

export function resolveBoundResource(platform: string, config: Record<string, any> | null) {
    const spec = BOUND_RESOURCE_KEYS[platform];
    if (!spec || !config) return null;
    for (const key of spec.keys) {
        const value = config[key];
        if (typeof value === "string" && value.trim()) {
            return { kind: spec.kind, value: value.trim() };
        }
    }
    return null;
}

export const saasAdapterInventoryService = {
    /**
     * Adapters visible to a project: the ones it owns, plus the organization's
     * own. A project that has not bound its own Jira still inherits the org's,
     * which is what `getJiraDefaultProjectKey` has always resolved.
     */
    async listForProject(orgId: number, projectId: number | null): Promise<SaasAdapterSummary[]> {
        try {
            const scopeFilter = projectId == null
                ? isNull(saasConnectors.projectId)
                : or(isNull(saasConnectors.projectId), eq(saasConnectors.projectId, projectId));

            const rows = await db
                .select({
                    id: saasConnectors.id,
                    platform: saasConnectors.platform,
                    status: saasConnectors.status,
                    projectId: saasConnectors.projectId,
                    projectKey: projects.key,
                    baseUrl: saasConnectors.baseUrl,
                    config: saasConnectors.config,
                    lastSync: saasConnectors.lastSync,
                })
                .from(saasConnectors)
                .leftJoin(projects, eq(projects.id, saasConnectors.projectId))
                .where(and(eq(saasConnectors.orgId, orgId), scopeFilter))
                .orderBy(saasConnectors.platform);

            if (rows.length === 0) return [];

            const connectorIds = rows.map((r) => r.id);
            const [syncConfigs, snapshots, bindings] = await Promise.all([
                db.select().from(saasSyncConfigs).where(inArray(saasSyncConfigs.connectorId, connectorIds)),
                db
                    .select()
                    .from(saasSchemaSnapshots)
                    .where(inArray(saasSchemaSnapshots.connectorId, connectorIds))
                    .orderBy(desc(saasSchemaSnapshots.version)),
                // Bindings belong to a project, so an org-wide listing has none.
                projectId == null
                    ? Promise.resolve([] as any[])
                    : db
                        .select()
                        .from(projectSaasBindings)
                        .where(and(
                            eq(projectSaasBindings.orgId, orgId),
                            eq(projectSaasBindings.projectId, projectId),
                        )),
            ]);

            const bindingsByConnector = new Map<number, any[]>();
            for (const binding of bindings) {
                const list = bindingsByConnector.get(binding.connectorId) ?? [];
                list.push(binding);
                bindingsByConnector.set(binding.connectorId, list);
            }

            const configByConnector = new Map(syncConfigs.map((c) => [c.connectorId, c]));
            // Ordered by version desc, so the first seen per connector is latest.
            const snapshotByConnector = new Map<number, (typeof snapshots)[number]>();
            for (const snapshot of snapshots) {
                if (!snapshotByConnector.has(snapshot.connectorId)) {
                    snapshotByConnector.set(snapshot.connectorId, snapshot);
                }
            }

            return rows.map((row) => {
                const syncConfig = configByConnector.get(row.id);
                const snapshot = snapshotByConnector.get(row.id);
                return {
                    connectorId: row.id,
                    platform: row.platform,
                    status: row.status,
                    projectId: row.projectId ?? null,
                    projectKey: row.projectKey ?? null,
                    scope: row.projectId == null ? ("organization" as const) : ("project" as const),
                    boundResource: resolveBoundResource(row.platform, row.config as Record<string, any>),
                    baseUrl: row.baseUrl ?? null,
                    lastSync: row.lastSync ? new Date(row.lastSync).toISOString() : null,
                    syncConfig: syncConfig
                        ? {
                              enabled: syncConfig.enabled,
                              syncIntervalMinutes: syncConfig.syncInterval,
                              conflictResolution: syncConfig.conflictResolution,
                          }
                        : null,
                    schemaSnapshot: snapshot
                        ? {
                              name: snapshot.name,
                              version: snapshot.version,
                              fieldCount: Array.isArray(snapshot.fields) ? snapshot.fields.length : 0,
                              capturedAt: snapshot.createdAt ? new Date(snapshot.createdAt).toISOString() : null,
                          }
                        : null,
                    bindings: (bindingsByConnector.get(row.id) ?? []).map((binding) => ({
                        id: binding.id,
                        resourceKind: binding.resourceKind,
                        resourceKey: binding.resourceKey,
                        resourceName: binding.resourceName ?? null,
                        resourceType: binding.resourceType ?? null,
                        webUrl: binding.webUrl ?? null,
                        boundBy: binding.boundBy ?? null,
                        boundAt: binding.createdAt ? new Date(binding.createdAt).toISOString() : null,
                    })),
                };
            });
        } catch (error: any) {
            // Surfaced, not swallowed: a dark adapter list is indistinguishable
            // from "this project has no integrations", which is the failure this
            // surface exists to prevent.
            logger.error(`Failed to list SaaS adapters for org ${orgId}: ${error?.message}`);
            throw error;
        }
    },
};
