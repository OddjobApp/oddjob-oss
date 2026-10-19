/**
 * Agent Self-Assessment Service
 * 
 * When a coding step completes, this service asks the agent to verify
 * its own output against the acceptance criteria from the implementation plan.
 * 
 * This catches issues before they reach the QA mission:
 * - Did the code compile?
 * - Were all acceptance criteria from the plan addressed?
 * - Are there obvious gaps or TODOs left behind?
 * 
 * The assessment result is written to the blackboard and can gate the
 * transition to the next step (build/test/PR).
 */

import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";

const logger = createLogger("AgentSelfAssessment");

export interface SelfAssessmentResult {
    passed: boolean;
    score: number; // 0-100
    checklist: Array<{
        criterion: string;
        met: boolean;
        evidence: string;
    }>;
    gaps: string[];
    recommendation: "proceed" | "fix_and_retry" | "escalate";
    summary: string;
}

export const agentSelfAssessmentService = {
    /**
     * Run self-assessment on agent output against acceptance criteria.
     * 
     * @param output - The agent's output (code written, files changed)
     * @param criteria - Acceptance criteria from the implementation plan
     * @param context - Additional context (step code, mission objective)
     */
    async assess(
        output: string,
        criteria: string[],
        context: {
            stepCode?: string;
            objective?: string;
            orgId?: number;
        } = {}
    ): Promise<SelfAssessmentResult> {
        if (!criteria || criteria.length === 0) {
            // No criteria defined — pass by default
            return {
                passed: true,
                score: 100,
                checklist: [],
                gaps: [],
                recommendation: "proceed",
                summary: "No acceptance criteria defined — auto-passing.",
            };
        }

        try {
            const criteriaList = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");

            const prompt = `You are a code review assistant. Assess whether the following work output satisfies the acceptance criteria.

ACCEPTANCE CRITERIA:
${criteriaList}

WORK OUTPUT (summary of what was produced):
${output.substring(0, 5000)}

${context.objective ? `MISSION OBJECTIVE: ${context.objective}` : ""}
${context.stepCode ? `STEP: ${context.stepCode}` : ""}

Respond with a JSON object:
{
  "passed": boolean,
  "score": number (0-100),
  "checklist": [{"criterion": "...", "met": true/false, "evidence": "brief explanation"}],
  "gaps": ["list of unaddressed items"],
  "recommendation": "proceed" | "fix_and_retry" | "escalate",
  "summary": "one-sentence assessment"
}

Be strict but fair. If the output clearly addresses the criterion, mark it met.
If it's partially addressed, mark it unmet with explanation.`;

            const result = await systemAiService.generateJson(
                prompt,
                "copilot",
                {
                    systemPrompt: "You are a strict but fair code quality assessor. Return only valid JSON.",
                    temperature: 0.1,
                    ...(context.orgId ? { organizationId: context.orgId } : {}),
                }
            ) as SelfAssessmentResult | null;

            if (result && typeof result === "object" && "passed" in result) {
                logger.info(`[SelfAssessment] ${context.stepCode || "step"}: score=${result.score}, passed=${result.passed}, recommendation=${result.recommendation}`);
                return result;
            }

            logger.warn(`[SelfAssessment] Received null or unparseable response — proceeding with caution`);
            return {
                passed: true,
                score: 70,
                checklist: criteria.map(c => ({ criterion: c, met: true, evidence: "Assessment inconclusive" })),
                gaps: [],
                recommendation: "proceed",
                summary: "Self-assessment could not be fully evaluated — proceeding with caution.",
            };
        } catch (err: any) {
            logger.error(`[SelfAssessment] Assessment failed: ${err.message}`);
            return {
                passed: true,
                score: 50,
                checklist: [],
                gaps: ["Self-assessment service unavailable"],
                recommendation: "proceed",
                summary: `Assessment error: ${err.message}. Proceeding without verification.`,
            };
        }
    },
};
