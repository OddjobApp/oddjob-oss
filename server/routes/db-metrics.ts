/**
 * Database Metrics Routes
 * 
 * Endpoints for monitoring database performance and data volumes.
 * Helps identify candidates for NoSQL or caching.
 */

import { Router, type Request, type Response } from "express";
import { db } from "@server/database_service.js";
import { sql } from "drizzle-orm";
import { queryMonitor } from "../domain/core/infrastructure/query-monitor.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("DBMetrics");
const router = Router();

// ============================================================================
// QUERY PERFORMANCE METRICS
// ============================================================================

/**
 * GET /api/admin/db-metrics/queries
 * Get query performance report
 */
router.get("/queries", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const report = queryMonitor.getReport();
    res.json(report);
}));

// ============================================================================
// TABLE SIZE METRICS
// ============================================================================

/**
 * GET /api/admin/db-metrics/table-sizes
 * Get table sizes and row counts
 */
router.get("/table-sizes", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const result = await db.execute(sql`
        SELECT 
            schemaname,
            tablename,
            pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as total_size,
            pg_total_relation_size(schemaname || '.' || tablename) as size_bytes,
            pg_size_pretty(pg_relation_size(schemaname || '.' || tablename)) as table_size,
            pg_size_pretty(pg_indexes_size(schemaname || '.' || tablename::regclass)) as indexes_size,
            (SELECT reltuples::bigint FROM pg_class WHERE relname = tablename) as estimated_rows
        FROM pg_tables
        WHERE schemaname = 'public'
        ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
        LIMIT 50
    `);

    // Add recommendations based on size
    const tables = (result.rows as any[]).map((row: any) => {
        const sizeGB = row.size_bytes / (1024 * 1024 * 1024);
        const rows = parseInt(row.estimated_rows) || 0;

        let recommendation: string | null = null;

        if (sizeGB > 10) {
            recommendation = "Consider partitioning or archiving old data";
        } else if (rows > 10_000_000) {
            recommendation = "High row count - consider TimescaleDB for time-series or ClickHouse for analytics";
        } else if (row.tablename.includes("log") && rows > 1_000_000) {
            recommendation = "Log table growing - consider ClickHouse or log rotation";
        } else if (row.tablename.includes("graph") && rows > 500_000) {
            recommendation = "Large knowledge graph - consider Neo4j for complex traversals";
        }

        return {
            ...row,
            recommendation,
        };
    });

    res.json({
        generatedAt: new Date().toISOString(),
        tables,
    });
}));

// ============================================================================
// INDEX USAGE METRICS
// ============================================================================

/**
 * GET /api/admin/db-metrics/index-usage
 * Get index usage statistics
 */
router.get("/index-usage", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const result = await db.execute(sql`
        SELECT 
            schemaname,
            tablename,
            indexname,
            idx_scan as scans,
            idx_tup_read as tuples_read,
            idx_tup_fetch as tuples_fetched,
            pg_size_pretty(pg_relation_size(indexrelid::regclass)) as index_size,
            CASE 
                WHEN idx_scan = 0 THEN 'UNUSED - Consider dropping'
                WHEN idx_scan < 100 THEN 'Rarely used'
                ELSE 'Active'
            END as status
        FROM pg_stat_user_indexes
        ORDER BY idx_scan DESC
        LIMIT 100
    `);

    // Find unused indexes
    const unusedIndexes = (result.rows as any[]).filter((r: any) => r.scans === 0 || r.scans === '0');

    res.json({
        generatedAt: new Date().toISOString(),
        indexes: result.rows,
        unusedCount: unusedIndexes.length,
        recommendation: unusedIndexes.length > 5
            ? `${unusedIndexes.length} unused indexes found - consider dropping to improve write performance`
            : null,
    });
}));

// ============================================================================
// SLOW QUERY LOG
// ============================================================================

/**
 * GET /api/admin/db-metrics/slow-queries
 * Get PostgreSQL slow query statistics (requires pg_stat_statements)
 */
