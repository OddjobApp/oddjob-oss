
import { db } from '../../server/database_service.js';
import { missionRuns } from '../../shared/schema/index.js';
import { eq, and, sql, gte, like } from 'drizzle-orm';
import { scheduleMissionWave } from '../../server/domain/mission/infrastructure/rolling-wave-queue.js';

async function resuscitate() {
    console.log("--- Oddjob Mission Resuscitator ---");
    
    const reapedMissions = await db.select()
        .from(missionRuns)
        .where(
            and(
                gte(missionRuns.id, 728),
                sql`id <= 732`
            )
        );

    console.log(`Found ${reapedMissions.length} reaped missions to resuscitate.`);

    for (const run of reapedMissions) {
        console.log(`Resuscitating Run ${run.id} (${(run.missionContext as any)?.executionStrategy})...`);
        
        await db.update(missionRuns)
            .set({
                status: 'active',
                failureReason: null,
                updatedAt: new Date()
            })
            .where(eq(missionRuns.id, run.id));

        // Re-schedule based on strategy
        const strategy = (run.missionContext as any)?.executionStrategy;
        const userId = run.createdBy || 'system';
        const orgId = run.organizationId ?? null;

        if (strategy === 'rolling_wave') {
            await scheduleMissionWave({ missionRunId: run.id, userId, orgId });
            console.log(`[OK] Re-queued in RollingWaveQueue.`);
        } else if (strategy === 'dynamic_autonomous' || (run.missionContext as any)?.isAutonomous) {
            const { queueMissionCycle } = await import('../../server/domain/mission/infrastructure/dynamic-mission-queue.js');
            await queueMissionCycle({ missionRunId: run.id, userId, orgId });
            console.log(`[OK] Re-queued in DynamicMissionQueue.`);
        } else if (strategy === 'reactive' || strategy === 'parallel_fan_out') {
            // For reactive/pre-planned, we might need to jumpstart the pipeline
            if (run.pipelineExecutionId) {
                const { pipelineExecutor } = await import('../../server/core/pipeline-executor.js');
                await pipelineExecutor.keepAlive(run.pipelineExecutionId);
                console.log(`[OK] Sent Keep-Alive to Pipeline ${run.pipelineExecutionId}.`);
            }
        } else {
            console.log(`[OK] Reset to active. Strategy ${strategy} might require manual pulse.`);
        }
    }
    
    console.log("Resuscitation complete.");
    process.exit(0);
}

resuscitate().catch(err => {
    console.error(err);
    process.exit(1);
});
