/**
 * Mission Budget Governor Service
 * 
 * Enforces session-wide and mission-wide token and spend envelopes for autonomous agent execution.
 * Provides soft warning thresholds (80%) and hard ceiling circuit-breaker trips (100%)
 * to prevent runaway model execution or unexpected provider billing.
 */

import { createLogger } from "@server/utils/logger.js";
import { getRedisClient } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("MissionBudgetGovernor");

export interface MissionBudgetState {
    sessionId: string;
    missionId: string;
    tokenBudget: number;
    tokensUsed: number;
    maxCostUsd?: number;
    costUsedUsd: number;
    status: 'active' | 'warning' | 'exhausted' | 'paused_hil';
    warningThreshold: number; // default 0.8 (80%)
    warningEmitted: boolean;
    lastUpdated: string;
}

export interface BudgetEvaluationResult {
    allowed: boolean;
    status: MissionBudgetState['status'];
    tokensUsed: number;
    remainingTokens: number;
    percentageUsed: number;
    message?: string;
}

export class MissionBudgetGovernor {
    private inMemoryBudgets: Map<string, MissionBudgetState> = new Map();
    private readonly defaultTokenBudget: number = 100_000;
    private readonly defaultWarningThreshold: number = 0.8; // 80%

    private getCacheKey(sessionId: string, missionId: string): string {
        return `oddjob:ai:budget:${sessionId}:${missionId}`;
    }

    /**
     * Initializes or updates the budget envelope for a mission.
     */
    public async setMissionBudget(
        sessionId: string,
        missionId: string,
        tokenBudget: number = this.defaultTokenBudget,
        maxCostUsd?: number,
        warningThreshold: number = this.defaultWarningThreshold
    ): Promise<MissionBudgetState> {
        const key = this.getCacheKey(sessionId, missionId);
        const existing = await this.getMissionBudget(sessionId, missionId);

        const state: MissionBudgetState = {
            sessionId,
            missionId,
            tokenBudget: tokenBudget || this.defaultTokenBudget,
            tokensUsed: existing ? existing.tokensUsed : 0,
            maxCostUsd,
            costUsedUsd: existing ? existing.costUsedUsd : 0,
            status: 'active',
            warningThreshold: Math.min(Math.max(warningThreshold, 0.1), 0.95),
            warningEmitted: false,
            lastUpdated: new Date().toISOString(),
        };

        this.inMemoryBudgets.set(key, state);

        try {
            const redis = getRedisClient();
            if (redis) {
                await redis.set(key, JSON.stringify(state), "EX", 86400 * 7); // 7-day TTL
            }
        } catch (err: any) {
            logger.warn(`Redis write failed for budget ${key}, using memory: ${err.message}`);
        }

        logger.info(`[BudgetGovernor] Initialized budget for session ${sessionId} / mission ${missionId}: ${tokenBudget} tokens (Warning at ${Math.round(state.warningThreshold * 100)}%)`);
        return state;
    }

    /**
     * Fetches the current budget state for a mission.
     */
    public async getMissionBudget(sessionId: string, missionId: string): Promise<MissionBudgetState | null> {
        const key = this.getCacheKey(sessionId, missionId);

        try {
            const redis = getRedisClient();
            if (redis) {
                const cached = await redis.get(key);
                if (cached) {
                    const parsed = JSON.parse(cached) as MissionBudgetState;
                    this.inMemoryBudgets.set(key, parsed);
                    return parsed;
                }
            }
        } catch (err: any) {
            logger.debug(`Redis read failed for budget ${key}, falling back to memory: ${err.message}`);
        }

        return this.inMemoryBudgets.get(key) || null;
    }

    /**
     * Pre-flight evaluation before a step executes.
     */
    public async checkBudget(
        sessionId: string,
        missionId: string,
        estimatedTokens: number = 0
    ): Promise<BudgetEvaluationResult> {
        let budget = await this.getMissionBudget(sessionId, missionId);
        if (!budget) {
            // Auto-provision default mission budget
            budget = await this.setMissionBudget(sessionId, missionId, this.defaultTokenBudget);
        }

        const projectedTokens = budget.tokensUsed + estimatedTokens;
        const remainingTokens = Math.max(0, budget.tokenBudget - budget.tokensUsed);
        const percentageUsed = budget.tokenBudget > 0 ? (budget.tokensUsed / budget.tokenBudget) : 1;

        if (budget.status === 'exhausted' || budget.status === 'paused_hil') {
            return {
                allowed: false,
                status: budget.status,
                tokensUsed: budget.tokensUsed,
                remainingTokens,
                percentageUsed,
                message: `Mission budget is ${budget.status}. Execution halted.`,
            };
        }

        if (projectedTokens > budget.tokenBudget) {
            return {
                allowed: false,
                status: 'exhausted',
                tokensUsed: budget.tokensUsed,
                remainingTokens,
                percentageUsed,
                message: `Projected token spend (${projectedTokens}) exceeds budget ceiling (${budget.tokenBudget}).`,
            };
        }

        const isWarning = percentageUsed >= budget.warningThreshold;
        return {
            allowed: true,
            status: isWarning ? 'warning' : 'active',
            tokensUsed: budget.tokensUsed,
            remainingTokens,
            percentageUsed,
            message: isWarning ? `Budget warning: ${Math.round(percentageUsed * 100)}% consumed.` : undefined,
        };
    }

