/**
 * Self-Assessment Hook
 * 
 * Runs after coding steps complete to verify the agent's output
 * against the acceptance criteria from the implementation plan.
 * 
 * Only triggers for steps that:
 * 1. Are successful
 * 2. Belong to a mission with an implementation plan on the blackboard
 * 3. Are coding-related (write_frontend_code, write_backend_code, etc.)
 */

import { ExecutionHook, HookParams } from "./execution-hooks.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("SelfAssessmentHook");

// Step actions that should trigger self-assessment
const CODING_ACTIONS = new Set([
    "write_frontend_code",
    "write_backend_code",
    "write_code",
    "implement",
    "generate_code",
]);

export class SelfAssessmentHook implements ExecutionHook {
    name = "SelfAssessmentHook";

    async onStepComplete(params: HookParams): Promise<void> {
        const { result, currentStep, pipelineExecution, context, orgId } = params;

        // Only assess successful coding steps
        if (!result?.success) return;
        
        const stepArgs = (currentStep.toolArguments || {}) as any;
        const action = stepArgs.action || "";
        
        // Check if this is a coding step
        if (!CODING_ACTIONS.has(action) && !action.includes("code") && !action.includes("implement")) {
            return;
        }

        // Check if there's a mission with acceptance criteria
        if (!pipelineExecution?.missionId) return;

        try {
            const { db } = await import("@server/database_service.js");
            const { missions } = await import("@shared/schema/index.js");
            const { eq } = await import("drizzle-orm");

            const [mission] = await db.select({ blackboard: missions.blackboard })
                .from(missions)
                .where(eq(missions.id, pipelineExecution.missionId))
                .limit(1);

            if (!mission) return;

            const blackboard = (mission.blackboard as any) || {};
            const implementationPlan = blackboard.implementation_plan;

            if (!implementationPlan) {
                logger.debug(`[SelfAssessment] No implementation plan on blackboard for mission ${pipelineExecution.missionId} — skipping assessment`);
                return;
            }

            // Extract acceptance criteria
            let criteria: string[] = [];
            if (typeof implementationPlan === "string") {
                // Try to extract criteria from the text
                const criteriaMatch = implementationPlan.match(/acceptance.criteria[:\s]*([\s\S]*?)(?=\n\n|\n#|$)/i);
                if (criteriaMatch) {
                    criteria = criteriaMatch[1].split("\n").filter(l => l.trim().startsWith("-") || l.trim().startsWith("*")).map(l => l.trim().replace(/^[-*]\s*/, ""));
                }
            } else if (typeof implementationPlan === "object") {
                criteria = implementationPlan.acceptance_criteria || implementationPlan.acceptanceCriteria || [];
            }

            if (criteria.length === 0) {
                logger.debug(`[SelfAssessment] No acceptance criteria found — skipping`);
                return;
            }

            // Run self-assessment
            const { agentSelfAssessmentService } = await import("@domain/agents/core/self-assessment.service.js");
            const assessment = await agentSelfAssessmentService.assess(
                result.output || "",
                criteria,
                {
                    stepCode: stepArgs.stepCode || `step_${currentStep.order}`,
                    objective: blackboard.intent || "",
                    orgId,
                }
            );

            // Write assessment result to blackboard
            const { missionService } = await import("@domain/mission/core/mission.service.js");
            await missionService.updateBlackboard(pipelineExecution.missionId, {
                [`_self_assessment_${stepArgs.stepCode || currentStep.order}`]: assessment,
                _lastAssessmentPassed: assessment.passed,
                _lastAssessmentScore: assessment.score,
            }, "self-assessment-hook");

            if (!assessment.passed) {
                logger.warn(`[SelfAssessment] Step ${stepArgs.stepCode} FAILED assessment (score: ${assessment.score}/100). Gaps: ${assessment.gaps.join(", ")}`);
            } else {
                logger.info(`[SelfAssessment] Step ${stepArgs.stepCode} passed assessment (score: ${assessment.score}/100)`);
            }
        } catch (err: any) {
            // Self-assessment is non-blocking — log and continue
            logger.warn(`[SelfAssessment] Hook failed (non-fatal): ${err.message}`);
        }
    }
}
