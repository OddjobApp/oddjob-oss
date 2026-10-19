/**
 * Analytics Aggregation Worker
 *
 * Purpose: Async computation of metrics and dashboard data
 * Triggers: Hourly schedule, on significant events
 * Performance: Move 5-10s metric computation off critical path
 */

import { Job } from 'bull';
import { createLogger } from '@server/utils/logger.js';
import { db } from '@server/database_service.js';
import { operationalCycles, missionRuns, approvalRequests } from '@shared/schema/index.js';
import { eq, and, sql, gte, lt } from 'drizzle-orm';

const logger = createLogger('AnalyticsWorker');

export interface AnalyticsJobData {
    organizationId: number;
    aggregationType: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'realtime';
    timeRange?: {
        startTime: number;
        endTime: number;
    };
}

/**
 * Aggregated metrics
 */
interface AggregatedMetrics {
    period: string;
    organizationId: number;
    timestamp: string;

    // Cycle metrics
    cycles: {
        total: number;
        completed: number;
        failed: number;
        active: number;
        avgDurationMs: number;
        successRate: number;
    };

    // Mission metrics
    missions: {
        total: number;
        completed: number;
        failed: number;
        avgDurationMs: number;
        successRate: number;
    };

    // Approval metrics
    approvals: {
        total: number;
        approved: number;
        rejected: number;
        pending: number;
        avgTimeToApprovalMs: number;
        slaBreachCount: number;
    };

    // Performance metrics
    performance: {
        avgCycleLatencyMs: number;
        p95CycleLatencyMs: number;
        p99CycleLatencyMs: number;
        throughputCyclesPerHour: number;
    };

    // Resource metrics
    resources: {
        totalJobsExecuted: number;
        failureRate: number;
        retryRate: number;
        avgJobDurationMs: number;
    };
}

/**
 * Compute cycle metrics
 */
async function computeCycleMetrics(
    organizationId: number,
    timeRange: { startTime: Date; endTime: Date }
): Promise<AggregatedMetrics['cycles']> {
    const cycles = await db.select({
        id: operationalCycles.id,
        status: operationalCycles.status,
        createdAt: operationalCycles.createdAt,
        updatedAt: operationalCycles.updatedAt,
    })
        .from(operationalCycles)
        .where(
            and(
                eq(operationalCycles.organizationId, organizationId),
                gte(operationalCycles.createdAt, timeRange.startTime),
                lt(operationalCycles.createdAt, timeRange.endTime)
            )
        );

    const completed = cycles.filter(c => c.status === 'completed').length;
    const failed = cycles.filter(c => c.status === 'failed' || c.status === 'cancelled').length;
    const active = cycles.filter(c => c.status === 'active' || c.status === 'running').length;

    // Clamped: rows whose updatedAt precedes createdAt (43 of them in the test
    // database alone) otherwise produce negative durations, which drag the average
    // below zero and make the metric meaningless. A duration cannot be negative.
    const durations = cycles
        .filter(c => c.updatedAt && c.createdAt)
        .map(c => Math.max(0, c.updatedAt!.getTime() - c.createdAt!.getTime()));

    const avgDurationMs = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    return {
        total: cycles.length,
        completed,
        failed,
        active,
        avgDurationMs,
        successRate: cycles.length > 0 ? (completed / cycles.length) * 100 : 0,
    };
}

/**
 * Compute mission metrics
 */
async function computeMissionMetrics(
    organizationId: number,
    timeRange: { startTime: Date; endTime: Date }
): Promise<AggregatedMetrics['missions']> {
    const missions = await db.select({
        id: missionRuns.id,
        status: missionRuns.status,
        createdAt: missionRuns.createdAt,
        updatedAt: missionRuns.updatedAt,
    })
        .from(missionRuns)
        .where(
            and(
                eq(missionRuns.organizationId, organizationId),
                gte(missionRuns.createdAt, timeRange.startTime),
                lt(missionRuns.createdAt, timeRange.endTime)
            )
        );

    const completed = missions.filter(m => m.status === 'completed').length;
    const failed = missions.filter(m => m.status === 'failed').length;

    // Clamped for the same reason as cycle durations above.
    const durations = missions
        .filter(m => m.updatedAt && m.createdAt)
        .map(m => Math.max(0, m.updatedAt!.getTime() - m.createdAt!.getTime()));

    const avgDurationMs = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    return {
        total: missions.length,
        completed,
        failed,
        avgDurationMs,
        successRate: missions.length > 0 ? (completed / missions.length) * 100 : 0,
    };
}

