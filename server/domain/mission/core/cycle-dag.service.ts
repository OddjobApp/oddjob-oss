/**
 * Cycle DAG Service — Phase 1 foundation for cycle-dependency orchestration.
 *
 * Single source of truth for turning the many legacy trigger/dependency formats
 * into one canonical dependency model, building a directed graph from it, and
 * answering structural questions about that graph:
 *
 *   - normalizeManifestMission()  → canonical deps from a raw YAML mission
 *                                    (handles all 7 legacy formats, maps id→name)
 *   - normalizeRuntimeBlueprint() → canonical deps from a persisted cycleBlueprint
 *                                    row (dependencies[] + webhook object trigger)
 *   - buildDag()                  → nodes + structural edges
 *   - detectCycles()              → every back-edge chain that would deadlock
 *   - computeWaves()              → topological waves (event/webhook edges excluded)
 *   - validateDag()              → one report: errors, warnings, cycles, waves
 *
 * Pure functions only — no DB, no I/O — so it is cheap to call at parse time and
 * trivial to unit-test. Persistence and the wave *dispatcher* land in Phase 2.
 *
 * Legacy trigger surface absorbed (verified across server/cycles/*.yaml):
 *   manual | on_launch | on_success(X) | on_failure(X) |
 *   on_intent(X, <cond>) | trigger:{type:webhook,...} | dependencies:[]
 */

export type DependencyType =
  | "finish_to_start"
  | "start_to_start"
  | "finish_to_finish"
  | "start_to_finish"
  | "event_trigger";

export type DependencyCondition = "completed" | "active" | "failed" | "any";

export interface DependencyOffset {
  value: number;
  unit: "minutes" | "hours" | "days" | "weeks" | "months" | "years";
  direction: "plus" | "minus";
}

export interface CanonicalDependency {
  /** Upstream blueprint name, or `webhook:<source>` for inbound event triggers. */
  upstream: string;
  type: DependencyType;
  condition: DependencyCondition;
  offset?: DependencyOffset;
  /** Raw expression for event_trigger conditions, e.g. "transition.to == 'Done'". */
  rawCondition?: string;
  /** True when the upstream is an external (webhook) source, not a blueprint. */
  external?: boolean;
  /** Per-dependency gate timeout override in minutes (falls back to the default). */
  timeoutMinutes?: number;
  /** What to do when the gate times out: "fail" (default) or "continue". */
  onTimeout?: "fail" | "continue";
}

export interface DagNode {
  name: string;
  /** Structural (non-event) upstream blueprint names this node waits on. */
  upstreams: string[];
  dependencies: CanonicalDependency[];
}

export interface CycleDag {
  nodes: Map<string, DagNode>;
  /** Structural edges only (event_trigger / external excluded). */
  edges: Array<{ from: string; to: string }>;
}

export interface DagValidationReport {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** Each detected dependency cycle as an ordered chain of node names. */
  cycles: string[][];
  /** Topological waves of node names (empty if a cycle was detected). */
  waves: string[][];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** A structural (schedulable) dependency participates in wave/cycle math. */
function isStructural(d: CanonicalDependency): boolean {
  return d.type !== "event_trigger" && !d.external;
}

/** Default target condition implied by a Gantt relationship type. */
function conditionForType(type: DependencyType): DependencyCondition {
  if (type === "start_to_start" || type === "start_to_finish") return "active";
  if (type === "event_trigger") return "any";
  return "completed";
}

function normalizeOffset(offset: any): DependencyOffset | undefined {
  if (!offset || typeof offset !== "object") return undefined;
  const value = Number(offset.value);
  if (!Number.isFinite(value) || value === 0) return undefined;
  const unit = ["minutes", "hours", "days", "weeks", "months", "years"].includes(offset.unit)
    ? offset.unit
    : "days";
  const direction = offset.direction === "minus" ? "minus" : "plus";
  return { value, unit, direction };
}

/**
 * Parse a string-form trigger into a canonical dependency, or null when the
 * trigger implies no dependency (manual / on_launch / unknown).
 * `resolve` maps a YAML mission id to its blueprint name (identity if absent).
 */
export function parseTriggerString(
  trigger: string,
  resolve: (id: string) => string = (x) => x
): CanonicalDependency | null {
  const t = trigger.trim();
  if (t === "manual" || t === "on_launch" || t === "") return null;

  let m = t.match(/^on_success\(([^)]+)\)$/);
  if (m) return { upstream: resolve(m[1].trim()), type: "finish_to_start", condition: "completed" };

