/**
 * Query Performance Monitor
 * 
 * Tracks database query performance to identify:
 * - Slow queries that might benefit from caching or NoSQL
 * - High-volume tables that might need different storage
 * - Query patterns for optimization opportunities
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("QueryMonitor");

// Configuration
const SLOW_QUERY_THRESHOLD_MS = parseInt(process.env.SLOW_QUERY_THRESHOLD_MS || "100", 10);
const METRICS_RETENTION_MS = 60 * 60 * 1000; // 1 hour
const SAMPLE_RATE = parseFloat(process.env.QUERY_SAMPLE_RATE || "1.0"); // 1.0 = 100%

// ============================================================================
// TYPES
// ============================================================================

export interface QueryMetric {
    name: string;
    table?: string;
    operation?: "select" | "insert" | "update" | "delete";
    durationMs: number;
    timestamp: number;
    rowCount?: number;
    success: boolean;
    error?: string;
}

export interface QueryStats {
    name: string;
    count: number;
    totalDurationMs: number;
    avgDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    errorCount: number;
    errorRate: number;
    slowQueryCount: number;
}

export interface TableStats {
    table: string;
    selectCount: number;
    insertCount: number;
    updateCount: number;
    deleteCount: number;
    avgSelectMs: number;
    avgInsertMs: number;
    avgUpdateMs: number;
    avgDeleteMs: number;
    recommendedStorage?: string;
}

export interface PerformanceReport {
    generatedAt: string;
    periodMs: number;
    totalQueries: number;
    slowQueries: number;
    errorRate: number;
    topSlowQueries: QueryStats[];
    topHighVolumeQueries: QueryStats[];
    tableStats: TableStats[];
    recommendations: string[];
}

// ============================================================================
// QUERY MONITOR CLASS
// ============================================================================

class QueryPerformanceMonitor {
    private metrics: QueryMetric[] = [];
    private lastCleanup = Date.now();

    /**
     * Record a query metric
     */
    record(metric: QueryMetric): void {
        // Sample rate check
        if (Math.random() > SAMPLE_RATE) {
            return;
        }

        this.metrics.push(metric);

        // Log slow queries
        if (metric.durationMs >= SLOW_QUERY_THRESHOLD_MS) {
            logger.warn("Slow query detected", {
                name: metric.name,
                table: metric.table,
                durationMs: metric.durationMs,
                threshold: SLOW_QUERY_THRESHOLD_MS,
            });
        }

        // Periodic cleanup
        if (Date.now() - this.lastCleanup > METRICS_RETENTION_MS / 2) {
            this.cleanup();
        }
    }

    /**
     * Clean up old metrics
     */
    private cleanup(): void {
        const cutoff = Date.now() - METRICS_RETENTION_MS;
        this.metrics = this.metrics.filter(m => m.timestamp > cutoff);
        this.lastCleanup = Date.now();
    }

    /**
     * Calculate percentile
     */
    private percentile(values: number[], p: number): number {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.ceil((p / 100) * sorted.length) - 1;
        return sorted[Math.max(0, idx)];
    }

    /**
     * Get query statistics
     */
    private getQueryStats(queryName: string): QueryStats {
        const queryMetrics = this.metrics.filter(m => m.name === queryName);
        const durations = queryMetrics.map(m => m.durationMs);
        const errors = queryMetrics.filter(m => !m.success);
        const slow = queryMetrics.filter(m => m.durationMs >= SLOW_QUERY_THRESHOLD_MS);

        return {
            name: queryName,
            count: queryMetrics.length,
            totalDurationMs: durations.reduce((a, b) => a + b, 0),
            avgDurationMs: durations.length > 0
                ? durations.reduce((a, b) => a + b, 0) / durations.length
                : 0,
            minDurationMs: Math.min(...durations, 0),
            maxDurationMs: Math.max(...durations, 0),
            p50Ms: this.percentile(durations, 50),
            p95Ms: this.percentile(durations, 95),
            p99Ms: this.percentile(durations, 99),
            errorCount: errors.length,
            errorRate: queryMetrics.length > 0 ? errors.length / queryMetrics.length : 0,
            slowQueryCount: slow.length,
        };
    }

    /**
     * Get table statistics
     */
    private getTableStats(): TableStats[] {
        const tables = new Map<string, QueryMetric[]>();

        for (const metric of this.metrics) {
            if (metric.table) {
                if (!tables.has(metric.table)) {
                    tables.set(metric.table, []);
                }
                tables.get(metric.table)!.push(metric);
            }
        }

        return Array.from(tables.entries()).map(([table, metrics]) => {
            const selects = metrics.filter(m => m.operation === "select");
            const inserts = metrics.filter(m => m.operation === "insert");
            const updates = metrics.filter(m => m.operation === "update");
            const deletes = metrics.filter(m => m.operation === "delete");

            const avgMs = (arr: QueryMetric[]) =>
                arr.length > 0 ? arr.reduce((a, m) => a + m.durationMs, 0) / arr.length : 0;

            // Recommend storage based on patterns
            let recommendedStorage: string | undefined;
            const writeRatio = (inserts.length + updates.length) / (selects.length || 1);
            const avgSelectMs = avgMs(selects);

            if (writeRatio > 10 && inserts.length > 1000) {
                recommendedStorage = "Consider ClickHouse/TimescaleDB for high write volume";
            } else if (avgSelectMs > 500 && selects.length > 100) {
                recommendedStorage = "Consider caching or read replicas for slow selects";
            } else if (table.includes("graph") && selects.length > 500) {
                recommendedStorage = "Consider Neo4j for graph-heavy workloads";
            }

            return {
                table,
                selectCount: selects.length,
                insertCount: inserts.length,
                updateCount: updates.length,
                deleteCount: deletes.length,
                avgSelectMs: avgMs(selects),
                avgInsertMs: avgMs(inserts),
                avgUpdateMs: avgMs(updates),
                avgDeleteMs: avgMs(deletes),
                recommendedStorage,
            };
        });
    }

    /**
     * Generate recommendations
     */
    private generateRecommendations(
        slowQueries: QueryStats[],
        tableStats: TableStats[]
    ): string[] {
        const recommendations: string[] = [];

        // Slow query recommendations
        for (const query of slowQueries.slice(0, 3)) {
            if (query.p95Ms > 500) {
                recommendations.push(
                    `Query "${query.name}" has p95 of ${query.p95Ms.toFixed(0)}ms - consider caching or query optimization`
                );
            }
        }

        // Table-specific recommendations
        for (const table of tableStats) {
            if (table.recommendedStorage) {
                recommendations.push(`${table.table}: ${table.recommendedStorage}`);
            }
        }

        // High error rate
        const errorQueries = slowQueries.filter(q => q.errorRate > 0.05);
        for (const query of errorQueries.slice(0, 2)) {
            recommendations.push(
                `Query "${query.name}" has ${(query.errorRate * 100).toFixed(1)}% error rate - investigate failures`
            );
        }

        return recommendations;
    }

    /**
     * Get full performance report
     */
    getReport(): PerformanceReport {
        const uniqueQueries = [...new Set(this.metrics.map(m => m.name))];
        const allStats = uniqueQueries.map(q => this.getQueryStats(q));
        const tableStats = this.getTableStats();

        const slowQueries = allStats
            .filter(s => s.slowQueryCount > 0)
            .sort((a, b) => b.p95Ms - a.p95Ms);

        const highVolumeQueries = allStats
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        const totalErrors = this.metrics.filter(m => !m.success).length;

        return {
            generatedAt: new Date().toISOString(),
            periodMs: METRICS_RETENTION_MS,
            totalQueries: this.metrics.length,
            slowQueries: this.metrics.filter(m => m.durationMs >= SLOW_QUERY_THRESHOLD_MS).length,
            errorRate: this.metrics.length > 0 ? totalErrors / this.metrics.length : 0,
            topSlowQueries: slowQueries.slice(0, 10),
            topHighVolumeQueries: highVolumeQueries,
            tableStats: tableStats.sort((a, b) =>
                (b.selectCount + b.insertCount) - (a.selectCount + a.insertCount)
            ),
            recommendations: this.generateRecommendations(slowQueries, tableStats),
        };
    }

    /**
     * Clear all metrics
     */
    clear(): void {
        this.metrics = [];
    }
}

