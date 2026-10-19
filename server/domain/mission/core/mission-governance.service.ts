
import { db } from "@server/database_service.js";
import { missions, missionRuns, operationalCycles } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { MissionContext } from "../utils/mission-types.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";

const logger = createLogger("MissionGovernance");

export class MissionGovernanceService {
    /**
     * Enforces wave limits and budget constraints for a mission run.
     * Returns true if the mission is allowed to continue.
     */
    static async validate(missionRunId: number, context: MissionContext, appendTrace: (id: number, entry: any) => void): Promise<boolean> {
        const [run] = await db.select().from(missionRuns).where(eq(missionRuns.id, missionRunId)).limit(1);
        if (!run || run.status !== 'active') return false;

        // 1. Max Wave Guard
        if (context.current_wave > (context.max_waves || 10)) {
            logger.warn(`[Governance] Run ${missionRunId} reached max waves.`);
            appendTrace(missionRunId, { type: "system", event: "max_waves_reached", note: `Limit reached (${context.current_wave}/${context.max_waves})` });
            await db.update(missionRuns).set({ status: "completed", updatedAt: new Date() }).where(eq(missionRuns.id, missionRunId));
            return false;
        }

        // 2. Budget Guard
        if (run.missionId) {
            try {
                const { missionQueryService } = await import("./mission-query.service.js");
                const [missionData] = await db.select().from(missions).where(eq(missions.id, run.missionId)).limit(1);
                const currentSpend = await missionQueryService.calculateTotalSpend(run.missionId);
                const budgetLimit = missionData?.budgetLimitUsd ? parseFloat(String(missionData.budgetLimitUsd)) : 50.00;

                if (currentSpend > budgetLimit) {
                    logger.warn(`[Governance] Budget exceeded for run ${missionRunId}.`);
                    appendTrace(missionRunId, { type: "error", event: "budget_exceeded", note: `Budget limit reached ($${currentSpend.toFixed(2)}/$${budgetLimit.toFixed(2)})` });
                    await db.update(missionRuns).set({ status: "failed", updatedAt: new Date() }).where(eq(missionRuns.id, missionRunId));
                    return false;
                }
            } catch (err: any) {
                logger.warn(`[Governance] Budget check failed: ${err.message}`);
            }
        }

        // 3. Aggregate Cycle Budget Guard
        if (run.cycleId) {
            try {
                const { CycleManagerService } = await import("./cycle-manager.service.js");
                const [cycle] = await db.select().from(operationalCycles).where(eq(operationalCycles.id, run.cycleId)).limit(1);
                const currentCycleSpend = await CycleManagerService.calculateCycleSpend(run.cycleId);
                const cycleBudgetLimit = cycle?.budgetLimitUsd ? parseFloat(String(cycle.budgetLimitUsd)) : 150.00;

                if (currentCycleSpend > cycleBudgetLimit) {
                    logger.warn(`[Governance] Cycle budget exceeded for run ${missionRunId}.`);
                    appendTrace(missionRunId, { type: "error", event: "cycle_budget_exceeded", note: `Cycle budget limit reached ($${currentCycleSpend.toFixed(2)}/$${cycleBudgetLimit.toFixed(2)})` });
                    await db.update(missionRuns).set({ status: "paused", updatedAt: new Date() }).where(eq(missionRuns.id, missionRunId));
                    return false;
                }

                // 4. Aggregate Cycle Token Guard
                const currentCycleTokens = await CycleManagerService.calculateCycleTokens(run.cycleId);
                const cycleTokenLimit = cycle?.tokenLimit || 1000000;

                if (currentCycleTokens > cycleTokenLimit) {
                    logger.warn(`[Governance] Cycle token limit exceeded for run ${missionRunId}.`);
                    appendTrace(missionRunId, { type: "error", event: "cycle_token_limit_exceeded", note: `Cycle token limit reached (${currentCycleTokens}/${cycleTokenLimit})` });
                    await db.update(missionRuns).set({ status: "paused", updatedAt: new Date() }).where(eq(missionRuns.id, missionRunId));
                    return false;
                }
            } catch (err: any) {
                logger.warn(`[Governance] Cycle governance check failed: ${err.message}`);
            }
        }

        return true;
    }

    /**
     * Sentinel Audit (Pillar 5): Constitutional Governance.
     * Audits an agent's proposed tool-use against core system safety protocols (RLAIF).
     */
    static async sentinelAudit(
        missionRunId: number, 
        toolCall: { tool: string; params: any }, 
        missionObjective: string,
        organizationId?: number
    ): Promise<{ approved: boolean; rationale: string }> {
        logger.info(`[Sentinel] Auditing tool call: ${toolCall.tool} for run ${missionRunId}`);

        const aiConfig = await systemAiService.getAiConfig('compliance_officer', organizationId);
        if (!aiConfig) return { approved: true, rationale: "Compliance officer unavailable. Defaulting to trust." };

        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const constitution = `
            ODDJOB SYSTEM CONSTITUTION:
            1. NO DESTRUCTIVE SHELL: Blocking commands that delete root directories or system configurations.
            2. NO DATA EXFILTRATION: Blocking tool calls that attempt to send platform secrets or keys to external domains.
            3. MISSION ALIGNMENT: Actions must directly serve the mission objective.
            4. AUTHENTICITY: Agents must not attempt to impersonate human users for unauthorized escalations.
        `;

        const userPrompt = `
            MISSION OBJECTIVE: ${missionObjective}
            PROPOSED TOOL: ${toolCall.tool}
            PARAMETERS: ${JSON.stringify(toolCall.params)}
            
            Evaluate this action against the Constitution. 
            Return JSON: { "approved": boolean, "rationale": "..." }
        `;

        try {
            const result = await aiClient.execute({
                model: aiConfig.model,
                systemPrompt: constitution,
                userPrompt,
                requestType: 'json',
                responseType: 'json'
            } as any, undefined, aiConfig.apiKey ?? "") as any;

            if (result.success && result.output) {
                const parsed = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
                if (!parsed.approved) {
                    logger.warn(`[Sentinel] ACTION BLOCKED for run ${missionRunId}: ${parsed.rationale}`);
                }
                return parsed;
            }
        } catch (err) {
            logger.error(`[Sentinel] Audit failed:`, err);
        }

        return { approved: true, rationale: "Sentinel pass (fallback)." };
    }
}
