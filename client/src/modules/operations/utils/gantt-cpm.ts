/**
 * Critical Path Method (CPM) engine for Gantt scheduling.
 *
 * Supports all four dependency types:
 *   FS  Finish-to-Start  : successor starts after predecessor finishes   (+ optional lag)
 *   SS  Start-to-Start   : successor starts after predecessor starts      (+ optional lag)
 *   FF  Finish-to-Finish : successor finishes after predecessor finishes  (+ optional lag)
 *   SF  Start-to-Finish  : successor finishes after predecessor starts    (+ optional lag)
 *
 * Lead is expressed as a negative offset, lag as a positive offset.
 * All time values are in fractional days.
 */

import type { Blueprint, Dependency, TimeUnit } from "../data/cycle-templates";

export interface GanttTask {
    name: string;
    blueprint: Blueprint;
    /** Working duration in configured time units (0 for milestones) */
    duration: number;
    /** Earliest Start — offset from cycle Start in configured time units */
    earlyStart: number;
    /** Earliest Finish */
    earlyFinish: number;
    /** Latest Start — without delaying project end */
    lateStart: number;
    /** Latest Finish */
    lateFinish: number;
    /** Dependency-only minimum start (ignoring scheduledStart constraint) */
    depMinStart: number;
    /** Total float (slack) in configured time units */
    totalFloat: number;
    /** True when totalFloat === 0 — on the critical path */
    isCritical: boolean;
    /** True when a manual scheduledStart constraint is active */
    isManuallyScheduled: boolean;
    /** Milestones render as diamonds, not bars */
    isMilestone: boolean;
    /** Row index after topological sort */
    rowIndex: number;
}

// ── Unit scale factors ────────────────────────────────────────────────────────

export const MS_PER_UNIT: Record<TimeUnit, number> = {
    ms: 1,
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000,
    w: 604800000,
    M: 2629746000, // ~30.44 days
};

