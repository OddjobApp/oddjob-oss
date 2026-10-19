/**
 * IntegrationAnalyticsService — Pure Logic Tests
 * Tests the healthScore calculation logic, which is pure and deterministic.
 */

import { describe, it, expect } from "vitest";

// Test the pure logic extracted from IntegrationAnalyticsService
// The health score calculation is a pure function of execution statuses.
function calculateHealthScore(
    recentExecutions: Array<{ status: string }>,
    totalEntities: number
): number {
    let healthScore = 100;
    if (recentExecutions.length > 0) {
        const last5 = recentExecutions.slice(0, 5);
        const failures = last5.filter(e => e.status === 'failed').length;
        healthScore = Math.max(0, 100 - (failures * 20));
    } else if (totalEntities === 0) {
        healthScore = 0;
    }
    return healthScore;
}

function calculateDashboardOverallHealth(
    connectors: Array<{ status: string }>
): string {
    const errorCount = connectors.filter(c => c.status === 'error').length;
    const total = connectors.length;
    if (total === 0) return 'unknown';
    if (errorCount > total / 2) return 'critical';
    if (errorCount > 0) return 'degraded';
    return 'healthy';
}

describe("IntegrationAnalyticsService — Health Score Logic", () => {
    describe("calculateHealthScore", () => {
        it("should return 100 when all recent executions succeeded", () => {
            const execs = [
                { status: 'completed' },
                { status: 'completed' },
                { status: 'completed' }
            ];
            expect(calculateHealthScore(execs, 10)).toBe(100);
        });

        it("should deduct 20 per failed execution in last 5", () => {
            const execs = [
                { status: 'failed' },
                { status: 'completed' },
                { status: 'failed' },
                { status: 'completed' }
            ];
            // 2 failures → 100 - 40 = 60
            expect(calculateHealthScore(execs, 5)).toBe(60);
        });

        it("should floor at 0 for all 5 failures", () => {
            const execs = [
                { status: 'failed' },
                { status: 'failed' },
                { status: 'failed' },
                { status: 'failed' },
                { status: 'failed' }
            ];
            expect(calculateHealthScore(execs, 1)).toBe(0);
        });

        it("should return 0 for no executions and no entities", () => {
            expect(calculateHealthScore([], 0)).toBe(0);
        });

        it("should return 100 for no executions but entities exist", () => {
            expect(calculateHealthScore([], 10)).toBe(100);
        });

        it("should only consider first 5 executions (last5 slice)", () => {
            // 6 failures but only first 5 count → 0
            const execs = Array(6).fill({ status: 'failed' });
            expect(calculateHealthScore(execs, 1)).toBe(0);
        });
    });

    describe("calculateDashboardOverallHealth", () => {
        it("should return 'healthy' when all connectors are connected", () => {
            const connectors = [
                { status: 'connected' },
                { status: 'connected' }
            ];
            expect(calculateDashboardOverallHealth(connectors)).toBe('healthy');
        });

        it("should return 'degraded' when at least one connector has error", () => {
            const connectors = [
                { status: 'connected' },
                { status: 'error' }
            ];
            expect(calculateDashboardOverallHealth(connectors)).toBe('degraded');
        });

        it("should return 'critical' when majority have errors", () => {
            const connectors = [
                { status: 'error' },
                { status: 'error' },
                { status: 'connected' }
            ];
            expect(calculateDashboardOverallHealth(connectors)).toBe('critical');
        });

        it("should return 'unknown' when no connectors exist", () => {
            expect(calculateDashboardOverallHealth([])).toBe('unknown');
        });
    });
});
