import { ActionHandler, ActionContext, ConcludeDecision } from "./action-handler.js";
import { db } from "@server/database_service.js";
import { missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { strategyMLService } from "../../../agents/core/ml-strategy-predictor/strategy-ml.service.js";
import { missionService } from "../mission.service.js";
import { missionRunService } from "../mission-run.service.js";
import { skillSynthesisService } from "../skill-synthesis.service.js";
import { logSourcePerformance, trainBranchWeights } from "./helpers.js";

const logger = createLogger("ConcludeHandler");

export class ConcludeHandler implements ActionHandler {
    async execute(ctx: ActionContext, decision: ConcludeDecision): Promise<void> {
        const { missionRunId, missionContext, objective, userId, orgId, mlPredictedStrategy, mlCycleStartMs, appendTrace } = ctx;
        
        const product = decision.action_details?.final_product || decision.thought_process || "Mission objective achieved.";
        
        // Completed, not parked in "waiting_on_human": that deliverable review was never
        // requested (no approval, no notification), so concluded runs never finished.
        // The terminal hooks complete the mission and notify for review instead.
        await missionRunService.update(missionRunId, {
            status: "completed",
            isSuccess: true,
            missionContext: { ...missionContext, result: product }
        });

        // --- FEATURE 3: ML FEEDBACK — record successful strategy outcome ---
        try {
            const taskFeatures = {
                description: missionContext?.intent || objective || "",
                complexity: "medium" as const,
                domain: "autonomous_mission",
                hasStructuredData: Object.keys((missionContext?.blackboard as any) || {}).length > 3,
                requiresCreativity: false,
                hasTimeConstraint: false,
                expectedSteps: missionContext?.cycleCount || 1,
                riskLevel: "medium" as const,
                novelty: "familiar" as const,
                wordCount: (missionContext?.intent || "").split(" ").length,
                questionCount: 0,
                keywordDensity: {},
            };
            await strategyMLService.recordPerformance({
                strategy: mlPredictedStrategy as any,
                taskFeatures,
                success: true,
                qualityScore: 85,
                executionTimeMs: Date.now() - mlCycleStartMs,
                tokenUsage: 0,
                correctionCount: 0,
                agentId: `mission-run-${missionRunId}`,
                organizationId: (orgId as any),
            });
        } catch (mlFbErr: any) {
            logger.warn(`[ConcludeHandler] ML feedback write failed: ${mlFbErr.message}`);
        }

        // --- ADAPTIVE PREDICTION: Log source performance ---
        // Note: We need the mission type here. In the original code it used `mission.type`.
        // We can fetch the mission or pass it in context. Let's fetch it to be safe,
        // or assume it's "autonomous_mission" if not available.
        // Let's fetch the mission to be accurate.
        const [mission] = await db.select().from(missions).where(eq(missions.id, ctx.missionId)).limit(1);
        const missionType = mission?.type || "autonomous_mission";

        await logSourcePerformance(missionContext, missionType, orgId, true, logger);

        // --- ADAPTIVE PREDICTION: Train model weights (async, non-blocking) ---
        trainBranchWeights(ctx.missionId, missionContext, logger).catch(e =>
            logger.warn(`[ConcludeHandler] Weight training failed: ${e.message}`)
        );

        // --- AGENT SKILL SYNTHESIS: Synthesize skill from successful trace ---
        try {
            skillSynthesisService.synthesizeSkillFromMission(missionRunId)
                .then(res => {
                    if (res.success) {
                        logger.info(`[ConcludeHandler] Successfully synthesized skill ${res.skillId} from run ${missionRunId}`);
                    } else {
                        logger.warn(`[ConcludeHandler] Skill synthesis skipped: ${res.error}`);
                    }
                })
                .catch(e => logger.error(`[ConcludeHandler] Skill synthesis failed: ${e.message}`));
        } catch (synthErr: any) {
            logger.warn(`[ConcludeHandler] Failed to call SkillSynthesisService: ${synthErr.message}`);
        }

        // --- SYNC TO BLACKBOARD DELIVERABLES ---
        try {
            const eb = (mission?.blackboard as any)?.expected_deliverables;
            if (Array.isArray(eb) && eb.length > 0) {
                const updates: Record<string, any> = {};
                for (const d of eb) {
                    const slug = String(d).toLowerCase().replace(/\s+/g, '_');
                    updates[slug] = product;
                }
                await missionService.updateBlackboard(ctx.missionId, updates, "agent:orchestrator", "conclude_sync");
            }
        } catch (syncErr) {
            logger.warn(`Failed to sync final product to blackboard: ${syncErr}`);
        }

        await appendTrace(missionRunId, { 
            type: "system", 
            event: "mission_concluded",
            note: `MISSION PRODUCT:\n\n${product}`,
            timestamp: new Date().toISOString() 
        });
    }
}
