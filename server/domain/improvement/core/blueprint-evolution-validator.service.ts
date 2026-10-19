/**
 * §9.3 structural validation for blueprint change sets.
 *
 * Every rule here is a refusal, and each exists because the corresponding
 * mistake is silent. Removing a mission does not error at edit time — it errors
 * three days later when a downstream mission finds no input, or never errors at
 * all because the thing removed was the approval gate.
 *
 * The rule the spec is most emphatic about, and the one this encodes hardest:
 *
 *   **Conditional narrowing is preferred to deletion.** When evidence supports
 *   only a subset, retain the mission for the rest rather than removing it.
 *   Every refusal that could be satisfied by narrowing says so, because
 *   "validation failed" without an alternative just gets overridden.
 */

import type { ChangeOperation } from "@shared/schema/improvement/index.js";

/**
 * Roles that exist to stop something.
 *
 * Removing one of these is not a structural change, it is a governance change,
 * and §9.3 forbids doing it by side effect. `work` is everything else.
 */
export type MissionRole =
    | "approval"
    | "security"
    | "compliance"
    | "reconciliation"
    | "verification"
    | "work";

export const MANDATORY_ROLES: ReadonlySet<MissionRole> = new Set([
    "approval", "security", "compliance", "reconciliation", "verification",
]);

export interface BlueprintMission {
    id: string;
    name?: string;
    /** Mission ids this one waits on. */
    dependsOn?: string[];
    /** Named outputs this mission produces. */
    outputs?: string[];
    /** Named outputs this mission reads. */
    consumesOutputs?: string[];
    role?: MissionRole;
    disabled?: boolean;
    /** A guard expression, when the mission runs conditionally. */
    condition?: string | null;
}

export interface BlueprintDeliverable {
    name: string;
    /** Mission ids capable of producing it. */
    producedBy: string[];
}

export interface BlueprintSnapshot {
    missions: BlueprintMission[];
    deliverables?: BlueprintDeliverable[];
}

/** What the target is doing right now. */
export interface RuntimeState {
    /** Mission ids in an active or running execution. */
    activeMissionIds: string[];
    /** Mission ids already completed in the current run. */
    completedMissionIds?: string[];
    /** Whether any execution is in flight at all. */
    hasActiveExecution: boolean;
}

export type BlueprintRefusalCode =
    | "ACTIVE_EXECUTION"
    | "COMPLETED_IN_CURRENT_RUN"
    | "DEPENDENCY_REFERENCE"
    | "OUTPUT_CONSUMER"
    | "MANDATORY_GATE_REMOVED"
    | "DELIVERABLE_UNPRODUCIBLE"
    | "DEPENDENCY_CYCLE"
    | "UNKNOWN_MISSION"
    | "UNKNOWN_DEPENDENCY";

export interface BlueprintRefusal {
    code: BlueprintRefusalCode;
    missionId: string;
    reason: string;
    /** The narrowing that would satisfy the intent without the refusal. */
    suggestion?: string;
}

export type BlueprintValidationResult =
    | { ok: true; warnings: BlueprintRefusal[] }
    | { ok: false; refusals: BlueprintRefusal[]; warnings: BlueprintRefusal[] };

/** Operations that take a mission out of service, whether by removal or not. */
const REMOVING_KINDS = new Set(["remove_mission", "disable_mission"]);

function missionsById(snapshot: BlueprintSnapshot): Map<string, BlueprintMission> {
    return new Map(snapshot.missions.map(m => [m.id, m]));
}

