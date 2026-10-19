
import { db } from "@server/database_service.js";
import {
    knowledgeNodes,
    knowledgeEdges,
    knowledgeDocuments,
    datasetItems,
    pipelineExecutions,
    pipelines,
    credentials,
    saasConnectors
} from "@shared/schema/index.js";
import { eq, and, sql, desc, gte, lte } from "drizzle-orm";
import { subDays, startOfDay, endOfDay, format } from "date-fns";

export interface IntegrationStats {
    totalEntities: number;
    syncCount: number;
    lastSync: string | null;
    entityTypes: { label: string; count: number }[];
    recentActivity: {
        date: string;
        added: number;
        updated: number
    }[];
    healthScore: number;
}

export class IntegrationAnalyticsService {

    /**
     * Get aggregate stats for a specific integration (platform)
     */
    async getIntegrationStats(
        orgId: number,
        platform: string,
        days: number = 30
    ): Promise<IntegrationStats> {

        // 1. Entity Counts
        // Join with Knowledge Documents to filter by platform (metadata->>platform or integrationId)
        // We assume knowledgeDocuments.integrationId or metadata might store the platform.
        // For now, let's try matching generic metadata or integrationId if it's a string platform name.
        // Actually, looking at ingest, integrationId is passed.

        const entityStats = await db
            .select({
                count: sql<number>`count(*)`,
                label: knowledgeNodes.label
            })
            .from(knowledgeNodes)
            // @ts-ignore - drizzle join inference issues with facade exports sometimes
            .innerJoin(knowledgeDocuments, eq(knowledgeNodes.knowledgeDocumentId, knowledgeDocuments.id))
            .where(and(
                eq(knowledgeNodes.organizationId, orgId),
                // Heuristic: check if document title or metadata indicates platform
                // OR check pipelines linked to the document (if any)
                // For simplicity/robustness: use a broad LIKE on title or check metadata if we can
                sql`lower(${knowledgeDocuments.title}) LIKE ${`%${platform.toLowerCase()}%`}`
            ))
            .groupBy(knowledgeNodes.label);

        const totalEntities = entityStats.reduce((sum, row) => sum + Number(row.count), 0);
        const entityTypes = entityStats.map(row => ({
            label: row.label,
            count: Number(row.count)
        }));

        // 2. Recent Sync Activity (from pipeline executions)
        const recentExecutions = await db
            .select({
                executedAt: pipelineExecutions.startedAt,
                status: pipelineExecutions.status,
                triggerType: pipelineExecutions.traceSource
            })
            .from(pipelineExecutions)
            .innerJoin(pipelines, eq(pipelines.id, pipelineExecutions.pipelineId))
            .where(and(
                eq(pipelines.organizationId, orgId),
                sql`lower(${pipelines.name}) LIKE ${`%${platform.toLowerCase()}%`}`,
                gte(pipelineExecutions.startedAt, subDays(new Date(), days))
            ))
            .orderBy(desc(pipelineExecutions.startedAt));

        // @ts-ignore
        const lastSync = recentExecutions.length > 0 && recentExecutions[0].executedAt
            // @ts-ignore
            ? new Date(recentExecutions[0].executedAt).toISOString()
            : null;

        const syncCount = recentExecutions.filter(e => e.status === 'completed').length;

        // 3. Activity Trend
        const activityTrend = await db
            .select({
                date: sql<string>`DATE(${knowledgeNodes.createdAt})`,
                count: sql<number>`count(*)`
            })
            .from(knowledgeNodes)
            .innerJoin(knowledgeDocuments, eq(knowledgeNodes.knowledgeDocumentId, knowledgeDocuments.id))
            .where(and(
                eq(knowledgeNodes.organizationId, orgId),
                sql`lower(${knowledgeDocuments.title}) LIKE ${`%${platform.toLowerCase()}%`}`,
                gte(knowledgeNodes.createdAt, subDays(new Date(), days))
            ))
            .groupBy(sql`DATE(${knowledgeNodes.createdAt})`)
            .orderBy(sql`DATE(${knowledgeNodes.createdAt})`);

        const recentActivity = activityTrend.map(row => ({
            date: row.date,
            added: Number(row.count),
            updated: 0
        }));

        // 4. Calculate Health Score
        let healthScore = 100;
        if (recentExecutions.length > 0) {
            const last5 = recentExecutions.slice(0, 5);
            const failures = last5.filter(e => e.status === 'failed').length;
            healthScore = Math.max(0, 100 - (failures * 20));
        } else if (totalEntities === 0) {
            healthScore = 0;
        }

        return {
            totalEntities,
            syncCount,
            lastSync,
            entityTypes,
            recentActivity,
            healthScore
        };
    }

    /**
     * Get aggregate stats for validation of connectivity and throughput
     */
    async getAllConnectorStats(orgId: number): Promise<any[]> {
        const connectors = await db
            .select()
            .from(saasConnectors)
            .where(eq(saasConnectors.orgId, orgId));

        const statsPromises = connectors.map(async (connector) => {
            // Get stats for this specific connector's platform
            // Note: If multiple connectors exist for same platform, this might over-count if not filtering by connector ID.
            // But getIntegrationStats filters by platform string.
            // Ideally we filter by integration ID if available. 
            // For now, reuse getIntegrationStats but beware of overlaps.

            // To be precise, we need getIntegrationStats to accept integrationId optionally.
            // But simplistic approach: generic platform stats.
            const stats = await this.getIntegrationStats(orgId, connector.platform);

            return {
                platform: connector.platform,
                status: connector.status, // connected, error, disconnected
                last_sync: connector.lastSync ? connector.lastSync.toISOString() : null, // Uses generic stats lastSync if null? No, use connector's
                error_count: stats.healthScore < 80 ? 1 : 0, // Mock error count based on health or check pipeline failures
                records_processed: stats.totalEntities,
                avg_response_time: 0, // Not tracked yet
                uptime_percentage: stats.healthScore // Proxy health as uptime
            };
        });

        return Promise.all(statsPromises);
    }

    /**
     * Get global SaaS stats across all integrations
     */
    async getDashboardOverview(orgId: number) {
        const connectors = await db
            .select()
            .from(saasConnectors)
            .where(eq(saasConnectors.orgId, orgId));

        const connectedCount = connectors.filter(c => c.status === 'connected').length;
        const errorCount = connectors.filter(c => c.status === 'error').length;
        const platforms = [...new Set(connectors.map(c => c.platform))];

        // Overall health
        let overall_health = 'healthy';
        if (errorCount > 0) overall_health = 'degraded';
        if (errorCount > connectors.length / 2 && connectors.length > 0) overall_health = 'critical';
        if (connectors.length === 0) overall_health = 'unknown';

        return {
            total_connectors: connectors.length,
            connected_count: connectedCount,
            error_count: errorCount,
            platforms,
            overall_health,
            advanced_features: {
                bidirectional_syncs_enabled: 0,
                event_workflows_configured: 0,
                active_sync_tasks: 0
            }
        };
    }
}

export const integrationAnalyticsService = new IntegrationAnalyticsService();


