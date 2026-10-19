import { describe, it, expect } from "vitest";

import type { ChangeOperation } from "@shared/schema/improvement/index.js";
import {
    validateBlueprintChange,
    assertBlueprintChangeValid,
    projectOperations,
    findDependencyCycle,
    BlueprintValidationError,
    MANDATORY_ROLES,
    type BlueprintSnapshot,
    type RuntimeState,
} from "./blueprint-evolution-validator.service.js";

function snapshot(): BlueprintSnapshot {
    return {
        missions: [
            { id: "gather", outputs: ["raw"], role: "work" },
            { id: "review", dependsOn: ["gather"], consumesOutputs: ["raw"], outputs: ["reviewed"], role: "approval" },
            { id: "verify", dependsOn: ["review"], consumesOutputs: ["reviewed"], outputs: ["verified"], role: "verification" },
            { id: "publish", dependsOn: ["verify"], consumesOutputs: ["verified"], role: "work" },
            { id: "notify", role: "work" },
        ],
        deliverables: [{ name: "report", producedBy: ["publish"] }],
    };
}

const idle: RuntimeState = { activeMissionIds: [], hasActiveExecution: false };

const remove = (missionId: string): ChangeOperation => ({
    kind: "remove_mission", payload: { missionId },
});
const disable = (missionId: string): ChangeOperation => ({
    kind: "disable_mission", payload: { missionId },
});

function codes(r: ReturnType<typeof validateBlueprintChange>) {
    return r.ok ? [] : r.refusals.map(f => f.code);
}

describe("projectOperations", () => {
    it("applies removals, disables, adds and updates in memory", () => {
        const after = projectOperations(snapshot(), [
            remove("notify"),
            disable("publish"),
            { kind: "add_mission", payload: { mission: { id: "extra", role: "work" } } },
            { kind: "update_mission", payload: { missionId: "gather", mission: { outputs: ["raw", "meta"] } } },
        ]);
        expect(after.missions.map(m => m.id)).not.toContain("notify");
        expect(after.missions.find(m => m.id === "publish")!.disabled).toBe(true);
        expect(after.missions.map(m => m.id)).toContain("extra");
        expect(after.missions.find(m => m.id === "gather")!.outputs).toEqual(["raw", "meta"]);
    });

    it("does not mutate the input snapshot", () => {
        const original = snapshot();
        projectOperations(original, [remove("notify")]);
        expect(original.missions.map(m => m.id)).toContain("notify");
    });
});

describe("safe changes are permitted", () => {
    it("allows removing a leaf work mission nothing depends on", () => {
        const r = validateBlueprintChange(snapshot(), [remove("notify")], idle);
        expect(r.ok).toBe(true);
    });

    it("allows adding a mission", () => {
        const r = validateBlueprintChange(
            snapshot(),
            [{ kind: "add_mission", payload: { mission: { id: "extra", role: "work" } } }],
            idle,
        );
        expect(r.ok).toBe(true);
    });
});

describe("mandatory gates cannot be removed by side effect", () => {
    it.each(["review", "verify"])("refuses removing the '%s' gate", (id) => {
        const r = validateBlueprintChange(snapshot(), [remove(id)], idle);
        expect(codes(r)).toContain("MANDATORY_GATE_REMOVED");
    });

    // A refusal without an alternative just gets overridden.
    it("names conditional narrowing as the alternative", () => {
        const r = validateBlueprintChange(snapshot(), [remove("review")], idle);
        const refusal = r.ok ? null : r.refusals.find(f => f.code === "MANDATORY_GATE_REMOVED")!;
        expect(refusal!.suggestion).toMatch(/[Nn]arrow it conditionally/);
    });

    // Disabling may be legitimate, but never silent.
    it("warns rather than refuses when a gate is disabled", () => {
        const r = validateBlueprintChange(snapshot(), [disable("review")], idle);
        expect(r.warnings.some(w => w.code === "MANDATORY_GATE_REMOVED")).toBe(true);
    });

    it("treats every governance role as mandatory", () => {
        expect([...MANDATORY_ROLES].sort()).toEqual([
            "approval", "compliance", "reconciliation", "security", "verification",
        ]);
    });
});

