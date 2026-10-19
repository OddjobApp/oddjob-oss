
import { db } from "../../database_service.js";
import { saasConnectors, saasSyncConfigs, saasSchemaSnapshots } from "@shared/schema/index.js";
import { eq, and, desc, or, isNull, sql } from "drizzle-orm";
import { datasetService } from "../knowledge/index.js";
import { ConfluenceClient } from "./confluence-service.js";
import { saasIntegrationService } from "./saas-integration-service.js";
import { createLogger } from "../../utils/logger.js";
import { eventStream } from "../core/infrastructure/event-stream.service.js";

const logger = createLogger("SaaSSyncService");

export const saasSyncService = {
    /**
     * Syncs a platform for a specific organization.
     *
     * `options.connectorId` pins the exact connector row — the sync worker
     * iterates per-connector configs, so org+platform alone is ambiguous when a
     * platform has both an org-wide and a project-scoped connection.
     * `options.projectId` prefers the project-scoped connector and falls back
     * to the org-wide one, matching project-scoped connector resolution.
     */
    syncPlatform: async (platform: string, organizationId: number, userId: string = 'system', syncType: string = 'knowledge_store', isSuperAdmin: boolean = false, options: { connectorId?: number; projectId?: number | null } = {}) => {
        logger.info(`Starting sync for platform: ${platform}, Org: ${organizationId}`);

        let connector;
        if (options.connectorId != null) {
            [connector] = await db
                .select()
                .from(saasConnectors)
                .where(
                    and(
                        eq(saasConnectors.id, options.connectorId),
                        eq(saasConnectors.orgId, organizationId),
                        eq(saasConnectors.platform, platform)
                    )
                )
                .limit(1);
        } else if (options.projectId != null) {
            [connector] = await db
                .select()
                .from(saasConnectors)
                .where(
                    and(
                        eq(saasConnectors.orgId, organizationId),
                        eq(saasConnectors.platform, platform),
                        or(eq(saasConnectors.projectId, options.projectId), isNull(saasConnectors.projectId))
                    )
                )
                .orderBy(sql`${saasConnectors.projectId} DESC NULLS LAST`)
                .limit(1);
        } else {
            [connector] = await db
                .select()
                .from(saasConnectors)
                .where(
                    and(
                        eq(saasConnectors.orgId, organizationId),
                        eq(saasConnectors.platform, platform)
                    )
                )
                .limit(1);
        }

        if (!connector) {
            throw new Error(`Connector not found for platform ${platform} and org ${organizationId}`);
        }

        const [syncConfig] = await db
            .select()
            .from(saasSyncConfigs)
            .where(eq(saasSyncConfigs.connectorId, connector.id))
            .limit(1);

        const connConfig = (connector.config || {}) as any;
        const mappings = syncConfig?.mappings || connConfig.mappings || {};
        const filters = {
            ...(connConfig.filters || {}),
            ...(syncConfig?.filters || {})
        };
        
        const config = {
            ...connConfig,
            ...(syncConfig || {}),
            mappings,
            filters
        };

        const svcOrgContext = {
            organizationId,
            userId,
            isSuperAdmin
        };

        if (platform === 'confluence') {
            return await saasSyncService.syncConfluence(connector, config, svcOrgContext, syncType);
        } else if (platform === 'jira') {
            return await saasSyncService.syncJira(connector, config, svcOrgContext, syncType);
        } else if (platform === 'slack') {
            return await saasSyncService.syncSlack(connector, config, svcOrgContext, syncType);
        } else if (platform === 'quickbooks') {
            const { syncQuickBooks } = await import("./quickbooks/sync.js");
            return await syncQuickBooks(connector, config, svcOrgContext, syncType);
        } else if (platform === 'servicenow') {
            // Schema capture only, for now. ServiceNow has no record-ingestion
            // path here yet, but its field definitions are exactly what the
            // adapter surface and drift detection need, and capturing them does
            // not depend on ingestion existing.
            const { captureServiceNowSchema } = await import("./servicenow-schema.service.js");
            const table = config?.filters?.tableName || config?.tableName || 'incident';
            const result = await captureServiceNowSchema(organizationId, table);
            return {
                success: true,
                platform,
                syncType: 'schema',
                message: result.captured
                    ? `Captured ${table} schema v${result.version} (${result.fieldCount} fields, ${result.reason.replace('_', ' ')}).`
                    : `${table} schema unchanged at v${result.version} (${result.fieldCount} fields).`,
                ...result,
            };
        } else {
            throw new Error(`Sync not yet implemented for ${platform}`);
        }
    },

    syncConfluence: async (connector: any, config: any, context: any, syncType: string) => {
        const creds = connector.credentials as any;
        // Support new fields (endpoint/account/api_key) with fallback to legacy (base_url/username/api_token)
        const endpoint = creds.endpoint || creds.base_url || "";
        const account  = creds.account  || creds.username  || "";
        const apiKey   = creds.api_key  || creds.api_token || creds.password || "";
        let cleanEndpoint = endpoint.trim();
        if (!cleanEndpoint.startsWith("http")) cleanEndpoint = "https://" + cleanEndpoint;
        const client = new ConfluenceClient(
            cleanEndpoint,
            account,
            apiKey,
            connector.orgId
        );

        let spacesToSync: any[] = [];
        if (config.filters?.allowed_spaces && config.filters.allowed_spaces.length > 0) {
            spacesToSync = config.filters.allowed_spaces.map((key: string) => ({ key }));
        } else if (config.filters?.project_key) {
            spacesToSync = [{ key: config.filters.project_key }];
        } else if (config.allowed_spaces && config.allowed_spaces.length > 0) {
            spacesToSync = config.allowed_spaces.map((key: string) => ({ key }));
        } else {
            // FIX: Use getAllSpaces to avoid the 100-limit bug
            spacesToSync = await client.getAllSpaces(50, 500);
        }

        const dataset = await datasetService.ensurePlatformDataset('confluence', context);
        const PAGE_SIZE = 50;
        let totalPages = 0;

        for (const space of spacesToSync) {
            const pages = await client.getAllPagesInSpace(space.key, PAGE_SIZE);

            if (pages.length > 0) {
                const items = pages.map(page => {
                    const baseData = {
                        id: page.id,
                        title: page.title,
                        space: page.space?.name || space.key,
                        url: `${cleanEndpoint}${page._links?.webui || ''}`,
                        content: page.body?.storage?.value || '',
                        markdown: client.convertToMarkdown(page.body?.storage?.value || ''),
                        lastUpdated: (page as any).version?.when || new Date().toISOString(),
                        source: 'confluence',
                        sourceCreatedAt: (page as any).history?.createdDate || (page as any).version?.when || new Date().toISOString(),
                        sourceUpdatedAt: (page as any).version?.when || new Date().toISOString()
                    };

                    const mappedData: any = { ...baseData };
                    Object.entries(config.mappings || {}).forEach(([sourceKey, targetKey]) => {
                        if ((page as any)[sourceKey] !== undefined) {
                            mappedData[targetKey as string] = (page as any)[sourceKey];
                        }
                    });

                    return { data: mappedData, rawData: page };
                });

                await datasetService.addItems(dataset.id, items, context);
                
                // Emit events for newly discovered items
                for (const item of items) {
                    eventStream.publish('confluence.page_discovered', item.data, { 
                        organizationId: context.organizationId,
                        subject: item.data.id 
                    }, 'confluence-sync');
                }
                
                totalPages += pages.length;
            }
        }

        await db.update(saasConnectors)
            .set({ lastSync: new Date(), status: 'connected' })
            .where(eq(saasConnectors.id, connector.id));

        if (syncType === 'knowledge_store') {
            await saasIntegrationService.triggerPlatformExtraction('confluence', context.organizationId, context.userId);
        }

        return { success: true, pages: totalPages, spaces: spacesToSync.length };
    },

    syncJira: async (connector: any, config: any, context: any, syncType: string) => {
        const creds = connector.credentials as any;
        // Support new fields (endpoint/account/api_key) with fallback to legacy (base_url/username/api_token)
        const endpoint = creds.endpoint || creds.base_url || "";
        const account  = creds.account  || creds.username  || "";
        const token    = creds.api_key  || creds.api_token || creds.password || "";
        let cleanUrl = endpoint.trim();
        if (!cleanUrl.startsWith('http')) {
            cleanUrl = 'https://' + cleanUrl;
        }

        const { JiraClient } = await import("./jira-service.js");
        const client = new JiraClient(cleanUrl, account, token);

        // Capture JIRA Schema Snapshot automatically
        try {
            logger.info(`[SaaSSyncService] Fetching JIRA schema fields for drift detection...`);
            const jiraFields = await client.getFields();
            if (jiraFields && Array.isArray(jiraFields)) {
                const [lastSnapshot] = await db
                    .select()
                    .from(saasSchemaSnapshots)
                    .where(eq(saasSchemaSnapshots.connectorId, connector.id))
                    .orderBy(desc(saasSchemaSnapshots.version))
                    .limit(1);

                const hasDrift = !lastSnapshot || hasSchemaDrift(jiraFields, lastSnapshot.fields || []);
                if (hasDrift) {
                    const version = (lastSnapshot?.version || 0) + 1;
                    const snapshotName = `JIRA Schema Snapshot v${version} - Auto-Synced`;
                    
                    await db.insert(saasSchemaSnapshots)
                        .values({
                            connectorId: connector.id,
                            platform: 'jira',
                            name: snapshotName,
                            fields: jiraFields,
                            version,
                            createdAt: new Date()
                        });
                    logger.info(`[SaaSSyncService] JIRA Schema drift detected. Saved snapshot v${version} successfully.`);
                } else {
                    logger.info(`[SaaSSyncService] JIRA Schema snapshot up to date (v${lastSnapshot.version}).`);
                }
            }
        } catch (schemaErr: any) {
            logger.warn(`[SaaSSyncService] Failed to auto-capture JIRA schema snapshot: ${schemaErr.message}`);
        }

        let projectsToSync: string[] = [];
        if (config.filters?.allowed_projects && config.filters.allowed_projects.length > 0) {
            projectsToSync = config.filters.allowed_projects;
        } else if (config.filters?.project_key) {
            projectsToSync = [config.filters.project_key];
        } else if (config.allowed_projects && config.allowed_projects.length > 0) {
            projectsToSync = config.allowed_projects;
        }

        if (projectsToSync.length === 0) {
            const projects = await client.getAllProjects(500);
            projectsToSync = projects.map((p: any) => p.key);
        }

        const dataset = await datasetService.ensurePlatformDataset('jira', context);
        const BATCH_SIZE = 50;
        let totalIssues = 0;

        const mappedSourceKeys = Object.keys(config.mappings || {});
        const jiraAdditionalFields = Array.from(new Set([...(config.additional_fields || []), ...mappedSourceKeys]));

        for (const projectKey of projectsToSync) {
            let start = 0;
            let hasMore = true;

            while (hasMore) {
                const searchResult = await client.getIssuesInProject(projectKey, BATCH_SIZE, start, jiraAdditionalFields);
                const issues = searchResult.issues;

                if (issues && issues.length > 0) {
                    const items = issues.map(issue => {
                        const baseData = {
                            id: issue.id,
                            key: issue.key,
                            summary: issue.fields.summary,
                            project: projectKey,
                            url: `${cleanUrl}/browse/${issue.key}`,
                            content: client.issueToMarkdown(issue),
                            lastUpdated: issue.fields.updated,
                            source: 'jira',
                            sourceCreatedAt: issue.fields.created || new Date().toISOString(),
                            sourceUpdatedAt: issue.fields.updated || new Date().toISOString()
                        };

                        const mappedData: any = { ...baseData };
                        Object.entries(config.mappings || {}).forEach(([sourceKey, targetKey]) => {
                            let value = (issue.fields as any)[sourceKey];
                            if (value !== undefined && value !== null) {
                                if (typeof value === 'object' && !Array.isArray(value)) {
                                    value = value.value || value.name || value.label || JSON.stringify(value);
                                } else if (Array.isArray(value)) {
                                    value = value.map((v: any) => typeof v === 'object' ? (v.value || v.name || v.label || JSON.stringify(v)) : v).join(', ');
                                }
                                mappedData[targetKey as string] = value;
                            }
                        });

                        return { data: mappedData, rawData: issue };
                    });

                    await datasetService.addItems(dataset.id, items, context);
                    
                    // Emit events for newly discovered items
                    for (const item of items) {
                        eventStream.publish('jira.issue_discovered', item.data, { 
                            organizationId: context.organizationId,
                            subject: item.data.key 
                        }, 'jira-sync');
                    }
                    
                    totalIssues += issues.length;
                    start += issues.length;
                    // /rest/api/3/search/jql no longer returns `total`; use the
                    // endpoint's `isLast` flag (falls back to partial-page / hard cap).
                    if (issues.length < BATCH_SIZE || searchResult.isLast || start > 5000) hasMore = false;
                } else {
                    hasMore = false;
                }
            }
        }

        await db.update(saasConnectors)
            .set({ lastSync: new Date(), status: 'connected' })
            .where(eq(saasConnectors.id, connector.id));

        if (syncType === 'knowledge_store') {
            await saasIntegrationService.triggerPlatformExtraction('jira', context.organizationId, context.userId);
        }

        return { success: true, issues: totalIssues, projects: projectsToSync.length };
    },

    syncSlack: async (connector: any, config: any, context: any, syncType: string) => {
        const creds = connector.credentials as any;
        const token = creds?.bot_token || creds?.api_token || creds?.token;
        const { getSlackClient } = await import("./slack-service.js");
        const client = await getSlackClient(token);

        let channelsToSync: { id: string; name: string }[] = [];
        const allowedChannels: string[] = config.filters?.allowed_channels || config.allowed_channels || [];

        if (allowedChannels.length > 0) {
            channelsToSync = allowedChannels.map((id: string) => ({ id, name: id }));
        } else {
            const discovered = await client.getChannels(200);
            channelsToSync = discovered.map((c: any) => ({ id: c.id, name: c.name }));
        }

        const dataset = await datasetService.ensurePlatformDataset('slack', context);
        const MESSAGES_PER_CHANNEL = config.filters?.messages_per_channel || config.messages_per_channel || 200;
        let totalMessages = 0;

        for (const channel of channelsToSync) {
            try {
                const messages = await client.getHistory(channel.id, MESSAGES_PER_CHANNEL);
                if (messages.length > 0) {
                    const items = messages.map((msg: any) => {
                        const baseData = {
                            id: msg.ts,
                            channel: channel.name,
                            channelId: channel.id,
                            user: msg.user || msg.bot_id || 'unknown',
                            text: msg.text || '',
                            ts: msg.ts,
                            thread_ts: msg.thread_ts,
                            reply_count: msg.reply_count || 0,
                            lastUpdated: msg.edited ? new Date(parseFloat(msg.edited.ts) * 1000).toISOString() : new Date(parseFloat(msg.ts) * 1000).toISOString(),
                            source: 'slack',
                            sourceCreatedAt: new Date(parseFloat(msg.ts) * 1000).toISOString(),
                            sourceUpdatedAt: msg.edited ? new Date(parseFloat(msg.edited.ts) * 1000).toISOString() : new Date(parseFloat(msg.ts) * 1000).toISOString()
                        };

                        const mappedData: any = { ...baseData };
                        Object.entries(config.mappings || {}).forEach(([sourceKey, targetKey]) => {
                            if (msg[sourceKey] !== undefined) {
                                mappedData[targetKey as string] = msg[sourceKey];
                            }
                        });

                        return { data: mappedData, rawData: msg };
                    });

                    await datasetService.addItems(dataset.id, items, context);
                    
                    // Emit events for newly discovered items
                    for (const item of items) {
                        eventStream.publish('slack.message_discovered', item.data, { 
                            organizationId: context.organizationId,
                            subject: item.data.id 
                        }, 'slack-sync');
                    }
                    
                    totalMessages += messages.length;
                }
            } catch (err: any) {
                logger.warn(`Skipping Slack channel ${channel.name}: ${err.message}`);
            }
        }

        await db.update(saasConnectors)
            .set({ lastSync: new Date(), status: 'connected' })
            .where(eq(saasConnectors.id, connector.id));

        if (syncType === 'knowledge_store') {
            await saasIntegrationService.triggerPlatformExtraction('slack', context.organizationId, context.userId);
        }

        return { success: true, messages: totalMessages, channels: channelsToSync.length };
    }
};

export function hasSchemaDrift(newFields: any[], oldFields: any[]): boolean {
    if (newFields.length !== oldFields.length) return true;
    const oldMap = new Map<string, any>();
    for (const f of oldFields) {
        oldMap.set(f.id, f);
    }
    for (const f of newFields) {
        const oldField = oldMap.get(f.id);
        if (!oldField) return true;
        if (f.name !== oldField.name) return true;
        if (f.custom !== oldField.custom) return true;
        if (JSON.stringify(f.schema) !== JSON.stringify(oldField.schema)) return true;
    }
    return false;
}