/** Depth-first cycle detection over `dependsOn`. Returns the first cycle found. */
export function findDependencyCycle(missions: BlueprintMission[]): string[] | null {
    const byId = new Map(missions.map(m => [m.id, m]));
    const state = new Map<string, "visiting" | "done">();
    const stack: string[] = [];

    const visit = (id: string): string[] | null => {
        const s = state.get(id);
        if (s === "done") return null;
        if (s === "visiting") return [...stack.slice(stack.indexOf(id)), id];

        state.set(id, "visiting");
        stack.push(id);
        for (const dep of byId.get(id)?.dependsOn ?? []) {
            if (!byId.has(dep)) continue; // reported separately
            const cycle = visit(dep);
            if (cycle) return cycle;
        }
        stack.pop();
        state.set(id, "done");
        return null;
    };

    for (const m of missions) {
        const cycle = visit(m.id);
        if (cycle) return cycle;
    }
    return null;
}

/** Apply operations to a snapshot in memory, so the RESULT can be validated. */
export function projectOperations(
    snapshot: BlueprintSnapshot,
    operations: ChangeOperation[],
): BlueprintSnapshot {
    const missions = snapshot.missions.map(m => ({ ...m }));
    const byId = new Map(missions.map(m => [m.id, m]));

    for (const op of operations) {
        const id = String((op.payload as any)?.missionId ?? op.path ?? "");
        switch (op.kind) {
            case "remove_mission": {
                const idx = missions.findIndex(m => m.id === id);
                if (idx >= 0) missions.splice(idx, 1);
                break;
            }
            case "disable_mission": {
                const m = byId.get(id);
                if (m) m.disabled = true;
                break;
            }
            case "add_mission": {
                const mission = (op.payload as any)?.mission as BlueprintMission | undefined;
                if (mission?.id) missions.push({ ...mission });
                break;
            }
            case "update_mission": {
                const m = byId.get(id);
                const patch = (op.payload as any)?.mission as Partial<BlueprintMission> | undefined;
                if (m && patch) Object.assign(m, patch);
                break;
            }
            default:
                break;
        }
    }

    return { ...snapshot, missions };
}

