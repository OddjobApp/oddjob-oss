
import { db } from "@server/database_service.js";
import { eq, and } from "drizzle-orm";
import { missionSuggestions } from "@shared/schema/agent/index.js";
import { suggestionApplyService } from "./suggestion-apply.service.js";
import { governorEngineService } from "../../governance/core/governor-engine.service.js";
import { createLogger } from "@server/utils/logger.js";
import { orgs } from "@shared/schema/auth.js";

const logger = createLogger("GovernanceAgentService");

/**
 * GovernanceAgentService
 * Autonomously resolves pending mission suggestions to self-heal the mission fleet.
 */
export class GovernanceAgentService {
    private isRunning = false;
    private interval: NodeJS.Timeout | null = null;

    /**
     * Start the autonomous governance loop.
     */
    start(intervalMs: number = 60000) {
        if (this.isRunning) return;
        this.isRunning = true;
        logger.info(`[Governance Agent] Starting autonomous remediation loop (Interval: ${intervalMs}ms)`);
        
        this.interval = setInterval(() => this.remediate(), intervalMs);
        // Run once immediately
        this.remediate();
    }

    /**
     * Stop the governance loop.
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        this.isRunning = false;
        logger.info("[Governance Agent] Stopped.");
    }

    /**
     * Core remediation logic.
     */
    async remediate() {
        try {
            await governorEngineService.evaluatePlatformHealth().catch(err =>
                logger.error(`[Governance Agent] Global platform health check failed:`, err)
            );
            
            // Push health signal to Redis for Python agents
            const { ResourceGovernor } = await import("../../governance/core/resource-governor.js");
            await ResourceGovernor.publishHealth();

            // 1. Find pending suggestions suitable for autonomous application
            // Criteria: type is 'error_mitigation' or 'performance', and status is 'pending'
            const pending = await db.select()
                .from(missionSuggestions)
                .where(and(
                    eq(missionSuggestions.status, 'pending'),
                    // We only auto-apply certain types for now
                    // In a more advanced version, we'd check a confidence score
                ));

            if (pending.length === 0) return;

            logger.info(`[Governance Agent] Found ${pending.length} pending suggestions. Processing...`);

            for (const suggestion of pending) {
                // Heuristic: Only auto-apply 'error_mitigation' or 'performance' suggestions
                // Quality and Tool Choice usually need human oversight.
                if (suggestion.type === 'error_mitigation' || suggestion.type === 'performance') {
                    logger.info(`[Governance Agent] Autonomously applying ${suggestion.type} fix: ${suggestion.title}`);
                    
                    const result = await suggestionApplyService.apply(suggestion.id, "governance-agent");
                    
                    if (result.success) {
                        logger.info(`[Governance Agent] Successfully applied fix for mission ${suggestion.missionId}`);
                    } else {
                        logger.warn(`[Governance Agent] Failed to apply fix: ${result.message}`);
                    }
                } else {
                    // Log but don't apply sensitive types
                    logger.debug(`[Governance Agent] Skipping ${suggestion.type} suggestion ${suggestion.id} (requires human review)`);
                }
            }
        } catch (err: any) {
            logger.error(`[Governance Agent] Remediation loop error: ${err.message}`);
        }
    }
}

export const governanceAgentService = new GovernanceAgentService();
