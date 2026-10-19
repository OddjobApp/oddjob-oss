/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { definitionIssues, evaluateResults, evaluateStudio, respondentDefinition, studioDefinitionSchema, withoutCohortValues } from "./form-studio";
import { computeCohorts } from "./form-studio-cohorts";

const at = new Date("2026-09-12T12:00:00Z");
const certified = "readiness == 'now' && lri >= 85";

function form(studio: Record<string, unknown> = {}, fields: unknown[] = []) {
  return studioDefinitionSchema.parse({
    fields: [
      { key: "readiness", label: "Readiness", type: "select", options: ["now", "later"], required: true },
      { key: "lri", label: "LRI", type: "number", required: true },
      { key: "no_bench", label: "No ready-now successor", type: "computed", formula: "cohort.bench == 0" },
      { key: "lri_vs_certified", label: "LRI against the certified", type: "computed", formula: "lri - cohort.certified_lri" },
      ...fields,
    ],
    studio: {
      version: 2,
      pages: [{ id: "review", title: "Review" }],
      cohorts: [
        { id: "bench", label: "Certified ready now", aggregate: "count", where: certified },
        { id: "certified_lri", label: "Certified LRI", aggregate: "avg", field: "lri", where: certified },
      ],
      decisionRules: [{ id: "deficit", when: "no_bench", status: "BENCH_DEFICIT" }],
      defaultStatus: "BENCH_COVERED",
      results: [{ id: "against", title: "Against the certified bench", type: "cohort", field: "lri", metric: "certified_lri" }],
      ...studio,
    },
  });
}

const def = form();
// The last response never answered readiness, so its condition cannot hold.
const earlier = [{ readiness: "now", lri: 90 }, { readiness: "now", lri: 80 }, { readiness: "later", lri: 99 }, { readiness: "now", lri: 96 }, { lri: 100 }];

describe("cohort metrics", () => {
  it("count and average only the earlier responses their condition holds for", () => {
    expect(computeCohorts(def, earlier, at)).toEqual({
      bench: { value: 2, rows: 2, asOf: "2026-09-12T12:00:00.000Z" },
      certified_lri: { value: 93, rows: 2, asOf: "2026-09-12T12:00:00.000Z" },
    });
  });

  it("have no average over no responses, and say how many they cover", () => {
    expect(computeCohorts(def, [], at)).toEqual({
      bench: { value: 0, rows: 0, asOf: "2026-09-12T12:00:00.000Z" },
      certified_lri: { value: "", rows: 0, asOf: "2026-09-12T12:00:00.000Z" },
    });
  });

  it("feed formulas and rules: a bench gate computed from earlier responses", () => {
    const answers = { readiness: "now", lri: 88 };
    const covered = evaluateStudio(def, answers, true, { cohort: computeCohorts(def, earlier, at) });
    expect(covered.values.no_bench).toBe(false);
    expect(covered.values.lri_vs_certified).toBe(-5);
    expect(covered.decision).toMatchObject({ state: "decided", status: "BENCH_COVERED" });

    expect(evaluateStudio(def, answers, true, { cohort: computeCohorts(def, [], at) }).decision).toMatchObject({ status: "BENCH_DEFICIT" });
    // Without the server's metrics, the gate waits rather than guessing.
    // The rule reads no_bench, which has no value until the metric does.
    const waiting = evaluateStudio(def, answers, true);
    expect(waiting.values.no_bench).toBe("");
    expect(waiting.decision).toMatchObject({ state: "pending", ruleId: "deficit", waitingOn: ["no_bench"] });
  });

  it("are read-only: an input cannot supply one", () => {
    const { values } = evaluateStudio(def, { readiness: "now", lri: 88, "cohort.bench": 5 });
    expect(values["cohort.bench"]).toBe("");
  });

  it("show in a cohort result block with the row count and when they were computed", () => {
    const { values, decision } = evaluateStudio(def, { readiness: "now", lri: 88 }, true, { cohort: computeCohorts(def, earlier, at) });
    expect(evaluateResults(def, values, decision, "reviewer")).toEqual([{
      id: "against", title: "Against the certified bench", audience: "reviewer", type: "cohort", value: 88,
      metric: { id: "certified_lri", label: "Certified LRI", aggregate: "avg", value: 93, rows: 2, asOf: "2026-09-12T12:00:00.000Z" },
    }]);
    expect(withoutCohortValues(values)).toEqual({ readiness: "now", lri: 88, no_bench: false, lri_vs_certified: -5 });
  });

  it("are checked before publishing, and never reach a respondent", () => {
    expect(definitionIssues(def)).toEqual([]);
    const broken = form(
      {
        cohorts: [{ id: "bench", label: "Bench", aggregate: "avg", where: "missing_field > 1" }, { id: "certified_lri", label: "LRI", aggregate: "avg", field: "lri" }],
        results: [{ id: "against", title: "Against", type: "cohort", field: "lri", metric: "nope" }],
      },
      [{ key: "stray", label: "Stray", type: "computed", formula: "cohort.unknown + 1" }],
    );
    expect(definitionIssues(broken)).toEqual(expect.arrayContaining([
      "Cohort bench: name the field to average.",
      "Cohort bench: unknown field missing_field.",
      "Result against: cohort nope does not exist.",
      "stray: unknown field cohort.unknown.",
    ]));
    expect(respondentDefinition(def).studio.cohorts).toEqual([]);
  });
});
