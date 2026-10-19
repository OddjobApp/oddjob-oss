/**
 * Execution-strategy guard.
 *
 * `execution_strategy` is a plain text column with a `pre_planned` default and
 * no DB constraint, and `mission-execution.service.ts` dispatches each strategy
 * from its own `if`-and-return. That combination means an unrecognized value
 * falls past every orchestrator branch into the pre-planned path: the mission
 * runs, reports success, and does something nobody asked for.
 *
 * These tests pin the guard that closes that gap, and pin the list itself
 * against the dispatch chain it mirrors.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { executionStrategies, isExecutionStrategy } from "./core";

describe("execution strategy guard", () => {
    it("accepts every documented strategy", () => {
        for (const strategy of executionStrategies) {
            expect(isExecutionStrategy(strategy)).toBe(true);
        }
    });

    it("rejects unknown, empty, and non-string values", () => {
        // The realistic failure: a typo or a renamed strategy in an existing row.
        expect(isExecutionStrategy("rolling_waves")).toBe(false);
        expect(isExecutionStrategy("pre-planned")).toBe(false);
        expect(isExecutionStrategy("")).toBe(false);
        expect(isExecutionStrategy(undefined)).toBe(false);
        expect(isExecutionStrategy(null)).toBe(false);
        expect(isExecutionStrategy(42)).toBe(false);
    });

    it("includes llm_compiler, which dispatches in the execution service", () => {
        // It routed for a long time while absent from this list, so callers had
        // no way to know it existed. Regression guard against dropping it again.
        expect(isExecutionStrategy("llm_compiler")).toBe(true);
    });

    // Drift guard: the list and the dispatch chain are maintained by hand in two
    // files. If a strategy is dispatched but undocumented, callers cannot
    // discover it; this catches that without importing the server module.
    it("documents every strategy the execution service dispatches on", () => {
        const source = readFileSync(
            resolve("server/domain/mission/core/mission-execution.service.ts"),
            "utf8",
        );
        const dispatched = new Set(
            [...source.matchAll(/executionStrategy === "([a-z_]+)"/g)].map((match) => match[1]),
        );

        expect(dispatched.size).toBeGreaterThan(0);
        for (const strategy of dispatched) {
            expect(executionStrategies).toContain(strategy);
        }
    });
});
