import { describe, it, expect } from "vitest";
import {
  parseTriggerString,
  normalizeManifestMission,
  normalizeRuntimeBlueprint,
  buildDag,
  detectCycles,
  computeWaves,
  validateDag,
  breakCycles,
  computeCriticalPath,
  type CanonicalDependency,
} from "./cycle-dag.service.js";

const pair = (name: string, dependencies: CanonicalDependency[]) => ({ name, dependencies });

describe("parseTriggerString — legacy trigger surface", () => {
  it("treats manual / on_launch / empty as no dependency", () => {
    expect(parseTriggerString("manual")).toBeNull();
    expect(parseTriggerString("on_launch")).toBeNull();
    expect(parseTriggerString("")).toBeNull();
  });

  it("maps on_success(X) → finish_to_start / completed", () => {
    expect(parseTriggerString("on_success(mission-1)")).toEqual({
      upstream: "mission-1", type: "finish_to_start", condition: "completed",
    });
  });

  it("maps on_failure(X) → finish_to_start / failed", () => {
    expect(parseTriggerString("on_failure(mission-1)")).toEqual({
      upstream: "mission-1", type: "finish_to_start", condition: "failed",
    });
  });

  it("maps on_intent(X, cond) → event_trigger, keeping a comma-containing condition", () => {
    expect(parseTriggerString("on_intent(mission-asset-triage, intent_type in ['restock', 'feedback'])")).toEqual({
      upstream: "mission-asset-triage",
      type: "event_trigger",
      condition: "any",
      rawCondition: "intent_type in ['restock', 'feedback']",
    });
  });

  it("resolves ids → names via the resolver", () => {
    expect(parseTriggerString("on_success(m1)", (id) => (id === "m1" ? "Mission One" : id))).toEqual({
      upstream: "Mission One", type: "finish_to_start", condition: "completed",
    });
  });

  it("returns null for unrecognized strings", () => {
    expect(parseTriggerString("whenever_i_feel_like_it")).toBeNull();
  });
});

