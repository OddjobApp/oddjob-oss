/**
 * Telemetry Correlation Service — Post-mission context injection analysis.
 *
 * After a mission completes, this service:
 *   1. Correlates injection metadata with mission outcome
 *   2. Tracks context utilization (injected symbols vs. agent output)
 *   3. Emits recommendations when utilization drops below threshold
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ContextInjection");

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface CorrelationResult {
    missionId: number;
    orgId: number;
    symbolsInjected: number;
    symbolsUtilized: number;
    utilizationPercent: number; // 0-100
    unusedSymbols: string[];   // names of symbols that weren't referenced in output
}

export interface UtilizationRecord {
    workspacePath: string;
    orgId: number;
    missionId: number;
    utilizationPercent: number;
    timestamp: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOW_UTILIZATION_THRESHOLD = 20; // percent
const ROLLING_WINDOW_SIZE = 10;

// ─── In-Memory Store ──────────────────────────────────────────────────────────

/** Rolling window of utilization records per workspace path */
const utilizationHistory: Map<string, UtilizationRecord[]> = new Map();

// ─── Service ──────────────────────────────────────────────────────────────────

export const telemetryCorrelationService = {
    /**
     * Correlates injected symbols with the agent's output to determine utilization.
     *
     * For each injected symbol name, checks if it appears (case-sensitive) in
     * the agent output text. Partial matches count — e.g. "UserService" matches
     * "UserService.create" in the output.
     */
    correlateInjectionWithOutcome(
        missionId: number,
        orgId: number,
        injectedSymbols: string[],
        agentOutput: string,
    ): CorrelationResult {
        if (injectedSymbols.length === 0) {
            return {
                missionId,
                orgId,
                symbolsInjected: 0,
                symbolsUtilized: 0,
                utilizationPercent: 100, // nothing injected → nothing wasted
                unusedSymbols: [],
            };
        }

        const unusedSymbols: string[] = [];
        let symbolsUtilized = 0;

        for (const symbolName of injectedSymbols) {
            if (agentOutput.includes(symbolName)) {
                symbolsUtilized++;
            } else {
                unusedSymbols.push(symbolName);
            }
        }

        const utilizationPercent = Math.round(
            (symbolsUtilized / injectedSymbols.length) * 100,
        );

        const result: CorrelationResult = {
            missionId,
            orgId,
            symbolsInjected: injectedSymbols.length,
            symbolsUtilized,
            utilizationPercent,
            unusedSymbols,
        };

        logger.info("ContextInjectionCorrelation", result);

        return result;
    },

    /**
     * Tracks repository utilization over a rolling window and emits
     * a recommendation when the average drops below 20% over 10 missions.
     */
    trackRepositoryUtilization(
        orgId: number,
        workspacePath: string,
        utilizationPercent: number,
        missionId: number,
    ): void {
        const record: UtilizationRecord = {
            workspacePath,
            orgId,
            missionId,
            utilizationPercent,
            timestamp: Date.now(),
        };

        // Get or initialize the rolling window for this workspace
        let records = utilizationHistory.get(workspacePath);
        if (!records) {
            records = [];
            utilizationHistory.set(workspacePath, records);
        }

        // Append and trim to rolling window size
        records.push(record);
        if (records.length > ROLLING_WINDOW_SIZE) {
            records.splice(0, records.length - ROLLING_WINDOW_SIZE);
        }

        // Only evaluate when we have a full window
        if (records.length >= ROLLING_WINDOW_SIZE) {
            const avg =
                records.reduce((sum, r) => sum + r.utilizationPercent, 0) /
                records.length;

            if (avg < LOW_UTILIZATION_THRESHOLD) {
                logger.warn(
                    `[ContextInjection] Low utilization recommendation: Avg utilization for ${workspacePath} is ${Math.round(avg)}% over last 10 missions. Consider disabling context injection or adjusting token budget.`,
                );
            }
        }
    },

    /**
     * Returns the current utilization history for a workspace (for testing/debugging).
     */
    getUtilizationHistory(workspacePath: string): UtilizationRecord[] {
        return utilizationHistory.get(workspacePath) ?? [];
    },

    /**
     * Clears all utilization history (useful for testing).
     */
    _clearHistory(): void {
        utilizationHistory.clear();
    },
};