/**
 * Compute approval metrics
 */
async function computeApprovalMetrics(
    organizationId: number,
    timeRange: { startTime: Date; endTime: Date }
): Promise<AggregatedMetrics['approvals']> {
    const approvals = await db.select({
        id: approvalRequests.id,
        status: approvalRequests.status,
        createdAt: approvalRequests.createdAt,
        decisionAt: approvalRequests.decisionAt,
    })
        .from(approvalRequests)
        .where(
            and(
                eq(approvalRequests.organizationId, organizationId),
                gte(approvalRequests.createdAt, timeRange.startTime),
                lt(approvalRequests.createdAt, timeRange.endTime)
            )
        );

    const approved = approvals.filter(a => a.status === 'approved').length;
    const rejected = approvals.filter(a => a.status === 'rejected').length;
    const pending = approvals.filter(a => a.status === 'pending').length;

    const approvalTimes = approvals
        .filter(a => a.status === 'approved' && a.decisionAt && a.createdAt)
        .map(a => a.decisionAt!.getTime() - a.createdAt!.getTime());

    const avgTimeToApprovalMs = approvalTimes.length > 0
        ? Math.round(approvalTimes.reduce((a, b) => a + b, 0) / approvalTimes.length)
        : 0;

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const slaBreachCount = approvals.filter(
        a => a.status === 'pending' && a.createdAt < fiveMinutesAgo
    ).length;

    return {
        total: approvals.length,
        approved,
        rejected,
        pending,
        avgTimeToApprovalMs,
        slaBreachCount,
    };
}

/**
 * Compute performance metrics
 */
async function computePerformanceMetrics(
    organizationId: number,
    timeRange: { startTime: Date; endTime: Date }
): Promise<AggregatedMetrics['performance']> {
    const cycles = await db.select({
        createdAt: operationalCycles.createdAt,
        updatedAt: operationalCycles.updatedAt,
    })
        .from(operationalCycles)
        .where(
            and(
                eq(operationalCycles.organizationId, organizationId),
                gte(operationalCycles.createdAt, timeRange.startTime),
                lt(operationalCycles.createdAt, timeRange.endTime)
            )
        );

    // Clamped for the same reason as the duration metrics above: without it a row
    // whose updatedAt precedes createdAt yields a negative latency, which then
    // propagates into the average and the p95/p99 percentiles.
    const latencies = cycles
        .filter(c => c.updatedAt && c.createdAt)
        .map(c => Math.max(0, c.updatedAt!.getTime() - c.createdAt!.getTime()))
        .sort((a, b) => a - b);

    const avgLatency = latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;

    const p95Idx = Math.floor(latencies.length * 0.95);
    const p99Idx = Math.floor(latencies.length * 0.99);

    const durationHours = (timeRange.endTime.getTime() - timeRange.startTime.getTime()) / (1000 * 60 * 60);

    return {
        avgCycleLatencyMs: avgLatency,
        p95CycleLatencyMs: latencies[p95Idx] || 0,
        p99CycleLatencyMs: latencies[p99Idx] || 0,
        throughputCyclesPerHour: cycles.length / Math.max(durationHours, 1),
    };
}

/**
 * Compute resource metrics
 */
