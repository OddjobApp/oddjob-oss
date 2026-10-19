import { Job } from "bullmq";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { BaseWorker } from "./base-worker.js";
import { db } from "@server/database_service.js";
import { missionRuns } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AuditWorker");

interface AuditJobData {
    missionRunId: number;
    options?: {
        force?: boolean;
        generateStories?: boolean;
    };
}

export class AuditWorker extends BaseWorker<AuditJobData, any> {
    constructor() {
        super(QUEUE_NAMES.AUDIT, {
            concurrency: parseInt(process.env.AUDIT_CONCURRENCY || "5", 10),
            lockDuration: 300000, // 5 minutes
        });
    }

    protected async execute(job: Job<AuditJobData>): Promise<any> {
        const { missionRunId, options } = job.data;
        logger.info(`[AuditWorker] Performing Forensic Analysis for Mission Run ${missionRunId}`);

        try {
            // 1. Fetch the mission run and its raw trace
            const [run] = await db.select()
                .from(missionRuns)
                .where(eq(missionRuns.id, missionRunId))
                .limit(1);

            if (!run) {
                throw new Error(`Mission Run ${missionRunId} not found`);
            }

            const rawTrace = (run.dynamicTrace as any[]) || [];
            
            // 2. Perform Trace Recomposition (Simulated for Now, logic would be complex)
            // In a real implementation, we'd call a MissionAnalystService
            const { missionAnalystService } = await import("@domain/mission/core/mission-analyst.service.js");
            const analysis = await missionAnalystService.analyzeTrace(missionRunId, rawTrace);

            // 3. Store Results back in the run metadata or a dedicated audit outcome table
            await db.update(missionRuns)
                .set({
                    // For now, we'll store the analysis summary in a specific context field
                    missionContext: {
                        ...(run.missionContext as Record<string, any>),
                        forensic_audit: analysis.summary,
                        root_cause_analysis: analysis.rootCause
                    },
                    updatedAt: new Date()
                })
                .where(eq(missionRuns.id, missionRunId));

            logger.info(`[AuditWorker] Audit complete for Run ${missionRunId}`);
            return { success: true, missionRunId, analysis };
        } catch (err: any) {
            logger.error(`[AuditWorker] Analysis failed for Run ${missionRunId}: ${err.message}`);
            throw err;
        }
    }
}

let workerInstance: AuditWorker | null = null;

export function startAuditWorker() {
    if (!workerInstance) {
        workerInstance = new AuditWorker();
    }
    return workerInstance;
}