  m = t.match(/^on_failure\(([^)]+)\)$/);
  if (m) return { upstream: resolve(m[1].trim()), type: "finish_to_start", condition: "failed" };

  // on_intent(<id>, <condition>) — split on the FIRST comma; condition may contain commas.
  m = t.match(/^on_intent\(\s*([^,]+?)\s*,\s*(.+)\)$/);
  if (m) {
    return {
      upstream: resolve(m[1].trim()),
      type: "event_trigger",
      condition: "any",
      rawCondition: m[2].trim(),
    };
  }

  return null; // unrecognized string form — caller may warn
}

/**
 * Parse an object-form trigger into a canonical dependency, or null when the
 * trigger implies no dependency. Handles the inbound webhook form
 * (`{type:webhook, source}`) plus the mission-to-mission forms that mirror the
 * string grammar: `{type:on_success|on_failure|on_intent, mission_ref}`.
 * `resolve` maps a YAML mission id → blueprint name (identity if absent); it is
 * required to make on_* object triggers produce edges that match node names.
 */
function parseTriggerObject(
  trigger: any,
  resolve: (id: string) => string = (x) => x
): CanonicalDependency | null {
  if (!trigger || typeof trigger !== "object") return null;

  if (trigger.type === "webhook" && trigger.source) {
    return {
      upstream: `webhook:${trigger.source}`,
      type: "event_trigger",
      condition: "any",
      rawCondition: trigger.condition,
      external: true,
    };
  }

  // Mission-to-mission object triggers. The upstream mission id lives under
  // `mission_ref` (canonical) or a few tolerated aliases.
  const ref = trigger.mission_ref ?? trigger.missionRef ?? trigger.ref ?? trigger.upstream;
  if (typeof ref === "string" && ref.trim()) {
    const upstream = resolve(ref.trim());
    const timeoutRaw = trigger.timeout_minutes ?? trigger.timeoutMinutes;
    const timeoutMinutes = Number(timeoutRaw) > 0 ? Number(timeoutRaw) : undefined;
    const onTimeout = trigger.on_timeout === "continue" || trigger.onTimeout === "continue" ? "continue" : undefined;
    const extra = {
      ...(timeoutMinutes ? { timeoutMinutes } : {}),
      ...(onTimeout ? { onTimeout: onTimeout as "continue" } : {}),
    };
    switch (trigger.type) {
      case "on_success":
        return { upstream, type: "finish_to_start", condition: "completed", ...extra };
      case "on_failure":
        return { upstream, type: "finish_to_start", condition: "failed", ...extra };
      case "on_intent":
        return { upstream, type: "event_trigger", condition: "any", rawCondition: trigger.condition, ...extra };
    }
  }

  return null;
}

/** Coerce a single dependency entry (legacy or canonical) into canonical form. */
function coerceDependencyEntry(dep: any, resolve: (id: string) => string = (x) => x): CanonicalDependency | null {
  if (!dep || typeof dep !== "object") return null;
  // Already-canonical shape
  const upstreamRaw = dep.upstream ?? dep.blueprintName ?? dep.name;
  if (!upstreamRaw || typeof upstreamRaw !== "string") return null;
  const type: DependencyType = dep.type && [
    "finish_to_start", "start_to_start", "finish_to_finish", "start_to_finish", "event_trigger",
  ].includes(dep.type) ? dep.type : "finish_to_start";
  const condition: DependencyCondition = dep.condition && ["completed", "active", "failed", "any"].includes(dep.condition)
    ? dep.condition
    : conditionForType(type);
  const external = type === "event_trigger" && upstreamRaw.startsWith("webhook:");
  const timeoutRaw = dep.timeout_minutes ?? dep.timeoutMinutes;
  const timeoutMinutes = Number(timeoutRaw) > 0 ? Number(timeoutRaw) : undefined;
  const onTimeout = dep.on_timeout === "continue" || dep.onTimeout === "continue" ? "continue" : undefined;
  return {
    upstream: external ? upstreamRaw : resolve(upstreamRaw),
    type,
    condition,
    offset: normalizeOffset(dep.offset),
    rawCondition: dep.rawCondition ?? dep.condition,
    external,
    ...(timeoutMinutes ? { timeoutMinutes } : {}),
    ...(onTimeout ? { onTimeout } : {}),
  };
}

