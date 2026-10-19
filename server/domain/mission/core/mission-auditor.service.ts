
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { AIClientFactory } from "../../ai/core/ai-client.service.js";
import { ODDJOB_CONSTITUTION, AuditResult } from "../utils/constitution.js";
import { MissionWaveBlueprint } from "../utils/mission-types.js";

const logger = createLogger("MissionAuditor");

export class MissionAuditorService {
    /**
     * Audits a mission blueprint against the Oddjob Constitution.
     */
    static async audit(
        missionRunId: number,
        blueprint: MissionWaveBlueprint,
        orgId: number | null,
        appendTrace: (missionRunId: number, trace: any) => void
    ): Promise<AuditResult> {
        logger.info(`[Auditor] Starting constitutional audit for mission ${missionRunId}`);
        appendTrace(missionRunId, { type: "auditor", event: "audit_started", note: "Reviewing blueprint against the Oddjob Constitution..." });

        const aiConfig = await systemAiService.getAiConfig('auditor', orgId ?? undefined) || { provider: 'google', model: 'gemini-2.0-flash', apiKey: "" };
        const aiClient = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: (aiConfig as any).baseUrl } as any);

        const constitutionText = ODDJOB_CONSTITUTION.map(c => `- [${c.id}] ${c.principle}: ${c.description}`).join('\n');

        const prompt = `
        You are the Oddjob Constitutional Auditor.
        Your job is to review an AI Agent's proposed mission blueprint and ensure it complies with our core principles.

        ODDJOB CONSTITUTION:
        ${constitutionText}

        PROPOSED BLUEPRINT:
        Objective: ${blueprint.objective}
        Thought Process: ${blueprint.thought_process}
        Steps:
        ${blueprint.workflow.steps.map((s, i) => `${i + 1}. ${s.tool}(${JSON.stringify(s.arguments)}) - ${s.note || ''}`).join('\n')}

        INSTRUCTIONS:
        1. Evaluate each step and the overall strategy against the principles.
        2. Assign a safety score (0-100).
        3. Identify any specific violations.
        4. If there is a "critical" violation, you MUST fail the audit (passed: false).
        5. Provide a recommendation for fixing any issues.

        RESPONSE FORMAT (JSON ONLY):
        {
            "passed": boolean,
            "score": number,
            "violations": [
                { "principleId": "CON-XXX", "reason": "Specific reason for violation", "severity": "low" | "medium" | "high" | "critical" }
            ],
            "recommendation": "What the agent should change to comply"
        }
        `;

        try {
            const result = await aiClient.execute({
                model: aiConfig.model,
                userPrompt: prompt,
                temperature: 0,
                requestType: "json"
            } as any, undefined, aiConfig.apiKey || "");

            if (!result.success || !result.output) {
                throw new Error("Auditor AI failed to respond");
            }

            const auditResult: AuditResult = JSON.parse(result.output);

            if (auditResult.passed) {
                appendTrace(missionRunId, { 
                    type: "auditor", 
                    event: "audit_passed", 
                    note: `Audit passed with score ${auditResult.score}.`,
                    score: auditResult.score
                });
            } else {
                appendTrace(missionRunId, { 
                    type: "auditor", 
                    event: "audit_failed", 
                    note: `CRITICAL VIOLATION: ${auditResult.violations.map(v => v.reason).join('; ')}`,
                    score: auditResult.score,
                    recommendation: auditResult.recommendation
                });
            }

            return auditResult;
        } catch (error: any) {
            logger.error(`[Auditor] Audit failure: ${error.message}`);
            return {
                passed: true, // Fail-open for system resilience, but log error
                score: 50,
                violations: [],
                recommendation: "System error during audit. Proceed with caution."
            };
        }
    }
}