async function computeResourceMetrics(
    organizationId: number,
    timeRange: { startTime: Date; endTime: Date }
): Promise<AggregatedMetrics['resources']> {
    const missions = await db.select({
        status: missionRuns.status,
        createdAt: missionRuns.createdAt,
        updatedAt: missionRuns.updatedAt,
    })
        .from(missionRuns)
        .where(
            and(
                eq(missionRuns.organizationId, organizationId),
                gte(missionRuns.createdAt, timeRange.startTime),
                lt(missionRuns.createdAt, timeRange.endTime)
            )
        );

    const failed = missions.filter(m => m.status === 'failed').length;
    const durations = missions
        .filter(m => m.updatedAt && m.createdAt)
        .map(m => m.updatedAt!.getTime() - m.createdAt!.getTime());

    const avgDurationMs = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

    // Retry rate is estimated (would need actual retry tracking in jobs table)
    const estimatedRetryRate = failed > 0 ? Math.min(10, failed * 0.5) : 0;

    return {
        totalJobsExecuted: missions.length,
        failureRate: missions.length > 0 ? (failed / missions.length) * 100 : 0,
        retryRate: estimatedRetryRate,
        avgJobDurationMs: avgDurationMs,
    };
}

/**
 * Process analytics aggregation job
 */
export async function processAnalyticsAggregation(
    job: Job<AnalyticsJobData>
): Promise<{
    success: boolean;
    organizationId: number;
    metrics: AggregatedMetrics;
}> {
    const { organizationId, aggregationType, timeRange } = job.data;

    try {
        logger.info(`Starting analytics aggregation`, {
            organizationId,
            type: aggregationType,
        });

        job.progress(10);

        // Determine time range
        let finalTimeRange: { startTime: Date; endTime: Date };
        if (timeRange) {
            finalTimeRange = {
                startTime: new Date(timeRange.startTime),
                endTime: new Date(timeRange.endTime),
            };
        } else {
            const now = new Date();
            const startTime = new Date();

            switch (aggregationType) {
                case 'hourly':
                    startTime.setHours(startTime.getHours() - 1);
                    break;
                case 'daily':
                    startTime.setDate(startTime.getDate() - 1);
                    break;
                case 'weekly':
                    startTime.setDate(startTime.getDate() - 7);
                    break;
                case 'monthly':
                    startTime.setMonth(startTime.getMonth() - 1);
                    break;
                case 'realtime':
                    startTime.setMinutes(startTime.getMinutes() - 5);
                    break;
            }

            finalTimeRange = {
                startTime,
                endTime: now,
            };
        }

        job.progress(20);

        // Compute metrics
        logger.debug(`Computing cycle metrics`, { organizationId });
        const cycles = await computeCycleMetrics(organizationId, finalTimeRange);
        job.progress(35);

        logger.debug(`Computing mission metrics`, { organizationId });
        const missions = await computeMissionMetrics(organizationId, finalTimeRange);
        job.progress(50);

        logger.debug(`Computing approval metrics`, { organizationId });
        const approvals = await computeApprovalMetrics(organizationId, finalTimeRange);
        job.progress(65);

        logger.debug(`Computing performance metrics`, { organizationId });
        const performance = await computePerformanceMetrics(organizationId, finalTimeRange);
        job.progress(80);

        logger.debug(`Computing resource metrics`, { organizationId });
        const resources = await computeResourceMetrics(organizationId, finalTimeRange);
        job.progress(90);

        // Build metrics object
        const metrics: AggregatedMetrics = {
            period: aggregationType,
            organizationId,
            timestamp: new Date().toISOString(),
            cycles,
            missions,
            approvals,
            performance,
            resources,
        };

        logger.info(`Analytics aggregation complete`, {
            organizationId,
            type: aggregationType,
            cycleCount: cycles.total,
            missionCount: missions.total,
        });

        job.progress(100);

        return {
            success: true,
            organizationId,
            metrics,
        };
    } catch (error: any) {
        logger.error(`Analytics aggregation failed`, {
            organizationId,
            error: error.message,
            stack: error.stack,
        });

        throw error;
    }
}

/**
 * Register analytics worker
 */
export async function registerAnalyticsWorker(): Promise<void> {
    const { queueService } = await import('@domain/queue/queue.service.js');

    await queueService.processQueue(
        'analytics-aggregation',
        processAnalyticsAggregation,
        1 // Process 1 analytics job at a time
    );

    logger.info('Analytics aggregation worker registered');
}