    /**
     * Records actual token consumption and updates dollar burn.
     */
    public async recordSpend(
        sessionId: string,
        missionId: string,
        tokensUsed: number,
        modelName: string = "gemini-1.5-pro"
    ): Promise<MissionBudgetState> {
        let budget = await this.getMissionBudget(sessionId, missionId);
        if (!budget) {
            budget = await this.setMissionBudget(sessionId, missionId, this.defaultTokenBudget);
        }

        budget.tokensUsed += tokensUsed;
        budget.lastUpdated = new Date().toISOString();

        // Approximate token cost: $0.0000035 per token average
        const costPerToken = modelName.includes("flash") ? 0.0000005 : 0.0000035;
        budget.costUsedUsd += tokensUsed * costPerToken;

        const ratio = budget.tokenBudget > 0 ? (budget.tokensUsed / budget.tokenBudget) : 1;

        if (budget.tokensUsed >= budget.tokenBudget) {
            budget.status = 'exhausted';
            logger.warn(`[BudgetGovernor] Mission ${missionId} EXHAUSTED budget (${budget.tokensUsed}/${budget.tokenBudget} tokens, $${budget.costUsedUsd.toFixed(4)})`);
        } else if (ratio >= budget.warningThreshold && !budget.warningEmitted) {
            budget.status = 'warning';
            budget.warningEmitted = true;
            logger.warn(`[BudgetGovernor] Mission ${missionId} reached soft warning threshold: ${Math.round(ratio * 100)}% (${budget.tokensUsed}/${budget.tokenBudget} tokens)`);
        }

        const key = this.getCacheKey(sessionId, missionId);
        this.inMemoryBudgets.set(key, budget);

        try {
            const redis = getRedisClient();
            if (redis) {
                await redis.set(key, JSON.stringify(budget), "EX", 86400 * 7);
                // Publish live telemetry update
                await redis.publish(
                    `oddjob:ai:missions:${sessionId}`,
                    JSON.stringify({
                        type: "mission_budget_update",
                        missionId,
                        sessionId,
                        tokensUsed: budget.tokensUsed,
                        tokenBudget: budget.tokenBudget,
                        costUsedUsd: budget.costUsedUsd,
                        status: budget.status,
                    })
                );
            }
        } catch (err: any) {
            logger.warn(`Failed to sync budget spend to Redis: ${err.message}`);
        }

        return budget;
    }

    /**
     * Increases the token and/or dollar budget, restoring an exhausted mission to active.
     */
    public async increaseBudget(
        sessionId: string,
        missionId: string,
        additionalTokens: number,
        additionalCostUsd?: number
    ): Promise<MissionBudgetState> {
        let budget = await this.getMissionBudget(sessionId, missionId);
        if (!budget) {
            budget = await this.setMissionBudget(sessionId, missionId, additionalTokens, additionalCostUsd);
            return budget;
        }

        budget.tokenBudget += additionalTokens;
        if (additionalCostUsd && budget.maxCostUsd !== undefined) {
            budget.maxCostUsd += additionalCostUsd;
        }
        budget.status = 'active';
        budget.warningEmitted = false;
        budget.lastUpdated = new Date().toISOString();

        const key = this.getCacheKey(sessionId, missionId);
        this.inMemoryBudgets.set(key, budget);

        try {
            const redis = getRedisClient();
            if (redis) {
                await redis.set(key, JSON.stringify(budget), "EX", 86400 * 7);
            }
        } catch (err: any) {
            logger.warn(`Redis budget update failed: ${err.message}`);
        }

        logger.info(`[BudgetGovernor] Budget increased for mission ${missionId} by +${additionalTokens} tokens (New limit: ${budget.tokenBudget})`);
        return budget;
    }

    /**
     * Resets or clears budget state for a session.
     */
    public async reset(sessionId: string, missionId: string): Promise<void> {
        const key = this.getCacheKey(sessionId, missionId);
        this.inMemoryBudgets.delete(key);
        try {
            const redis = getRedisClient();
            if (redis) {
                await redis.del(key);
            }
        } catch {}
    }
}

export const missionBudgetGovernor = new MissionBudgetGovernor();