export function validateBlueprintChange(
    snapshot: BlueprintSnapshot,
    operations: ChangeOperation[],
    runtime: RuntimeState,
): BlueprintValidationResult {
    const refusals: BlueprintRefusal[] = [];
    const warnings: BlueprintRefusal[] = [];
    const before = missionsById(snapshot);
    const after = projectOperations(snapshot, operations);
    const afterById = missionsById(after);

    const active = new Set(runtime.activeMissionIds);
    const completed = new Set(runtime.completedMissionIds ?? []);

    for (const op of operations) {
        const id = String((op.payload as any)?.missionId ?? op.path ?? "");
        if (!REMOVING_KINDS.has(op.kind) && op.kind !== "update_mission") continue;

        const mission = before.get(id);
        if (!mission) {
            refusals.push({
                code: "UNKNOWN_MISSION",
                missionId: id,
                reason: `Operation '${op.kind}' targets mission '${id}', which is not in the blueprint.`,
            });
            continue;
        }

        if (REMOVING_KINDS.has(op.kind)) {
            // An active step cannot be removed or have its contract changed.
            if (runtime.hasActiveExecution && active.has(id)) {
                refusals.push({
                    code: "ACTIVE_EXECUTION",
                    missionId: id,
                    reason: `Mission '${id}' is executing right now.`,
                    suggestion: "Quiesce the cycle at a safe checkpoint first, or scope the change to the next run.",
                });
            }
            if (runtime.hasActiveExecution && completed.has(id)) {
                refusals.push({
                    code: "COMPLETED_IN_CURRENT_RUN",
                    missionId: id,
                    reason: `Mission '${id}' already completed in the current run; its outputs are immutable for that run.`,
                    suggestion: "Apply this to the next run rather than the one in flight.",
                });
            }

            // Removing a gate is a governance change, not a structural one.
            const role = mission.role ?? "work";
            if (MANDATORY_ROLES.has(role)) {
                refusals.push({
                    code: "MANDATORY_GATE_REMOVED",
                    missionId: id,
                    reason: `Mission '${id}' serves a mandatory '${role}' function; removing it bypasses a required gate.`,
                    suggestion:
                        "Narrow it conditionally instead — retain the gate for low-confidence or elevated-risk cases and skip it only where the evidence actually supports skipping.",
                });
            }

            // Dependants left dangling.
            for (const other of after.missions) {
                if (other.id === id) continue;
                if ((other.dependsOn ?? []).includes(id)) {
                    refusals.push({
                        code: "DEPENDENCY_REFERENCE",
                        missionId: id,
                        reason: `Mission '${other.id}' depends on '${id}'.`,
                        suggestion: `Remove or re-point '${other.id}' first, or disable '${id}' conditionally instead of removing it.`,
                    });
                }
            }

            // Outputs someone still reads.
            for (const output of mission.outputs ?? []) {
                const stillProduced = after.missions.some(
                    m => m.id !== id && !m.disabled && (m.outputs ?? []).includes(output),
                );
                if (stillProduced) continue;
                for (const other of after.missions) {
                    if (other.id === id) continue;
                    if ((other.consumesOutputs ?? []).includes(output)) {
                        refusals.push({
                            code: "OUTPUT_CONSUMER",
                            missionId: id,
                            reason: `Mission '${other.id}' consumes output '${output}', which only '${id}' produces.`,
                            suggestion: `Provide '${output}' from another mission before removing '${id}'.`,
                        });
                    }
                }
            }
        }
    }

    // Deliverables that can no longer be produced by anything enabled.
    for (const deliverable of snapshot.deliverables ?? []) {
        const producible = deliverable.producedBy.some(mid => {
            const m = afterById.get(mid);
            return !!m && !m.disabled;
        });
        if (!producible) {
            refusals.push({
                code: "DELIVERABLE_UNPRODUCIBLE",
                missionId: deliverable.producedBy.join(","),
                reason: `Deliverable '${deliverable.name}' can no longer be produced by any enabled mission.`,
                suggestion: "Keep at least one producing mission enabled, or withdraw the deliverable explicitly.",
            });
        }
    }

    // Dependencies pointing at nothing, and cycles, in the RESULT.
    for (const mission of after.missions) {
        for (const dep of mission.dependsOn ?? []) {
            if (!afterById.has(dep)) {
                refusals.push({
                    code: "UNKNOWN_DEPENDENCY",
                    missionId: mission.id,
                    reason: `Mission '${mission.id}' would depend on '${dep}', which does not exist after this change.`,
                });
            }
        }
    }

    const cycle = findDependencyCycle(after.missions);
    if (cycle) {
        refusals.push({
            code: "DEPENDENCY_CYCLE",
            missionId: cycle[0],
            reason: `This change creates a dependency cycle: ${cycle.join(" → ")}.`,
        });
    }

    // Disabling a gate is not refused outright — it may be legitimate — but it
    // is never silent.
    for (const mission of after.missions) {
        const role = mission.role ?? "work";
        if (mission.disabled && MANDATORY_ROLES.has(role) && !before.get(mission.id)?.disabled) {
            warnings.push({
                code: "MANDATORY_GATE_REMOVED",
                missionId: mission.id,
                reason: `Mission '${mission.id}' is a '${role}' gate and would be disabled.`,
                suggestion: "Confirm this is intended and recorded; prefer a condition that narrows when it applies.",
            });
        }
    }

    return refusals.length === 0
        ? { ok: true, warnings }
        : { ok: false, refusals, warnings };
}

export class BlueprintValidationError extends Error {
    constructor(readonly refusals: BlueprintRefusal[]) {
        super(`Blueprint change refused: ${refusals.map(r => r.code).join(", ")}`);
        this.name = "BlueprintValidationError";
    }
}

export function assertBlueprintChangeValid(
    snapshot: BlueprintSnapshot,
    operations: ChangeOperation[],
    runtime: RuntimeState,
): void {
    const result = validateBlueprintChange(snapshot, operations, runtime);
    if (!result.ok) throw new BlueprintValidationError(result.refusals);
}