describe("normalizeManifestMission — install-time (YAML)", () => {
  it("handles object-form webhook triggers as external event deps", () => {
    const deps = normalizeManifestMission({ trigger: { type: "webhook", source: "jira", condition: "x == 1" } });
    expect(deps).toEqual([{
      upstream: "webhook:jira", type: "event_trigger", condition: "any", rawCondition: "x == 1", external: true,
    }]);
  });

  it("maps object-form { type: on_success, mission_ref } → finish_to_start / completed, resolving id→name", () => {
    const deps = normalizeManifestMission(
      { trigger: { type: "on_success", mission_ref: "context-load" } },
      { "context-load": "Repository Context Loading" }
    );
    expect(deps).toEqual([{
      upstream: "Repository Context Loading", type: "finish_to_start", condition: "completed",
    }]);
  });

  it("maps object-form { type: on_failure, mission_ref } → finish_to_start / failed", () => {
    const deps = normalizeManifestMission(
      { trigger: { type: "on_failure", mission_ref: "m1" } },
      { m1: "One" }
    );
    expect(deps).toEqual([{ upstream: "One", type: "finish_to_start", condition: "failed" }]);
  });

  it("maps object-form { type: on_intent, mission_ref, condition } → event_trigger", () => {
    const deps = normalizeManifestMission(
      { trigger: { type: "on_intent", mission_ref: "m1", condition: "state == 'ready'" } },
      { m1: "One" }
    );
    expect(deps).toEqual([{
      upstream: "One", type: "event_trigger", condition: "any", rawCondition: "state == 'ready'",
    }]);
  });

  it("carries timeout_minutes / on_timeout on object-form on_success triggers", () => {
    const deps = normalizeManifestMission(
      { trigger: { type: "on_success", mission_ref: "m1", timeout_minutes: 90, on_timeout: "continue" } },
      { m1: "One" }
    );
    expect(deps[0].timeoutMinutes).toBe(90);
    expect(deps[0].onTimeout).toBe("continue");
  });

  it("regression: a six-mission chain wired with object on_success triggers yields a linear DAG (not all wave 0)", () => {
    // Mirrors autonomous-codegen.cycle.yaml: root uses an unrecognized string
    // trigger, the rest chain via object { type: on_success, mission_ref }.
    const idToName: Record<string, string> = {
      "context-load": "Repository Context Loading",
      "change-plan": "Multi-File Change Planning",
      "apply-edits": "Apply Edits",
      "test-loop": "Self-Healing Test Loop",
      "quality-gate": "Quality Gate Evaluation",
      "pr-generation": "Pull Request Generation",
    };
    const missions = [
      { id: "context-load", name: idToName["context-load"], trigger: "session_start" },
      { id: "change-plan", name: idToName["change-plan"], trigger: { type: "on_success", mission_ref: "context-load" } },
      { id: "apply-edits", name: idToName["apply-edits"], trigger: { type: "on_success", mission_ref: "change-plan" } },
      { id: "test-loop", name: idToName["test-loop"], trigger: { type: "on_success", mission_ref: "apply-edits" } },
      { id: "quality-gate", name: idToName["quality-gate"], trigger: { type: "on_success", mission_ref: "test-loop" } },
      { id: "pr-generation", name: idToName["pr-generation"], trigger: { type: "on_success", mission_ref: "quality-gate" } },
    ];
    const blueprints = missions.map((m) => pair(m.name, normalizeManifestMission(m, idToName)));
    const report = validateDag(blueprints);

    expect(report.valid).toBe(true);
    expect(report.warnings).toEqual([]); // every mission_ref resolves to a declared blueprint
    // Six sequential waves of one mission each — the whole point of the fix.
    expect(report.waves).toEqual([
      ["Repository Context Loading"],
      ["Multi-File Change Planning"],
      ["Apply Edits"],
      ["Self-Healing Test Loop"],
      ["Quality Gate Evaluation"],
      ["Pull Request Generation"],
    ]);
  });

  it("maps id→name for dependencies[] entries", () => {
    const deps = normalizeManifestMission(
      { dependencies: [{ blueprintName: "m4", type: "finish_to_finish" }] },
      { m4: "QA" }
    );
    expect(deps).toEqual([{ upstream: "QA", type: "finish_to_finish", condition: "completed", offset: undefined, rawCondition: undefined, external: false }]);
  });

  it("dedupes a trigger and an equivalent dependency entry", () => {
    const deps = normalizeManifestMission(
      { trigger: "on_success(m1)", dependencies: [{ blueprintName: "m1", type: "finish_to_start" }] },
      { m1: "One" }
    );
    expect(deps.filter((d) => d.upstream === "One")).toHaveLength(1);
  });

  it("carries lead/lag offsets", () => {
    const deps = normalizeManifestMission({ dependencies: [{ blueprintName: "A", offset: { value: 2, unit: "days", direction: "plus" } }] });
    expect(deps[0].offset).toEqual({ value: 2, unit: "days", direction: "plus" });
  });

  it("carries per-dependency timeout_minutes and on_timeout (#3)", () => {
    const deps = normalizeManifestMission({
      dependencies: [{ blueprintName: "A", timeout_minutes: 120, on_timeout: "continue" }],
    });
    expect(deps[0].timeoutMinutes).toBe(120);
    expect(deps[0].onTimeout).toBe("continue");
  });

  it("omits timeout fields when not specified", () => {
    const deps = normalizeManifestMission({ dependencies: [{ blueprintName: "A" }] });
    expect(deps[0].timeoutMinutes).toBeUndefined();
    expect(deps[0].onTimeout).toBeUndefined();
  });
});