/** De-duplicate canonical deps on (upstream, type, condition). */
function dedupe(deps: CanonicalDependency[]): CanonicalDependency[] {
  const seen = new Set<string>();
  const out: CanonicalDependency[] = [];
  for (const d of deps) {
    const key = `${d.upstream}|${d.type}|${d.condition}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

// ─── Normalizers ──────────────────────────────────────────────────────────────

/**
 * Install-time: canonical deps from a raw YAML mission. Absorbs the full legacy
 * trigger surface and maps mission ids → blueprint names via `idToName`.
 * Unresolved upstream ids are kept as-is and surfaced by validateDag().
 */
export function normalizeManifestMission(
  mission: any,
  idToName: Record<string, string> = {}
): CanonicalDependency[] {
  const resolve = (id: string) => idToName[id] ?? id;
  const deps: CanonicalDependency[] = [];

  if (typeof mission?.trigger === "string") {
    const parsed = parseTriggerString(mission.trigger, resolve);
    if (parsed) deps.push(parsed);
  } else if (mission?.trigger && typeof mission.trigger === "object") {
    const parsed = parseTriggerObject(mission.trigger, resolve);
    if (parsed) deps.push(parsed);
  }

  if (Array.isArray(mission?.dependencies)) {
    for (const d of mission.dependencies) {
      const c = coerceDependencyEntry(d, resolve);
      if (c) deps.push(c);
    }
  }
  if (Array.isArray(mission?.dependsOn)) {
    for (const name of mission.dependsOn) {
      if (typeof name === "string") deps.push({ upstream: resolve(name), type: "finish_to_start", condition: "completed" });
    }
  }

  return dedupe(deps);
}

/**
 * Runtime: canonical deps from a persisted cycleBlueprint row. Uses the already
 * name-resolved `dependencies[]` plus an object-form webhook `config.trigger`.
 * Mission-ref triggers (string OR object `on_*` forms) are NOT re-parsed here —
 * at runtime they reference YAML ids, which would not match the resolved names
 * already present in `dependencies[]`. Only the external webhook form (which
 * needs no id resolution) is honored from the trigger at runtime.
 */
export function normalizeRuntimeBlueprint(bp: any): CanonicalDependency[] {
  const deps: CanonicalDependency[] = [];

  if (Array.isArray(bp?.dependencies)) {
    for (const d of bp.dependencies) {
      const c = coerceDependencyEntry(d);
      if (c) deps.push(c);
    }
  }
  if (Array.isArray(bp?.dependsOn)) {
    for (const name of bp.dependsOn) {
      if (typeof name === "string") deps.push({ upstream: name, type: "finish_to_start", condition: "completed" });
    }
  }
  const trigger = bp?.config?.trigger ?? bp?.trigger;
  if (trigger?.type === "webhook") {
    const objTrigger = parseTriggerObject(trigger);
    if (objTrigger) deps.push(objTrigger);
  }

  return dedupe(deps);
}

// ─── Graph ────────────────────────────────────────────────────────────────────

/**
 * Build a DAG from blueprints already paired with their canonical dependencies.
 * Only structural (non-event, non-external) deps become edges.
 */
export function buildDag(
  blueprints: Array<{ name: string; dependencies: CanonicalDependency[] }>
): CycleDag {
  const nodes = new Map<string, DagNode>();
  for (const bp of blueprints) {
    const structural = bp.dependencies.filter(isStructural).map((d) => d.upstream);
    nodes.set(bp.name, { name: bp.name, upstreams: structural, dependencies: bp.dependencies });
  }
  const edges: Array<{ from: string; to: string }> = [];
  for (const node of nodes.values()) {
    for (const up of node.upstreams) {
      if (nodes.has(up)) edges.push({ from: up, to: node.name });
    }
  }
  return { nodes, edges };
}

/**
 * Detect dependency cycles via DFS. Returns each cycle as an ordered chain
 * (e.g. ["a","b","a"]). Empty array means the graph is acyclic.
 */
export function detectCycles(dag: CycleDag): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const name of dag.nodes.keys()) adjacency.set(name, []);
  for (const e of dag.edges) adjacency.get(e.from)!.push(e.to);

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const name of dag.nodes.keys()) color.set(name, WHITE);
  const cycles: string[][] = [];
  const stack: string[] = [];

  const visit = (n: string) => {
    color.set(n, GRAY);
    stack.push(n);
    for (const next of adjacency.get(n) ?? []) {
      if (color.get(next) === GRAY) {
        const idx = stack.indexOf(next);
        cycles.push([...stack.slice(idx), next]);
      } else if (color.get(next) === WHITE) {
        visit(next);
      }
    }
    stack.pop();
    color.set(n, BLACK);
  };

  for (const name of dag.nodes.keys()) {
    if (color.get(name) === WHITE) visit(name);
  }
  return cycles;
}

/**
 * Topological waves via Kahn's algorithm over structural edges. Nodes with no
 * structural upstream are wave 0; each subsequent wave depends only on earlier
 * waves. Returns [] if the graph has a cycle (no valid ordering).
 */
export function computeWaves(dag: CycleDag): string[][] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const name of dag.nodes.keys()) {
    indegree.set(name, 0);
    dependents.set(name, []);
  }
  for (const e of dag.edges) {
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    dependents.get(e.from)!.push(e.to);
  }

  const waves: string[][] = [];
  let frontier = [...dag.nodes.keys()].filter((n) => (indegree.get(n) ?? 0) === 0).sort();
  let placed = 0;

  while (frontier.length > 0) {
    waves.push(frontier);
    placed += frontier.length;
    const next: string[] = [];
    for (const n of frontier) {
      for (const dep of dependents.get(n) ?? []) {
        const d = (indegree.get(dep) ?? 0) - 1;
        indegree.set(dep, d);
        if (d === 0) next.push(dep);
      }
    }
    frontier = next.sort();
  }

  return placed === dag.nodes.size ? waves : []; // [] signals an unresolved cycle
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate a set of blueprints (already paired with canonical dependencies) and
 * return a single report. Surfaces: cycles, undeclared upstreams, self-deps, and
 * dangling event triggers. `valid` is false only on errors (cycles / self-deps);
 * undeclared upstreams are warnings (the downstream would simply never gate).
 */
export function validateDag(
  blueprints: Array<{ name: string; dependencies: CanonicalDependency[] }>
): DagValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const names = new Set(blueprints.map((b) => b.name));

  for (const bp of blueprints) {
    for (const dep of bp.dependencies) {
      if (dep.upstream === bp.name) {
        errors.push(`Blueprint "${bp.name}" depends on itself`);
        continue;
      }
      if (dep.external) continue; // webhook sources are not blueprints
      if (!names.has(dep.upstream)) {
        if (dep.type === "event_trigger") {
          warnings.push(`Blueprint "${bp.name}" event-triggers on "${dep.upstream}", which is not a declared blueprint`);
        } else {
          warnings.push(`Blueprint "${bp.name}" depends on "${dep.upstream}", which is not declared — it will run without waiting`);
        }
      }
    }
  }

  const dag = buildDag(blueprints);
  const cycles = detectCycles(dag);
  for (const chain of cycles) {
    errors.push(`Dependency cycle: ${chain.join(" → ")}`);
  }

  const waves = cycles.length === 0 ? computeWaves(dag) : [];
  return { valid: errors.length === 0, errors, warnings, cycles, waves };
}

/**
 * Defensively break dependency cycles by removing each cycle's closing back-edge.
 * Returns a new blueprint list plus the removed edges. Used at runtime so a
 * mis-authored cyclic cycle degrades to "runs without that one gate" instead of
 * deadlocking every branch on 30-minute gate timeouts. Idempotent on acyclic input.
 */
export function breakCycles(
  blueprints: Array<{ name: string; dependencies: CanonicalDependency[] }>
): { blueprints: Array<{ name: string; dependencies: CanonicalDependency[] }>; removed: Array<{ from: string; to: string }> } {
  const work = blueprints.map((b) => ({ name: b.name, dependencies: [...b.dependencies] }));
  const removed: Array<{ from: string; to: string }> = [];

  for (let guard = 0; guard < 1000; guard++) {
    const cycles = detectCycles(buildDag(work));
    if (cycles.length === 0) break;
    const chain = cycles[0];
    const from = chain[chain.length - 2];
    const to = chain[chain.length - 1];
    const node = work.find((b) => b.name === to);
    if (!node) break;
    const before = node.dependencies.length;
    node.dependencies = node.dependencies.filter((d) => !(d.upstream === from && isStructural(d)));
    if (node.dependencies.length === before) break; // nothing removed — avoid infinite loop
    removed.push({ from, to });
  }

  return { blueprints: work, removed };
}

// ─── Critical path (CPM) ──────────────────────────────────────────────────────

export interface CpmNode {
  name: string;
  earliestStart: number;
  earliestFinish: number;
  latestStart: number;
  latestFinish: number;
  float: number;
  onCriticalPath: boolean;
  durationMs: number;
}

export interface CpmResult {
  nodes: Map<string, CpmNode>;
  /** Ordered chain of zero-float nodes (the critical path). */
  criticalPath: string[];
  /** Total project duration in ms (max earliest-finish). */
  projectDurationMs: number;
}

/**
 * Critical Path Method over the structural DAG. Forward pass computes earliest
 * start/finish; backward pass computes latest start/finish; float = latest−earliest;
 * the critical path is the zero-float chain that bounds total duration.
 *
 * `durationOf(name)` supplies each node's duration in ms (default 1 unit). Returns
 * null if the graph has a cycle (no valid ordering — caller should validate first).
 */
export function computeCriticalPath(
  dag: CycleDag,
  durationOf: (name: string) => number = () => 1
): CpmResult | null {
  const waves = computeWaves(dag);
  if (waves.length === 0 && dag.nodes.size > 0) return null; // cyclic
  const topo = waves.flat();

  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  for (const name of dag.nodes.keys()) {
    preds.set(name, []);
    succs.set(name, []);
  }
  for (const e of dag.edges) {
    succs.get(e.from)!.push(e.to);
    preds.get(e.to)!.push(e.from);
  }

  const dur = new Map<string, number>();
  for (const name of dag.nodes.keys()) dur.set(name, Math.max(0, durationOf(name) || 0));

  const es = new Map<string, number>();
  const ef = new Map<string, number>();
  // Forward pass (topological order)
  for (const n of topo) {
    const start = (preds.get(n) ?? []).reduce((mx, p) => Math.max(mx, ef.get(p) ?? 0), 0);
    es.set(n, start);
    ef.set(n, start + (dur.get(n) ?? 0));
  }

  const projectDurationMs = topo.reduce((mx, n) => Math.max(mx, ef.get(n) ?? 0), 0);

  const ls = new Map<string, number>();
  const lf = new Map<string, number>();
  // Backward pass (reverse topological order)
  for (let i = topo.length - 1; i >= 0; i--) {
    const n = topo[i];
    const finish = (succs.get(n) ?? []).length === 0
      ? projectDurationMs
      : (succs.get(n) ?? []).reduce((mn, s) => Math.min(mn, ls.get(s) ?? projectDurationMs), Infinity);
    lf.set(n, finish);
    ls.set(n, finish - (dur.get(n) ?? 0));
  }

  const EPSILON = 1e-6;
  const nodes = new Map<string, CpmNode>();
  for (const n of topo) {
    const float = (ls.get(n) ?? 0) - (es.get(n) ?? 0);
    nodes.set(n, {
      name: n,
      earliestStart: es.get(n) ?? 0,
      earliestFinish: ef.get(n) ?? 0,
      latestStart: ls.get(n) ?? 0,
      latestFinish: lf.get(n) ?? 0,
      float,
      onCriticalPath: Math.abs(float) < EPSILON,
      durationMs: dur.get(n) ?? 0,
    });
  }

  // Build the critical chain by walking zero-float nodes from a critical root,
  // following critical successors in earliest-start order.
  const criticalPath: string[] = [];
  const isCritical = (n: string) => nodes.get(n)?.onCriticalPath;
  let current = topo.find(n => isCritical(n) && (preds.get(n) ?? []).every(p => !isCritical(p)));
  const guard = new Set<string>();
  while (current && !guard.has(current)) {
    criticalPath.push(current);
    guard.add(current);
    const nextCritical = (succs.get(current) ?? [])
      .filter(isCritical)
      .sort((a, b) => (es.get(a) ?? 0) - (es.get(b) ?? 0));
    current = nextCritical[0];
  }

  return { nodes, criticalPath, projectDurationMs };
}

export const cycleDagService = {
  parseTriggerString,
  normalizeManifestMission,
  normalizeRuntimeBlueprint,
  buildDag,
  detectCycles,
  computeWaves,
  validateDag,
  breakCycles,
  computeCriticalPath,
};
