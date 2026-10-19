/**
 * Reporting Maintenance Service
 *
 * Handles periodic maintenance tasks for the reporting schema:
 * - Refreshes materialized KPI views (every 15 minutes)
 * - Creates future forensic log partitions (daily check)
 * - Optionally drops old partitions based on retention policy
 *
 * Lives under analytics/infrastructure — the reporting schema is an
 * analytics infrastructure concern, consistent with the pod-per-domain layout.
 */

import { db } from "@server/database_service.js";
import { sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ReportingMaintenance");

// Configuration
const KPI_REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const PARTITION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const PARTITION_RETENTION_MONTHS = 12;

let kpiRefreshInterval: NodeJS.Timeout | null = null;
let partitionCheckInterval: NodeJS.Timeout | null = null;

// ============================================================================
// SERVICE LIFECYCLE
// ============================================================================

export function startReportingMaintenance(): void {
    logger.debug("[ReportingMaintenance] Starting reporting maintenance service");

    // Initial refresh on startup (delayed to let DB connections settle)
    setTimeout(() => {
        refreshKpiViews().catch(err =>
            logger.error("[ReportingMaintenance] Initial KPI refresh failed:", err.message)
        );
    }, 10000); // 10 second delay

    // Schedule periodic KPI refresh
    kpiRefreshInterval = setInterval(() => {
        refreshKpiViews().catch(err =>
            logger.error("[ReportingMaintenance] KPI refresh failed:", err.message)
        );
    }, KPI_REFRESH_INTERVAL_MS);

    // Schedule partition management (daily)
    partitionCheckInterval = setInterval(() => {
        managePartitions().catch(err =>
            logger.error("[ReportingMaintenance] Partition management failed:", err.message)
        );
    }, PARTITION_CHECK_INTERVAL_MS);

    // Initial partition check
    setTimeout(() => {
        managePartitions().catch(err =>
            logger.error("[ReportingMaintenance] Initial partition check failed:", err.message)
        );
    }, 30000); // 30 second delay

    logger.debug("[ReportingMaintenance] Scheduled KPI refresh every 15 minutes");
    logger.debug("[ReportingMaintenance] Scheduled partition check every 24 hours");
}

export function stopReportingMaintenance(): void {
    if (kpiRefreshInterval) {
        clearInterval(kpiRefreshInterval);
        kpiRefreshInterval = null;
    }
    if (partitionCheckInterval) {
        clearInterval(partitionCheckInterval);
        partitionCheckInterval = null;
    }
    logger.debug("[ReportingMaintenance] Stopped reporting maintenance service");
}

// ============================================================================
// KPI VIEW REFRESH
// ============================================================================

export async function refreshKpiViews(): Promise<{
    success: boolean;
    results?: Array<{ viewName: string; durationMs: number }>;
    error?: string;
}> {
    const startTime = Date.now();

    try {
        const schemaCheck = await db.execute(sql`
            SELECT EXISTS (
                SELECT 1 FROM information_schema.schemata
                WHERE schema_name = 'reporting'
            ) as schema_exists
        `);

        const schemaExists = (schemaCheck.rows[0] as any)?.schema_exists;
        if (!schemaExists) {
            logger.debug("[ReportingMaintenance] Reporting schema not found, skipping refresh");
            return { success: true, results: [] };
        }

        const funcCheck = await db.execute(sql`
            SELECT EXISTS (
                SELECT 1 FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE n.nspname = 'reporting' AND p.proname = 'refresh_kpi_views'
            ) as func_exists
        `);

        const funcExists = (funcCheck.rows[0] as any)?.func_exists;
        if (!funcExists) {
            logger.debug("[ReportingMaintenance] refresh_kpi_views function not found, skipping");
            return { success: true, results: [] };
        }

        const result = await db.execute(sql`SELECT * FROM reporting.refresh_kpi_views()`);

        const refreshResults = (result.rows as any[]).map(row => {
            const viewName = row.view_name ?? row.viewName;
            const durationMs = Number(row.refresh_duration_ms ?? row.refreshDurationMs);
            if (viewName === undefined) {
                logger.warn('[ReportingMaintenance] Unexpected row shape from refresh_kpi_views:', row as object);
            }
            return { viewName, durationMs };
        });

        const totalDuration = Date.now() - startTime;
        const summary = refreshResults.length === 0
            ? "no views found"
            : refreshResults.map(r => `${r.viewName ?? 'unknown'}(${isNaN(r.durationMs) ? '?' : r.durationMs}ms)`).join(", ");
        logger.debug(`[ReportingMaintenance] KPI views refreshed in ${totalDuration}ms: ${summary}`);

        return { success: true, results: refreshResults };
    } catch (error: any) {
        logger.error("[ReportingMaintenance] Failed to refresh KPI views:", error.message);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// PARTITION MANAGEMENT
// ============================================================================

export async function managePartitions(): Promise<{
    success: boolean;
    created?: string[];
    dropped?: string[];
    error?: string;
}> {
    try {
        const funcCheck = await db.execute(sql`
            SELECT EXISTS (
                SELECT 1 FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace = n.oid
                WHERE n.nspname = 'reporting' AND p.proname = 'create_forensic_partition_if_needed'
            ) as func_exists
        `);

        const funcExists = (funcCheck.rows[0] as any)?.func_exists;
        if (!funcExists) {
            logger.debug("[ReportingMaintenance] Partition functions not found, skipping");
            return { success: true, created: [], dropped: [] };
        }

        const created: string[] = [];
        const dropped: string[] = [];

        for (let monthOffset = 0; monthOffset <= 3; monthOffset++) {
            const result = await db.execute(sql`
                SELECT reporting.create_forensic_partition_if_needed(
                    CURRENT_DATE + ${sql.raw(`INTERVAL '${monthOffset} months'`)}
                ) as result
            `);
            const message = (result.rows[0] as any)?.result;
            if (message?.includes("Created")) {
                created.push(message);
                logger.debug(`[ReportingMaintenance] ${message}`);
            }
        }

        const dropResult = await db.execute(sql`
            SELECT * FROM reporting.drop_old_forensic_partitions(${PARTITION_RETENTION_MONTHS})
        `);

        for (const row of dropResult.rows as any[]) {
            dropped.push(`${row.partition_name}: ${row.action}`);
            logger.debug(`[ReportingMaintenance] Dropped partition: ${row.partition_name}`);
        }

        if (created.length === 0 && dropped.length === 0) {
            logger.debug("[ReportingMaintenance] Partition check complete, no changes needed");
        }

        return { success: true, created, dropped };
    } catch (error: any) {
        logger.error("[ReportingMaintenance] Partition management failed:", error.message);
        return { success: false, error: error.message };
    }
}

// ============================================================================
// STATUS / INSPECTION (for API endpoints)
// ============================================================================

export async function getKpiRefreshStatus(): Promise<{
    lastRefresh?: Date;
    nextScheduledRefresh?: Date;
    isRunning: boolean;
}> {
    try {
        const result = await db.execute(sql`
            SELECT refreshed_at
            FROM reporting.kpi_pipeline_performance
            LIMIT 1
        `);

        const lastRefresh = (result.rows[0] as any)?.refreshed_at;

        return {
            lastRefresh: lastRefresh ? new Date(lastRefresh) : undefined,
            nextScheduledRefresh: lastRefresh
                ? new Date(new Date(lastRefresh).getTime() + KPI_REFRESH_INTERVAL_MS)
                : undefined,
            isRunning: kpiRefreshInterval !== null
        };
    } catch {
        return { isRunning: kpiRefreshInterval !== null };
    }
}

export async function listPartitions(): Promise<{
    partitions: Array<{ name: string; estimatedRows?: number }>;
}> {
    try {
        const result = await db.execute(sql`
            SELECT
                c.relname as name,
                c.reltuples::bigint as estimated_rows
            FROM pg_class c
            JOIN pg_namespace n ON c.relnamespace = n.oid
            WHERE c.relname LIKE 'forensic_event_log_y%'
            ORDER BY c.relname
        `);

        return {
            partitions: (result.rows as any[]).map(row => ({
                name: row.name,
                estimatedRows: Number(row.estimated_rows)
            }))
        };
    } catch {
        return { partitions: [] };
    }
}
