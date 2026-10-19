import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import type { AgentStep, AgentTerminalReason } from "./types.js";

/**
 * Endurance instrumentation.
 *
 * `agent_run_steps` recorded every step of a run and nothing about how it
 * ended, so a run that answered the goal and a run that exhausted its iteration
 * budget were indistinguishable after the fact — you could count steps per
 * runId and still not know whether any of them worked. The orchestrator already
 * computed iteration counts and stall state; it dropped them on the way out.
 *
 * Every exit path from AgentOrchestrator.run() must now file exactly one
 * terminal `run_outcome` step. Driving the real loop needs a live model client,
 * so this asserts the contract two ways: the shape of the record, and that no
 * return path in run() was left without one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCHESTRATOR = readFileSync(join(HERE, "agent-orchestrator.ts"), "utf8");

/** Body of AgentOrchestrator.run(), up to the next method definition. */
function runMethodSource(): string {
    const start = ORCHESTRATOR.indexOf("    async run(");
    expect(start, "run() not found — did the method get renamed?").toBeGreaterThan(-1);
    const end = ORCHESTRATOR.indexOf("\n    private async perceive(", start);
    expect(end, "end of run() not found").toBeGreaterThan(start);
    return ORCHESTRATOR.slice(start, end);
}

describe("run outcome instrumentation", () => {
    it("files an outcome on every return path out of run()", () => {
        const source = runMethodSource();

        // Every `return {` in run() is a way the run can end.
        const returns = [...source.matchAll(/\n\s*return \{/g)];
        expect(returns.length).toBeGreaterThan(0);

        // Each must either be preceded by a recordOutcome() call, or return a
        // history that carries an inline run_outcome step — the two pre-loop
        // guards build their own history array before the recorder exists.
        //
        // Counting occurrences instead would be wrong: recordOutcome's own body
        // contains the `type: "run_outcome"` literal, so the totals never line
        // up with the number of exits.
        const uncovered = returns
            .filter((match) => {
                const at = match.index!;
                const before = source.slice(Math.max(0, at - 500), at);
                const returnedObject = source.slice(at, at + 900);
                return (
                    !/recordOutcome\((["'])[a-z_]+\1\)/.test(before) &&
                    !/type: "run_outcome"/.test(returnedObject)
                );
            })
            .map((match) => source.slice(match.index!, match.index! + 60).trim());

        expect(uncovered).toEqual([]);
    });

    it("uses only declared terminal reasons", () => {
        const declared = new Set<AgentTerminalReason>([
            "converged",
            "interrupted",
            "iteration_limit",
            "blocked_by_guardrail",
            "plan_rejected",
        ]);

        const used = [
            ...runMethodSource().matchAll(/recordOutcome\(["']([a-z_]+)["']\)/g),
        ].map((m) => m[1]);

        expect(used.length).toBeGreaterThan(0);
        for (const reason of used) {
            expect(declared.has(reason as AgentTerminalReason)).toBe(true);
        }
    });

    it("records the fields an endurance query needs", () => {
        // The point of the record is that "how long did it run before it broke"
        // is answerable by SQL. Losing any of these puts it back out of reach.
        const source = runMethodSource();
        for (const field of [
            "terminalReason",
            "iterationsUsed",
            "maxIterations",
            "lastProgressIteration",
            "consecutiveNoProgress",
            "stallEvents",
        ]) {
            expect(source, `run_outcome metadata lost ${field}`).toContain(`${field}`);
        }
    });

    it("counts a stall each time the guardrail fires, not just the last one", () => {
        // consecutiveNoProgress is reset to 0 when the re-plan prompt is
        // injected, so without a separate counter a run that stalled five times
        // and recovered looks identical to one that never stalled.
        const source = runMethodSource();
        const resetIndex = source.indexOf("consecutiveNoProgress = 0; // Reset");
        expect(resetIndex).toBeGreaterThan(-1);
        expect(source.slice(0, resetIndex)).toContain("stallEvents++");
    });

    it("types run_outcome as a legal step so it survives persistence", () => {
        // AgentStep.type is a closed union; a step the type rejects would be
        // dropped at the persistence boundary rather than stored.
        const step: AgentStep = {
            type: "run_outcome",
            content: "Run ended: converged after 3/12 iterations.",
            metadata: { terminalReason: "converged", iterationsUsed: 3, maxIterations: 12 },
        };
        expect(step.type).toBe("run_outcome");
        expect(step.metadata?.terminalReason).toBe("converged");
    });
});