describe("normalizeRuntimeBlueprint — persisted blueprint rows", () => {
  it("reads name-resolved dependencies[] and webhook config.trigger, ignoring string triggers", () => {
    const deps = normalizeRuntimeBlueprint({
      dependencies: [{ blueprintName: "Build", type: "finish_to_start" }],
      config: { trigger: { type: "webhook", source: "github" } },
    });
    expect(deps.map((d) => d.upstream).sort()).toEqual(["Build", "webhook:github"]);
  });

  it("supports legacy dependsOn[]", () => {
    const deps = normalizeRuntimeBlueprint({ dependsOn: ["A", "B"] });
    expect(deps.map((d) => d.upstream).sort()).toEqual(["A", "B"]);
  });
});

describe("buildDag / computeWaves — topological scheduling", () => {
  it("orders a linear SDLC chain into sequential waves", () => {
    const bps = [
      pair("sprint-zero", []),
      pair("requirements", [{ upstream: "sprint-zero", type: "finish_to_start", condition: "completed" }]),
      pair("core-dev", [{ upstream: "requirements", type: "finish_to_start", condition: "completed" }]),
      pair("qa", [{ upstream: "core-dev", type: "finish_to_start", condition: "completed" }]),
    ];
    expect(computeWaves(buildDag(bps))).toEqual([["sprint-zero"], ["requirements"], ["core-dev"], ["qa"]]);
  });

  it("places independent blueprints in the same wave", () => {
    const bps = [
      pair("root", []),
      pair("a", [{ upstream: "root", type: "finish_to_start", condition: "completed" }]),
      pair("b", [{ upstream: "root", type: "finish_to_start", condition: "completed" }]),
    ];
    const waves = computeWaves(buildDag(bps));
    expect(waves[0]).toEqual(["root"]);
    expect(waves[1].sort()).toEqual(["a", "b"]);
  });

  it("excludes event_trigger / webhook edges from wave math", () => {
    const bps = [
      pair("a", []),
      pair("b", [{ upstream: "webhook:jira", type: "event_trigger", condition: "any", external: true }]),
    ];
    // b has no structural upstream → same wave as a
    expect(computeWaves(buildDag(bps))).toEqual([["a", "b"]]);
  });
});

describe("detectCycles", () => {
  it("returns [] for an acyclic graph", () => {
    const bps = [pair("a", []), pair("b", [{ upstream: "a", type: "finish_to_start", condition: "completed" }])];
    expect(detectCycles(buildDag(bps))).toEqual([]);
  });

  it("finds a back-edge cycle", () => {
    const bps = [
      pair("a", [{ upstream: "b", type: "finish_to_start", condition: "completed" }]),
      pair("b", [{ upstream: "a", type: "finish_to_start", condition: "completed" }]),
    ];
    const cycles = detectCycles(buildDag(bps));
    expect(cycles.length).toBeGreaterThan(0);
    expect(cycles[0][0]).toBe(cycles[0][cycles[0].length - 1]); // chain closes on itself
  });
});

describe("validateDag — one report", () => {
  it("is valid for a clean linear chain and emits the waves", () => {
    const bps = [pair("a", []), pair("b", [{ upstream: "a", type: "finish_to_start", condition: "completed" }])];
    const r = validateDag(bps);
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.waves).toEqual([["a"], ["b"]]);
  });

  it("errors on a cycle and yields no waves", () => {
    const bps = [
      pair("a", [{ upstream: "b", type: "finish_to_start", condition: "completed" }]),
      pair("b", [{ upstream: "a", type: "finish_to_start", condition: "completed" }]),
    ];
    const r = validateDag(bps);
    expect(r.valid).toBe(false);
    expect(r.cycles.length).toBeGreaterThan(0);
    expect(r.waves).toEqual([]);
  });

  it("errors on a self-dependency", () => {
    const r = validateDag([pair("a", [{ upstream: "a", type: "finish_to_start", condition: "completed" }])]);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /depends on itself/.test(e))).toBe(true);
  });

  it("warns (not errors) on an undeclared upstream", () => {
    const r = validateDag([pair("a", [{ upstream: "ghost", type: "finish_to_start", condition: "completed" }])]);
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => /not declared/.test(w))).toBe(true);
  });
});

