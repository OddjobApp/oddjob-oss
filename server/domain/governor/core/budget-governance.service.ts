
import { db } from "@server/database_service.js";
import { agentSalaries } from "@shared/schema/governor.js";
import { eq, and, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BudgetGovernanceService");

export interface BudgetCheckResult {
    allowed: boolean;
    currentSpend: number;
    budget: number;
    message?: string;
}

export class BudgetGovernanceService {
    /**
     * Checks if an agent has sufficient token budget for a mission/session.
     */
    static async checkAgentSalary(agentId: number, sessionId: string, estimatedTokens: number = 0): Promise<BudgetCheckResult> {
        logger.info(`Checking budget for agent ${agentId} in session ${sessionId}`);

        let [salary] = await db.select()
            .from(agentSalaries)
            .where(and(eq(agentSalaries.agentId, agentId), eq(agentSalaries.sessionId, sessionId)));

        if (!salary) {
            // Auto-provision a default salary if none exists for this session
            logger.info(`No salary record found for agent ${agentId}/${sessionId}. Provisioning default.`);
            [salary] = await db.insert(agentSalaries).values({
                agentId,
                sessionId,
                budgetTokens: 100000, // Default 100k
                currentSpendTokens: 0,
                status: 'active'
            }).returning();
        }

        if (salary.status !== 'active') {
            return {
                allowed: false,
                currentSpend: salary.currentSpendTokens,
                budget: salary.budgetTokens,
                message: `Agent salary status is ${salary.status}. Mission halted.`
            };
        }

        const projectedSpend = salary.currentSpendTokens + estimatedTokens;

        if (projectedSpend > salary.budgetTokens) {
            return {
                allowed: false,
                currentSpend: salary.currentSpendTokens,
                budget: salary.budgetTokens,
                message: `Projected spend (${projectedSpend}) exceeds token budget (${salary.budgetTokens}). SIG_BUDGET_EXCEEDED.`
            };
        }

        return {
            allowed: true,
            currentSpend: salary.currentSpendTokens,
            budget: salary.budgetTokens
        };
    }

    /**
     * Updates the actual spend for an agent after a tool call or LLM completion.
     */
    static async recordSpend(agentId: number, sessionId: string, tokensUsed: number): Promise<void> {
        // Atomically increment spend and flip status to 'exhausted' if limit is hit —
        // single UPDATE avoids the read-check-write race that lets concurrent callers overspend.
        const [updated] = await db.update(agentSalaries)
            .set({
                currentSpendTokens: sql`${agentSalaries.currentSpendTokens} + ${tokensUsed}`,
                status: sql`CASE WHEN ${agentSalaries.currentSpendTokens} + ${tokensUsed} >= ${agentSalaries.budgetTokens} THEN 'exhausted' ELSE ${agentSalaries.status} END`,
                lastUpdated: new Date()
            })
            .where(and(eq(agentSalaries.agentId, agentId), eq(agentSalaries.sessionId, sessionId)))
            .returning();

        if (updated && updated.status === 'exhausted') {
            logger.warn(`Agent ${agentId} has exhausted their salary budget for session ${sessionId}`);
        }
    }

    /**
     * Increases an agent's salary budget (HIL Action).
     */
    static async increaseBudget(agentId: number, sessionId: string, additionalTokens: number): Promise<void> {
        await db.update(agentSalaries)
            .set({
                budgetTokens: sql`${agentSalaries.budgetTokens} + ${additionalTokens}`,
                status: 'active',
                lastUpdated: new Date()
            })
            .where(and(eq(agentSalaries.agentId, agentId), eq(agentSalaries.sessionId, sessionId)));
        logger.info(`Increased budget for agent ${agentId} by ${additionalTokens} tokens.`);
    }
}