// Singleton instance
export const queryMonitor = new QueryPerformanceMonitor();

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Wrap a database operation with performance tracking
 */
export async function withQueryTracking<T>(
    name: string,
    operation: () => Promise<T>,
    options?: {
        table?: string;
        operation?: QueryMetric["operation"];
    }
): Promise<T> {
    const start = performance.now();
    let success = true;
    let error: string | undefined;
    let result: T;

    try {
        result = await operation();
        return result;
    } catch (err: any) {
        success = false;
        error = err.message;
        throw err;
    } finally {
        const durationMs = performance.now() - start;

        queryMonitor.record({
            name,
            table: options?.table,
            operation: options?.operation,
            durationMs,
            timestamp: Date.now(),
            success,
            error,
        });
    }
}

/**
 * Create a tracked version of db operations
 */
export function createTrackedDb(db: any) {
    return new Proxy(db, {
        get(target, prop) {
            const value = target[prop];

            if (prop === "select") {
                return (...args: any[]) => {
                    const query = value.call(target, ...args);
                    const originalFrom = query.from.bind(query);

                    query.from = (table: any) => {
                        const tableName = table?._.name || "unknown";
                        const result = originalFrom(table);

                        // Wrap the final execution
                        const originalThen = result.then?.bind(result);
                        if (originalThen) {
                            result.then = (resolve: any, reject: any) => {
                                return withQueryTracking(
                                    `select:${tableName}`,
                                    () => originalThen(resolve, reject),
                                    { table: tableName, operation: "select" }
                                );
                            };
                        }
                        return result;
                    };
                    return query;
                };
            }

            return value;
        },
    });
}