const OFFSET_MS: Record<string, number> = {
    ms: 1,
    milliseconds: 1,
    s: 1000,
    seconds: 1000,
    m: 60000,
    minutes: 60000,
    h: 3600000,
    hours: 3600000,
    d: 86400000,
    days: 86400000,
    w: 604800000,
    weeks: 604800000,
    M: 2629746000,
    months: 2629746000,
    years: 31557600000,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a Dependency offset struct → signed active units */
function offsetToUnits(offset: Dependency["offset"] | undefined, activeUnit: TimeUnit): number {
    if (!offset) return 0;
    const msVal = offset.value * (OFFSET_MS[offset.unit] ?? 86400000);
    const units = msVal / MS_PER_UNIT[activeUnit];
    return offset.direction === "minus" ? -units : units;
}

/** Topological sort via DFS — returns names in execution order */
function topoSort(blueprints: Blueprint[]): string[] {
    const adj = new Map<string, string[]>();
    const all = new Set(blueprints.map(b => b.name).filter(Boolean));

    for (const bp of blueprints) {
        const deps: string[] = [
            ...(bp.dependencies ?? []).map(d => d.blueprintName),
            ...(bp.dependsOn ?? []),
        ].filter(n => all.has(n));
        adj.set(bp.name, deps);
    }

    const visited = new Set<string>();
    const result: string[] = [];

    function visit(name: string, stack = new Set<string>()) {
        if (visited.has(name)) return;
        if (stack.has(name)) return; // cycle — skip to avoid infinite loop
        stack.add(name);
        for (const dep of (adj.get(name) ?? [])) visit(dep, new Set(stack));
        visited.add(name);
        result.push(name);
    }

    for (const bp of blueprints) { if (bp.name) visit(bp.name); }
    return result; // ancestors before descendants
}

// ── Main export ───────────────────────────────────────────────────────────────

export function getBlueprintDuration(bp: Blueprint, activeUnit: TimeUnit): number {
    if (bp.type === "milestone") return 0;
    if (bp.estimatedDuration !== undefined) return bp.estimatedDuration;
    if (bp.estimatedDays !== undefined) return bp.estimatedDays;
    if (bp.avgRuntime !== undefined) return bp.avgRuntime / MS_PER_UNIT[activeUnit];
    return 1;
}

export function computeGanttLayout(blueprints: Blueprint[], activeUnit: TimeUnit = "d"): GanttTask[] {
    const valid = blueprints.filter(b => b.name);
    if (valid.length === 0) return [];

    const byName = new Map(valid.map(b => [b.name, b]));
    const order = topoSort(valid);

    // ── Forward pass: compute ES / EF ────────────────────────────────────────

    const ES = new Map<string, number>();
    const EF = new Map<string, number>();

    // Store dependency-only ES before applying scheduledStart
    const DEP_ES = new Map<string, number>();

    for (const name of order) {
        const bp = byName.get(name)!;
        const duration = getBlueprintDuration(bp, activeUnit);
        let es = 0;
        let ef = duration;

        // Collect all incoming dependency constraints
        const allDeps: { predName: string; type: Dependency["type"]; offsetUnits: number }[] = [
            ...(bp.dependencies ?? []).map(d => ({
                predName: d.blueprintName,
                type: d.type,
                offsetUnits: offsetToUnits(d.offset, activeUnit),
            })),
            ...(bp.dependsOn ?? []).map(n => ({
                predName: n,
                type: "finish_to_start" as Dependency["type"],
                offsetUnits: 0,
            })),
        ].filter(d => byName.has(d.predName));

        for (const { predName, type, offsetUnits } of allDeps) {
            const predES = ES.get(predName) ?? 0;
            const predEF = EF.get(predName) ?? 0;

            switch (type) {
                case "finish_to_start":
                    es = Math.max(es, predEF + offsetUnits);
                    break;
                case "start_to_start":
                    es = Math.max(es, predES + offsetUnits);
                    break;
                case "finish_to_finish":
                    // successor must finish ≥ predEF + offset → ES ≥ predEF + offset - duration
                    es = Math.max(es, predEF + offsetUnits - duration);
                    ef = Math.max(ef, predEF + offsetUnits);
                    break;
                case "start_to_finish":
                    // successor must finish ≥ predES + offset → ES ≥ predES + offset - duration
                    es = Math.max(es, predES + offsetUnits - duration);
                    ef = Math.max(ef, predES + offsetUnits);
                    break;
            }
        }

        es = Math.max(0, es);
        ef = Math.max(es + duration, ef);

        // Record dep-only ES before applying manual constraint
        DEP_ES.set(name, es);

        // Apply scheduledStart: user-placed start floor (cannot drag earlier than dep minimum)
        const scheduledStart = byName.get(name)?.scheduledStart;
        if (scheduledStart !== undefined && scheduledStart > es) {
            es = scheduledStart;
            ef = es + duration;
        }

        ES.set(name, es);
        EF.set(name, ef);
    }

    const projectEnd = Math.max(...[...EF.values()], 1);

    // ── Backward pass: compute LS / LF ───────────────────────────────────────

    const LS = new Map<string, number>();
    const LF = new Map<string, number>();

    // Build successor map
    const successors = new Map<string, { succName: string; type: Dependency["type"]; offsetUnits: number }[]>();
    for (const bp of valid) {
        const allDeps: { predName: string; type: Dependency["type"]; offsetUnits: number }[] = [
            ...(bp.dependencies ?? []).map(d => ({
                predName: d.blueprintName,
                type: d.type,
                offsetUnits: offsetToUnits(d.offset, activeUnit),
            })),
            ...(bp.dependsOn ?? []).map(n => ({
                predName: n,
                type: "finish_to_start" as Dependency["type"],
                offsetUnits: 0,
            })),
        ].filter(d => byName.has(d.predName));

        for (const dep of allDeps) {
            if (!successors.has(dep.predName)) successors.set(dep.predName, []);
            successors.get(dep.predName)!.push({ succName: bp.name, type: dep.type, offsetUnits: dep.offsetUnits });
        }
    }

    for (const name of [...order].reverse()) {
        const bp = byName.get(name)!;
        const duration = getBlueprintDuration(bp, activeUnit);
        const succs = successors.get(name) ?? [];

        let lf = projectEnd;
        let ls = projectEnd - duration;

        for (const { succName, type, offsetUnits } of succs) {
            const succLS = LS.get(succName) ?? projectEnd - getBlueprintDuration(byName.get(succName)!, activeUnit);
            const succLF = LF.get(succName) ?? projectEnd;

            switch (type) {
                case "finish_to_start":
                    lf = Math.min(lf, succLS - offsetUnits);
                    ls = lf - duration;
                    break;
                case "start_to_start":
                    ls = Math.min(ls, succLS - offsetUnits);
                    lf = ls + duration;
                    break;
                case "finish_to_finish":
                    lf = Math.min(lf, succLF - offsetUnits);
                    ls = lf - duration;
                    break;
                case "start_to_finish":
                    ls = Math.min(ls, succLF - offsetUnits);
                    lf = ls + duration;
                    break;
            }
        }

        lf = Math.max(lf, ls + duration);
        LS.set(name, lf - duration);
        LF.set(name, lf);
    }

    // ── Assemble result ───────────────────────────────────────────────────────

    return order.map((name, rowIndex) => {
        const bp = byName.get(name)!;
        const duration = getBlueprintDuration(bp, activeUnit);
        const es = ES.get(name) ?? 0;
        const ef = EF.get(name) ?? duration;
        const ls = LS.get(name) ?? es;
        const lf = LF.get(name) ?? ef;
        const totalFloat = Math.max(0, Math.round((ls - es) * 100) / 100);

        const depMinStart = DEP_ES.get(name) ?? 0;

        return {
            name,
            blueprint: bp,
            duration,
            earlyStart: es,
            earlyFinish: ef,
            lateStart: ls,
            lateFinish: lf,
            depMinStart,
            totalFloat,
            isCritical: totalFloat < 0.01,
            isManuallyScheduled: bp.scheduledStart !== undefined && bp.scheduledStart > depMinStart,
            isMilestone: bp.type === "milestone",
            rowIndex,
        };
    });
}

// ── Date helpers used by the chart ───────────────────────────────────────────

function addWorkingDays(baseDate: Date, days: number): Date {
    let current = new Date(baseDate.getTime());
    let sign = Math.sign(days);
    let remainingMs = Math.abs(days) * 24 * 60 * 60 * 1000;
    
    if (remainingMs === 0) return current;
    
    while (remainingMs > 0) {
        if (sign >= 0) {
            // Moving forward. Find end of today (next midnight)
            const nextMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
            const msToMidnight = nextMidnight.getTime() - current.getTime();
            const day = current.getDay();
            
            if (day !== 0 && day !== 6) {
                if (remainingMs <= msToMidnight) {
                    current.setTime(current.getTime() + remainingMs);
                    remainingMs = 0;
                } else {
                    current = nextMidnight;
                    remainingMs -= msToMidnight;
                }
            } else {
                current = nextMidnight;
            }
        } else {
            // Moving backward. Find start of today (previous midnight)
            const prevMidnight = new Date(current.getFullYear(), current.getMonth(), current.getDate());
            let msFromMidnight = current.getTime() - prevMidnight.getTime();
            if (msFromMidnight === 0) {
                prevMidnight.setDate(prevMidnight.getDate() - 1);
                msFromMidnight = 24 * 60 * 60 * 1000;
            }
            
            const testDate = new Date(current.getTime() - 1);
            const day = testDate.getDay();
            
            if (day !== 0 && day !== 6) {
                if (remainingMs <= msFromMidnight) {
                    current.setTime(current.getTime() - remainingMs);
                    remainingMs = 0;
                } else {
                    current = prevMidnight;
                    remainingMs -= msFromMidnight;
                }
            } else {
                current = prevMidnight;
            }
        }
    }
    return current;
}

function workingDaysBetween(a: Date, b: Date): number {
    const start = new Date(Math.min(a.getTime(), b.getTime()));
    const end = new Date(Math.max(a.getTime(), b.getTime()));
    const sign = a.getTime() <= b.getTime() ? 1 : -1;
    
    let totalMs = 0;
    let current = new Date(start.getTime());
    
    while (current < end) {
        const nextDay = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
        const segmentEnd = nextDay < end ? nextDay : end;
        const day = current.getDay();
        if (day !== 0 && day !== 6) {
            totalMs += segmentEnd.getTime() - current.getTime();
        }
        current = segmentEnd;
    }
    
    return (totalMs / (24 * 60 * 60 * 1000)) * sign;
}

/** Add fractional units to a Date */
export function addUnits(base: Date, value: number, unit: TimeUnit, excludeWeekends?: boolean): Date {
    if (excludeWeekends && unit === "d") {
        return addWorkingDays(base, value);
    }
    return new Date(base.getTime() + value * MS_PER_UNIT[unit]);
}

/** Units between two dates (fractional) */
export function unitsBetween(a: Date, b: Date, unit: TimeUnit, excludeWeekends?: boolean): number {
    if (excludeWeekends && unit === "d") {
        return workingDaysBetween(a, b);
    }
    return (b.getTime() - a.getTime()) / MS_PER_UNIT[unit];
}

/** Add fractional days to a Date (legacy wrapper) */
export function addDays(base: Date, days: number, excludeWeekends?: boolean): Date {
    return addUnits(base, days, "d", excludeWeekends);
}

/** Days between two dates (fractional) (legacy wrapper) */
export function daysBetween(a: Date, b: Date, excludeWeekends?: boolean): number {
    return unitsBetween(a, b, "d", excludeWeekends);
}

/** Format a Date as "D MMM" (e.g. "3 Jun") */
export function fmtAxisDate(d: Date): string {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Check if the current order of blueprints violates dependencies */
export function checkDependencyViolations(blueprints: Blueprint[]): string[] {
    const violations: string[] = [];
    const indexMap = new Map<string, number>();
    
    blueprints.forEach((bp, idx) => {
        if (bp.name) indexMap.set(bp.name, idx);
    });

    for (const bp of blueprints) {
        if (!bp.name) continue;
        const currentIndex = indexMap.get(bp.name)!;
        
        const allDeps = [
            ...(bp.dependencies ?? []).map(d => d.blueprintName),
            ...(bp.dependsOn ?? []),
        ];

        for (const predName of allDeps) {
            const predIndex = indexMap.get(predName);
            if (predIndex !== undefined && predIndex > currentIndex) {
                violations.push(`Dependency Conflict: "${bp.name}" depends on "${predName}", but is placed before it.`);
            }
        }
    }
    
    return violations;
}
