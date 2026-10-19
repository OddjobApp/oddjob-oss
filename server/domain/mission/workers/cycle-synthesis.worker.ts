/**
 * Cycle Synthesis Worker
 *
 * Purpose: Async synthesis of operational cycles
 * Triggers: On cycle launch, blueprint updates
 * Performance: Move 3-5s synthesis off critical path
 */

import { Job } from 'bull';
import { createLogger } from '@server/utils/logger.js';
import { db } from '@server/database_service.js';
import { operationalCycles, cycleBlueprints } from '@shared/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { cycleDagService } from '../core/cycle-dag.service.js';
import { cycleDataflowService } from '../core/cycle-dataflow.service.js';

const logger = createLogger('CycleSynthesisWorker');

export interface CycleSynthesisJobData {
    cycleId: number;
    organizationId: number;
    blueprints?: any[];
    resynthesisReason?: string;
}

/**
 * Process cycle synthesis job
 */
export async function processCycleSynthesis(job: Job<CycleSynthesisJobData>): Promise<{
    success: boolean;
    cycleId: number;
    blueprintCount: number;
    synthesisTime: number;
    error?: string;
}> {
    const startTime = Date.now();
    const { cycleId, organizationId, blueprints, resynthesisReason } = job.data;

    try {
        logger.info(`Starting cycle synthesis`, {
            cycleId,
            organizationId,
            blueprintCount: blueprints?.length,
            reason: resynthesisReason,
        });

        // Fetch cycle
        const [cycle] = await db.select()
            .from(operationalCycles)
            .where(and(
                eq(operationalCycles.id, cycleId),
                eq(operationalCycles.organizationId, organizationId)
            ));

        if (!cycle) {
            throw new Error(`Cycle ${cycleId} not found`);
        }

        // Get blueprints (either from job data or from database)
        let blueprintData = blueprints;
        if (!blueprintData) {
            const dbBlueprints = await db.select()
                .from(cycleBlueprints)
                .where(eq(cycleBlueprints.cycleId, cycleId));

            blueprintData = dbBlueprints.map(bp => ({
                name: bp.name,
                objective: bp.objective,
                dependencies: JSON.parse(bp.dependencies as any) || [],
                metadata: bp.metadata,
            }));
        }

        // Step 1: DAG validation (5-10% of time)
        job.progress(5);

        const dagBlueprints = blueprintData
            .filter((b: any) => b.name)
            .map((bp: any) => ({
                name: bp.name,
                dependencies: cycleDagService.normalizeManifestMission(bp),
            }));

        const dagReport = cycleDagService.validateDag(dagBlueprints);
        if (dagReport.errors.length > 0) {
            throw new Error(`DAG validation failed: ${dagReport.errors.join('; ')}`);
        }

        logger.debug(`DAG validation passed`, { cycleId, blueprintCount: dagBlueprints.length });

        // Step 2: Data flow contract validation (10-15% of time)
        job.progress(15);

        const dataFlowReport = cycleDataflowService.validateDataFlowContracts(blueprintData);
        if (dataFlowReport.errors.length > 0) {
            throw new Error(`Data flow validation failed: ${dataFlowReport.errors.join('; ')}`);
        }

        logger.debug(`Data flow validation passed`, { cycleId });

        // Step 3: Topological sort and dependency ordering (20-30% of time)
        job.progress(30);

        const sortedNames = dagReport.waves.flat();

        logger.debug(`Topological sort complete`, { cycleId, blueprintCount: sortedNames.length });

        // Step 4: Blueprint synthesis and enrichment (40-60% of time)
        job.progress(40);

        const synthesizedMetadata = {
            ...cycle.metadata || {},
            synthesis: {
                status: 'synthesized',
                synthesizedAt: new Date().toISOString(),
                blueprintOrder: sortedNames,
                validationReport: {
                    dagErrors: dagReport.errors,
                    dagWarnings: dagReport.warnings,
                    dataFlowErrors: dataFlowReport.errors,
                    dataFlowWarnings: dataFlowReport.warnings,
                },
            },
        };

        // Step 5: Store synthesized metadata (60-90% of time)
        job.progress(60);

        await db.update(operationalCycles)
            .set({
                metadata: synthesizedMetadata,
                updatedAt: new Date(),
            })
            .where(eq(operationalCycles.id, cycleId));

        logger.debug(`Synthesis metadata stored`, { cycleId });

        // Step 6: Clear related caches (90-95% of time)
        job.progress(90);

        // Import cache service locally to avoid circular deps
        const { cacheService } = await import('@domain/cache/cache.service.js');
        await cacheService.invalidate(`cycle:metadata:${cycleId}`);
        await cacheService.invalidateByTag(`org:${organizationId}`);

        job.progress(95);

        const synthesisTime = Date.now() - startTime;
        logger.info(`Cycle synthesis complete`, {
            cycleId,
            blueprintCount: blueprintData.length,
            synthesisTime,
            dagErrors: dagReport.errors.length,
            dataFlowErrors: dataFlowReport.errors.length,
        });

        job.progress(100);

        return {
            success: true,
            cycleId,
            blueprintCount: blueprintData.length,
            synthesisTime,
        };
    } catch (error: any) {
        logger.error(`Cycle synthesis failed`, {
            cycleId,
            organizationId,
            error: error.message,
            stack: error.stack,
        });

        throw error;
    }
}

/**
 * Register cycle synthesis worker
 */
export async function registerCycleSynthesisWorker(): Promise<void> {
    const { queueService } = await import('../../queue/queue.service.js');

    await queueService.processQueue(
        'cycle-synthesis',
        processCycleSynthesis,
        3 // Process 3 cycles in parallel
    );

    logger.info('Cycle synthesis worker registered');
}