describe("dangling structure is refused", () => {
    it("refuses removing a mission others depend on", () => {
        const r = validateBlueprintChange(snapshot(), [remove("gather")], idle);
        expect(codes(r)).toContain("DEPENDENCY_REFERENCE");
    });

    it("refuses removing the only producer of a consumed output", () => {
        const r = validateBlueprintChange(snapshot(), [remove("gather")], idle);
        expect(codes(r)).toContain("OUTPUT_CONSUMER");
    });

    it("allows it when another enabled mission still produces that output", () => {
        const s = snapshot();
        s.missions.push({ id: "gather2", outputs: ["raw"], role: "work" });
        // Re-point the dependant so only the output question remains.
        s.missions.find(m => m.id === "review")!.dependsOn = ["gather2"];
        const r = validateBlueprintChange(s, [remove("gather")], idle);
        expect(codes(r)).not.toContain("OUTPUT_CONSUMER");
    });

    it("refuses a dependency on something that will not exist", () => {
        const r = validateBlueprintChange(
            snapshot(),
            [{ kind: "add_mission", payload: { mission: { id: "orphan", dependsOn: ["ghost"] } } }],
            idle,
        );
        expect(codes(r)).toContain("UNKNOWN_DEPENDENCY");
    });

    it("refuses an operation targeting a mission that is not there", () => {
        const r = validateBlueprintChange(snapshot(), [remove("nope")], idle);
        expect(codes(r)).toContain("UNKNOWN_MISSION");
    });

    it("refuses a change that would create a cycle", () => {
        const r = validateBlueprintChange(
            snapshot(),
            [{ kind: "update_mission", payload: { missionId: "gather", mission: { dependsOn: ["publish"] } } }],
            idle,
        );
        expect(codes(r)).toContain("DEPENDENCY_CYCLE");
    });

    it("detects the cycle members", () => {
        const cycle = findDependencyCycle([
            { id: "a", dependsOn: ["b"] },
            { id: "b", dependsOn: ["c"] },
            { id: "c", dependsOn: ["a"] },
        ]);
        expect(cycle).not.toBeNull();
        expect(cycle!.length).toBeGreaterThanOrEqual(3);
    });

    it("does not report a cycle for a plain chain", () => {
        expect(findDependencyCycle(snapshot().missions)).toBeNull();
    });
});

describe("deliverables must remain producible", () => {
    it("refuses a change that orphans a declared deliverable", () => {
        const r = validateBlueprintChange(snapshot(), [remove("publish")], idle);
        expect(codes(r)).toContain("DELIVERABLE_UNPRODUCIBLE");
    });

    it("counts a disabled producer as unable to produce", () => {
        const r = validateBlueprintChange(snapshot(), [disable("publish")], idle);
        expect(codes(r)).toContain("DELIVERABLE_UNPRODUCIBLE");
    });

    it("allows it when a second producer remains", () => {
        const s = snapshot();
        s.missions.push({ id: "publish2", role: "work" });
        s.deliverables = [{ name: "report", producedBy: ["publish", "publish2"] }];
        const r = validateBlueprintChange(s, [remove("publish")], idle);
        expect(codes(r)).not.toContain("DELIVERABLE_UNPRODUCIBLE");
    });
});

describe("live runs", () => {
    const running: RuntimeState = {
        hasActiveExecution: true,
        activeMissionIds: ["review"],
        completedMissionIds: ["gather"],
    };

    it("refuses removing a mission that is executing", () => {
        const r = validateBlueprintChange(snapshot(), [remove("review")], running);
        expect(codes(r)).toContain("ACTIVE_EXECUTION");
    });

    it("refuses removing a mission already completed in this run", () => {
        const r = validateBlueprintChange(snapshot(), [remove("gather")], running);
        expect(codes(r)).toContain("COMPLETED_IN_CURRENT_RUN");
    });

    it("suggests scoping to the next run rather than the one in flight", () => {
        const r = validateBlueprintChange(snapshot(), [remove("review")], running);
        const refusal = r.ok ? null : r.refusals.find(f => f.code === "ACTIVE_EXECUTION")!;
        expect(refusal!.suggestion).toMatch(/next run|checkpoint/);
    });

    it("permits the same change when nothing is in flight", () => {
        const r = validateBlueprintChange(snapshot(), [remove("notify")], idle);
        expect(r.ok).toBe(true);
    });
});

describe("reporting", () => {
    it("collects every refusal rather than stopping at the first", () => {
        const r = validateBlueprintChange(snapshot(), [remove("gather"), remove("review")], idle);
        expect(codes(r).length).toBeGreaterThanOrEqual(3);
    });

    it("throws a typed error carrying them", () => {
        try {
            assertBlueprintChangeValid(snapshot(), [remove("review")], idle);
            throw new Error("expected a refusal");
        } catch (err) {
            expect(err).toBeInstanceOf(BlueprintValidationError);
            expect((err as BlueprintValidationError).refusals.length).toBeGreaterThan(0);
        }
    });
});
