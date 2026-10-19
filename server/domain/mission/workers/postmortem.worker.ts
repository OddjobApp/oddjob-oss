/**
 * Postmortem Analysis Worker
 *
 * Purpose: Async analysis of cycle failures and incidents
 * Triggers: On cycle failure, mission completion with errors
 * Performance: Move 10-20s analysis off critical path
 */

import { Job } from 'bull';
import { createLogger } from '@server/utils/logger.js';
import { db } from '@server/database_service.js';
import { operationalCycles, missionRuns } from '@shared/schema/index.js';
import { eq, and, inArray } from 'drizzle-orm';

const logger = createLogger('PostmortemWorker');

export interface PostmortemJobData {
    cycleId: number;
    organizationId: number;
    failureType: 'mission_failure' | 'timeout' | 'resource_exhaustion' | 'dependency_failure' | 'user_abort';
    errorMessage?: string;
    failedMissionIds?: number[];
}

/**
 * Root cause analysis result
 */
interface RootCauseAnalysis {
    primaryCause: string;
    contributingFactors: string[];
    affectedMissions: number[];
    severity: 'low' | 'medium' | 'high' | 'critical';
    recommendations: string[];
}

/**
 * Perform root cause analysis
 */
async function analyzeRootCause(
    cycleId: number,
    failureType: string,
    errorMessage?: string,
    failedMissionIds?: number[]
): Promise<RootCauseAnalysis> {
    // Fetch failed missions for analysis
    const missions = failedMissionIds && failedMissionIds.length > 0
        ? await db.select()
            .from(missionRuns)
            .where(inArray(missionRuns.id, failedMissionIds))
        : [];

    // Analyze error patterns
    const errorPatterns = new Map<string, number>();
    for (const mission of missions) {
        const error = mission.failureReason || 'unknown';
        errorPatterns.set(error, (errorPatterns.get(error) || 0) + 1);
    }

    // Determine primary cause
    let primaryCause = 'Unknown cause';
    let severity: 'low' | 'medium' | 'high' | 'critical' = 'medium';

    switch (failureType) {
        case 'mission_failure':
            primaryCause = 'One or more mission runs failed';
            severity = 'high';
            break;
        case 'timeout':
            primaryCause = 'Cycle execution timeout exceeded';
            severity = 'high';
            break;
        case 'resource_exhaustion':
            primaryCause = 'Resource limits exceeded (CPU, memory, or disk)';
            severity = 'critical';
            break;
        case 'dependency_failure':
            primaryCause = 'Upstream dependency or external service failure';
            severity = 'high';
            break;
        case 'user_abort':
            primaryCause = 'Cycle aborted by user';
            severity = 'low';
            break;
    }

    // Identify contributing factors
    const contributingFactors: string[] = [];
    if (errorMessage) {
        if (errorMessage.includes('timeout')) contributingFactors.push('Slow execution');
        if (errorMessage.includes('memory')) contributingFactors.push('Memory constraint');
        if (errorMessage.includes('connection')) contributingFactors.push('Connection issue');
        if (errorMessage.includes('permission')) contributingFactors.push('Permission denied');
        if (errorMessage.includes('not found')) contributingFactors.push('Missing resource');
    }

    // Generate recommendations
    const recommendations: string[] = [];
    if (failureType === 'timeout') {
        recommendations.push('Increase execution timeout or optimize mission performance');
        recommendations.push('Consider breaking long-running missions into smaller steps');
    }
    if (failureType === 'resource_exhaustion') {
        recommendations.push('Allocate more resources or optimize mission resource usage');
        recommendations.push('Consider running missions sequentially instead of parallel');
    }
    if (failureType === 'dependency_failure') {
        recommendations.push('Verify external service availability');
        recommendations.push('Implement retry logic for external calls');
    }
    if (missions.length > 0) {
        recommendations.push(`Review logs for failed missions: ${failedMissionIds?.join(', ')}`);
    }

    return {
        primaryCause,
        contributingFactors,
        affectedMissions: failedMissionIds || [],
        severity,
        recommendations,
    };
}