router.get("/slow-queries", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    try {
        const result = await db.execute(sql`
            SELECT 
                substring(query, 1, 200) as query_preview,
                calls,
                round(total_exec_time::numeric, 2) as total_time_ms,
                round(mean_exec_time::numeric, 2) as avg_time_ms,
                round(max_exec_time::numeric, 2) as max_time_ms,
                rows,
                round((100 * total_exec_time / sum(total_exec_time) OVER())::numeric, 2) as percent_total
            FROM pg_stat_statements
            WHERE userid = (SELECT usesysid FROM pg_user WHERE usename = current_user)
            ORDER BY mean_exec_time DESC
            LIMIT 20
        `);

        res.json({
            generatedAt: new Date().toISOString(),
            slowQueries: result.rows,
        });
    } catch (error: any) {
        // pg_stat_statements might not be enabled
        if (error.message.includes("pg_stat_statements")) {
            res.json({
                generatedAt: new Date().toISOString(),
                error: "pg_stat_statements extension not enabled",
                howToEnable: "Run: CREATE EXTENSION pg_stat_statements; (requires superuser)",
                slowQueries: [],
            });
        } else {
            throw error;
        }
    }
}));

// ============================================================================
// CONNECTION METRICS
// ============================================================================

/**
 * GET /api/admin/db-metrics/connections
 * Get database connection statistics
 */
router.get("/connections", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const result = await db.execute(sql`
        SELECT 
            datname as database,
            count(*) as total_connections,
            count(*) FILTER (WHERE state = 'active') as active,
            count(*) FILTER (WHERE state = 'idle') as idle,
            count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
            max(EXTRACT(EPOCH FROM (now() - backend_start))) as oldest_connection_seconds
        FROM pg_stat_activity
        WHERE datname = current_database()
        GROUP BY datname
    `);

    const maxConnections = await db.execute(sql`SHOW max_connections`);

    res.json({
        generatedAt: new Date().toISOString(),
        maxConnections: parseInt((maxConnections.rows[0] as any)?.max_connections || "100"),
        current: result.rows[0] || {},
        recommendation: null,
    });
}));

// ============================================================================
// FULL REPORT
// ============================================================================

/**
 * GET /api/admin/db-metrics/report
 * Get comprehensive database metrics report
 */
router.get("/report", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    // Gather all metrics
    const [tableSizes, indexUsage, connections] = await Promise.all([
        db.execute(sql`
            SELECT tablename, pg_total_relation_size('public.' || tablename) as size_bytes,
                   (SELECT reltuples::bigint FROM pg_class WHERE relname = tablename) as rows
            FROM pg_tables WHERE schemaname = 'public'
            ORDER BY size_bytes DESC LIMIT 10
        `),
        db.execute(sql`
            SELECT indexname, idx_scan as scans
            FROM pg_stat_user_indexes
            WHERE idx_scan = 0
        `),
        db.execute(sql`
            SELECT count(*) as total, count(*) FILTER (WHERE state = 'active') as active
            FROM pg_stat_activity WHERE datname = current_database()
        `),
    ]);

    const queryReport = queryMonitor.getReport();

    // Generate summary recommendations
    const recommendations: string[] = [...queryReport.recommendations];

    const unusedIndexCount = (indexUsage.rows as any[]).length;
    if (unusedIndexCount > 5) {
        recommendations.push(`${unusedIndexCount} unused indexes - consider dropping`);
    }

    const largestTable = (tableSizes.rows as any[])[0];
    if (largestTable && largestTable.size_bytes > 1024 * 1024 * 1024) {
        recommendations.push(
            `Table "${largestTable.tablename}" is ${(largestTable.size_bytes / 1024 / 1024 / 1024).toFixed(1)}GB - consider partitioning`
        );
    }

    res.json({
        generatedAt: new Date().toISOString(),
        summary: {
            totalQueries: queryReport.totalQueries,
            slowQueries: queryReport.slowQueries,
            errorRate: queryReport.errorRate,
            topTables: tableSizes.rows,
            unusedIndexes: unusedIndexCount,
            activeConnections: (connections.rows[0] as any)?.active || 0,
        },
        recommendations,
        details: {
            queryReport,
        },
    });
}));

export default router;