describe("breakCycles — deadlock guard", () => {
  it("leaves an acyclic graph untouched", () => {
    const bps = [pair("a", []), pair("b", [{ upstream: "a", type: "finish_to_start", condition: "completed" }])];
    const { blueprints, removed } = breakCycles(bps);
    expect(removed).toEqual([]);
    expect(detectCycles(buildDag(blueprints))).toEqual([]);
  });

  it("removes a back-edge so the graph becomes acyclic", () => {
    const bps = [
      pair("a", [{ upstream: "b", type: "finish_to_start", condition: "completed" }]),
      pair("b", [{ upstream: "a", type: "finish_to_start", condition: "completed" }]),
    ];
    const { blueprints, removed } = breakCycles(bps);
    expect(removed.length).toBeGreaterThan(0);
    expect(detectCycles(buildDag(blueprints))).toEqual([]);
    // computeWaves now produces a valid ordering
    expect(computeWaves(buildDag(blueprints)).flat().sort()).toEqual(["a", "b"]);
  });

  it("does not mutate the input blueprints", () => {
    const bps = [
      pair("a", [{ upstream: "b", type: "finish_to_start", condition: "completed" }]),
      pair("b", [{ upstream: "a", type: "finish_to_start", condition: "completed" }]),
    ];
    breakCycles(bps);
    expect(bps[0].dependencies).toHaveLength(1);
    expect(bps[1].dependencies).toHaveLength(1);
  });
});

describe("computeCriticalPath — CPM forward/backward pass", () => {
  const fts = (upstream: string): CanonicalDependency => ({ upstream, type: "finish_to_start", condition: "completed" });

  it("identifies the longest chain as critical with zero float", () => {
    // a(2) → c(3); b(1) → c. Critical path is a→c (5), b has float.
    const dag = buildDag([pair("a", []), pair("b", []), pair("c", [fts("a"), fts("b")])]);
    const dur: Record<string, number> = { a: 2, b: 1, c: 3 };
    const r = computeCriticalPath(dag, (n) => dur[n])!;
    expect(r.projectDurationMs).toBe(5);
    expect(r.criticalPath).toEqual(["a", "c"]);
    expect(r.nodes.get("a")!.float).toBe(0);
    expect(r.nodes.get("c")!.onCriticalPath).toBe(true);
    expect(r.nodes.get("b")!.float).toBe(1); // can slip 1 unit without delaying c
    expect(r.nodes.get("b")!.onCriticalPath).toBe(false);
  });

  it("computes earliest/latest start correctly on a linear chain", () => {
    const dag = buildDag([pair("a", []), pair("b", [fts("a")]), pair("c", [fts("b")])]);
    const r = computeCriticalPath(dag, () => 10)!;
    expect(r.nodes.get("a")!.earliestStart).toBe(0);
    expect(r.nodes.get("b")!.earliestStart).toBe(10);
    expect(r.nodes.get("c")!.earliestStart).toBe(20);
    expect(r.projectDurationMs).toBe(30);
    expect(r.criticalPath).toEqual(["a", "b", "c"]);
  });

  it("returns null for a cyclic graph", () => {
    const dag = buildDag([pair("a", [fts("b")]), pair("b", [fts("a")])]);
    expect(computeCriticalPath(dag, () => 1)).toBeNull();
  });

  it("defaults to unit durations, yielding topological-depth critical path", () => {
    const dag = buildDag([pair("a", []), pair("b", [fts("a")])]);
    const r = computeCriticalPath(dag)!;
    expect(r.projectDurationMs).toBe(2);
    expect(r.criticalPath).toEqual(["a", "b"]);
  });
});
