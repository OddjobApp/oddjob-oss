import { ActionHandler, ActionContext, FailDecision } from "./action-handler.js";
import { db } from "@server/database_service.js";
import { missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { strategyMLService } from "../../../agents/core/ml-strategy-predictor/strategy-ml.service.js";
import { missionRunService } from "../mission-run.service.js";
import { logSourcePerformance } from "./helpers.js";

const logger = createLogger("FailHandler");

export class FailHandler implements ActionHandler {
    async execute(ctx: ActionContext, decision: FailDecision): Promise<void> {
        const { missionRunId, missionContext, objective, orgId, mlPredictedStrategy, mlCycleStartMs, appendTrace } = ctx;

        await missionRunService.update(missionRunId, { status: "failed" });
        await appendTrace(missionRunId, { type: "error", event: "mission_failed", note: "Mission marked as failed by Orchestrator.", timestamp: new Date().toISOString() });

        // Fetch mission to get objective and type if needed
        const [mission] = await db.select().from(missions).where(eq(missions.id, ctx.missionId)).limit(1);
        const missionObjective = mission?.objective || objective;
        const missionType = mission?.type || "autonomous_mission";

        // --- FEATURE 3: ML FEEDBACK â€” record failed strategy outcome ---
        try {
            await strategyMLService.recordPerformance({
                strategy: mlPredictedStrategy as any,
                taskFeatures: {
                    description: missionContext?.intent || missionObjective || "",
                    complexity: "medium" as const,
                    domain: "autonomous_mission",
                    hasStructuredData: false,
                    requiresCreativity: false,
                    hasTimeConstraint: false,
                    expectedSteps: missionContext?.cycleCount || 1,
                    riskLevel: "high" as const,
                    novelty: "familiar" as const,
                    wordCount: (missionContext?.intent || "").split(" ").length,
                    questionCount: 0,
                    keywordDensity: {},
                },
                success: false,
                qualityScore: 0,
                executionTimeMs: Date.now() - mlCycleStartMs,
                tokenUsage: 0,
                correctionCount: missionContext?.cycleCount || 0,
                agentId: `mission-run-${missionRunId}`,
                organizationId: (orgId as any),
            });
        } catch (mlFbErr: any) {
            logger.warn(`[FailHandler] ML feedback (fail) write failed: ${mlFbErr.message}`);
        }

        // --- ADAPTIVE PREDICTION: Log source performance ---
        await logSourcePerformance(missionContext, missionType, orgId, false, logger);

        // Crisis Orchestration is now handled centrally by MissionLifecycleHooks
    }
}