/**
 * Generate postmortem report
 */
async function generatePostmortemReport(
    cycleId: number,
    analysis: RootCauseAnalysis
): Promise<Record<string, any>> {
    const [cycle] = await db.select()
        .from(operationalCycles)
        .where(eq(operationalCycles.id, cycleId));

    if (!cycle) {
        throw new Error(`Cycle ${cycleId} not found`);
    }

    // Calculate failure metrics
    const missionRunRows = await db.select()
        .from(missionRuns)
        .where(eq(missionRuns.cycleId, cycleId));

    const failedCount = missionRunRows.filter(m => m.status === 'failed').length;
    const totalDuration = cycle.updatedAt && cycle.createdAt
        ? cycle.updatedAt.getTime() - cycle.createdAt.getTime()
        : 0;

    return {
        cycleId,
        status: cycle.status,
        startTime: cycle.createdAt?.toISOString(),
        endTime: cycle.updatedAt?.toISOString(),
        durationMs: totalDuration,
        totalMissions: missionRunRows.length,
        failedMissions: failedCount,
        successRate: ((missionRunRows.length - failedCount) / missionRunRows.length * 100).toFixed(1),
        rootCauseAnalysis: analysis,
        reportGeneratedAt: new Date().toISOString(),
    };
}

/**
 * Process postmortem analysis job
 */
export async function processPostmortemAnalysis(
    job: Job<PostmortemJobData>
): Promise<{
    success: boolean;
    cycleId: number;
    reportUrl?: string;
}> {
    const {
        cycleId,
        organizationId,
        failureType,
        errorMessage,
        failedMissionIds,
    } = job.data;

    try {
        logger.info(`Starting postmortem analysis`, {
            cycleId,
            organizationId,
            failureType,
            missionCount: failedMissionIds?.length || 0,
        });

        job.progress(10);

        // Perform root cause analysis
        logger.debug(`Analyzing root cause`, { cycleId, failureType });
        const analysis = await analyzeRootCause(
            cycleId,
            failureType,
            errorMessage,
            failedMissionIds
        );

        job.progress(40);

        // Generate detailed report
        logger.debug(`Generating postmortem report`, { cycleId });
        const report = await generatePostmortemReport(cycleId, analysis);

        job.progress(70);

        // Store report in cycle metadata
        const [cycle] = await db.select()
            .from(operationalCycles)
            .where(eq(operationalCycles.id, cycleId));

        const updatedMetadata = {
            ...(cycle?.metadata || {}),
            postmortem: report,
        };

        await db.update(operationalCycles)
            .set({
                metadata: updatedMetadata,
                updatedAt: new Date(),
            })
            .where(eq(operationalCycles.id, cycleId));

        logger.debug(`Postmortem report stored`, { cycleId });

        job.progress(90);

        // Invalidate cache
        const { cacheService } = await import('@domain/cache/cache.service.js');
        await cacheService.invalidate(`cycle:metadata:${cycleId}`);

        logger.info(`Postmortem analysis complete`, {
            cycleId,
            severity: analysis.severity,
            affectedMissions: analysis.affectedMissions.length,
        });

        job.progress(100);

        return {
            success: true,
            cycleId,
            reportUrl: `/api/cycles/${cycleId}/postmortem`,
        };
    } catch (error: any) {
        logger.error(`Postmortem analysis failed`, {
            cycleId,
            organizationId,
            error: error.message,
            stack: error.stack,
        });

        throw error;
    }
}

/**
 * Register postmortem analysis worker
 */
export async function registerPostmortemWorker(): Promise<void> {
    const { queueService } = await import('@domain/queue/queue.service.js');

    await queueService.processQueue(
        'postmortem-analysis',
        processPostmortemAnalysis,
        2 // Process 2 postmortems in parallel (less CPU intensive)
    );

    logger.info('Postmortem analysis worker registered');
}
