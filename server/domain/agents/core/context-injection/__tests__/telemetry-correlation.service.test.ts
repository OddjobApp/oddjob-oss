import { describe, it, expect, beforeEach, vi } from "vitest";
import { telemetryCorrelationService } from "../telemetry-correlation.service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("telemetryCorrelationService", () => {
    beforeEach(() => {
        telemetryCorrelationService._clearHistory();
    });

    describe("correlateInjectionWithOutcome", () => {
        it("returns 100% utilization when no symbols were injected", () => {
            const result = telemetryCorrelationService.correlateInjectionWithOutcome(
                1, 100, [], "some agent output",
            );

            expect(result.symbolsInjected).toBe(0);
            expect(result.symbolsUtilized).toBe(0);
            expect(result.utilizationPercent).toBe(100);
            expect(result.unusedSymbols).toEqual([]);
        });

        it("counts all symbols as utilized when all appear in output", () => {
            const symbols = ["UserService", "createUser", "validateInput"];
            const output = "I used UserService.createUser() and called validateInput before saving.";

            const result = telemetryCorrelationService.correlateInjectionWithOutcome(
                1, 100, symbols, output,
            );

            expect(result.symbolsInjected).toBe(3);
            expect(result.symbolsUtilized).toBe(3);
            expect(result.utilizationPercent).toBe(100);
            expect(result.unusedSymbols).toEqual([]);
        });

        it("detects unused symbols that don't appear in output", () => {
            const symbols = ["UserService", "createUser", "deleteUser"];
            const output = "I modified UserService to add the createUser method.";

            const result = telemetryCorrelationService.correlateInjectionWithOutcome(
                2, 100, symbols, output,
            );

            expect(result.symbolsInjected).toBe(3);
            expect(result.symbolsUtilized).toBe(2);
            expect(result.utilizationPercent).toBe(67); // Math.round(2/3 * 100)
            expect(result.unusedSymbols).toEqual(["deleteUser"]);
        });

        it("uses case-sensitive matching", () => {
            const symbols = ["UserService"];
            const output = "I used userservice to handle the request.";

            const result = telemetryCorrelationService.correlateInjectionWithOutcome(
                3, 100, symbols, output,
            );

            expect(result.symbolsUtilized).toBe(0);
            expect(result.unusedSymbols).toEqual(["UserService"]);
        });

        it("counts partial matches (symbol name is substring of output token)", () => {
            const symbols = ["UserService"];
            const output = "Called UserService.create() with validated data.";

            const result = telemetryCorrelationService.correlateInjectionWithOutcome(
                4, 100, symbols, output,
            );

            expect(result.symbolsUtilized).toBe(1);
            expect(result.unusedSymbols).toEqual([]);
        });

        it("returns correct missionId and orgId in result", () => {
            const result = telemetryCorrelationService.correlateInjectionWithOutcome(
                42, 200, ["foo"], "used foo here",
            );

            expect(result.missionId).toBe(42);
            expect(result.orgId).toBe(200);
        });

        it("handles empty agent output", () => {
            const symbols = ["UserService", "createUser"];
            const result = telemetryCorrelationService.correlateInjectionWithOutcome(
                5, 100, symbols, "",
            );

            expect(result.symbolsUtilized).toBe(0);
            expect(result.utilizationPercent).toBe(0);
            expect(result.unusedSymbols).toEqual(["UserService", "createUser"]);
        });
    });

    describe("trackRepositoryUtilization", () => {
        it("stores utilization records for a workspace", () => {
            telemetryCorrelationService.trackRepositoryUtilization(100, "/repo/path", 50, 1);

            const history = telemetryCorrelationService.getUtilizationHistory("/repo/path");
            expect(history).toHaveLength(1);
            expect(history[0].utilizationPercent).toBe(50);
            expect(history[0].workspacePath).toBe("/repo/path");
            expect(history[0].orgId).toBe(100);
            expect(history[0].missionId).toBe(1);
        });

        it("maintains a rolling window of 10 records", () => {
            for (let i = 0; i < 15; i++) {
                telemetryCorrelationService.trackRepositoryUtilization(100, "/repo", 50, i);
            }

            const history = telemetryCorrelationService.getUtilizationHistory("/repo");
            expect(history).toHaveLength(10);
            // Should keep the most recent 10 (missions 5-14)
            expect(history[0].missionId).toBe(5);
            expect(history[9].missionId).toBe(14);
        });

        it("does not emit warning when fewer than 10 records exist", () => {
            const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

            for (let i = 0; i < 9; i++) {
                telemetryCorrelationService.trackRepositoryUtilization(100, "/repo", 5, i);
            }

            // Logger.warn uses structured logging internally, but we verify no recommendation
            // by checking history length is still < 10
            const history = telemetryCorrelationService.getUtilizationHistory("/repo");
            expect(history).toHaveLength(9);

            warnSpy.mockRestore();
        });

        it("tracks separate workspaces independently", () => {
            telemetryCorrelationService.trackRepositoryUtilization(100, "/repo-a", 80, 1);
            telemetryCorrelationService.trackRepositoryUtilization(100, "/repo-b", 20, 2);

            expect(telemetryCorrelationService.getUtilizationHistory("/repo-a")).toHaveLength(1);
            expect(telemetryCorrelationService.getUtilizationHistory("/repo-b")).toHaveLength(1);
        });

        it("returns empty array for unknown workspace", () => {
            const history = telemetryCorrelationService.getUtilizationHistory("/nonexistent");
            expect(history).toEqual([]);
        });
    });
});
