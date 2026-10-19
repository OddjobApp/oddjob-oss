/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { asStudioDefinition, definitionIssues } from "./form-studio";
import { emptyLedger, lockStage, nextStageId, stageView, type StageLedger } from "./form-studio-stages";
import { successionAnswers, successionForm } from "./form-studio-stages.fixture";

const at = new Date("2026-09-12T10:00:00Z");
const def = successionForm();

function lock(ledger: StageLedger, stageId: string, inputs: Record<string, unknown>, provenance?: Record<string, { source: string }>) {
  const outcome = lockStage(def, ledger, stageId, inputs, { type: "user", userId: "u1" }, at, provenance);
  if (!outcome.ok) throw new Error(`Stage ${stageId} refused: ${JSON.stringify(outcome.errors)}`);
  return outcome;
}

describe("staged responses", () => {
  it("is a publishable form", () => {
    expect(definitionIssues(def)).toEqual([]);
  });

  it("re-scores after every stage: LRI waits on HR, then reaches 96.5625 and PRIMARY_SUCCESSOR_CERTIFIED", () => {
    const candidate = lock(emptyLedger(), "candidate", successionAnswers.candidate);
    expect(candidate.values).toMatchObject({ score_vis: 93, score_resil: 100, lri: "" });
    expect(candidate.decision).toMatchObject({ state: "pending", ruleId: "primary" });
    expect(candidate.complete).toBe(false);

    const hr = lock(candidate.ledger, "hr", successionAnswers.hr);
    expect(hr.values.lri).toBeCloseTo(96.5625, 6);
    expect(hr.decision).toMatchObject({ state: "decided", status: "PRIMARY_SUCCESSOR_CERTIFIED" });

    const committee = lock(hr.ledger, "committee", { ...successionAnswers.committee, gate_zero_emergency_ready_now_successors: true });
    expect(committee.complete).toBe(true);
    expect(committee.decision).toMatchObject({ state: "decided", status: "CRITICAL_BENCH_DEFICIT_BOARD_ALERT" });
    expect(committee.ledger.stages.map((s) => [s.stageId, s.status])).toEqual([
      ["candidate", null], ["hr", "PRIMARY_SUCCESSOR_CERTIFIED"], ["committee", "CRITICAL_BENCH_DEFICIT_BOARD_ALERT"],
    ]);
    expect(committee.ledger.stages[0].computed.lri).toBe("");
    expect(committee.ledger.stages[1].computed.lri).toBeCloseTo(96.5625, 6);
    expect(nextStageId(def, committee.ledger)).toBeNull();
  });

  it("takes only the stage's own questions, so no one answers or rewrites another stage", () => {
    const candidate = lock(emptyLedger(), "candidate", { ...successionAnswers.candidate, flight_risk_tier: "High_Risk_Active_Shopper", lri: 100 });
    expect(Object.keys(candidate.ledger.stages[0].answers)).not.toContain("flight_risk_tier");
    const hr = lock(candidate.ledger, "hr", { ...successionAnswers.hr, readiness_horizon: "Stretch_3_to_5_Years" });
    expect(hr.values.readiness_horizon).toBe("Emergency_Ready_Now");
    expect(hr.values.flight_risk_tier).toBe("Low_Risk_Committed");
  });

  it("requires only the stage's own questions", () => {
    const { q_crisis_decision_velocity: _missing, ...partial } = successionAnswers.candidate;
    expect(lockStage(def, emptyLedger(), "candidate", partial, { type: "external", email: "c@example.com" }, at)).toEqual({
      ok: false, errors: { q_crisis_decision_velocity: "This field is required." },
    });
  });

  it("refuses a stage out of order, a stage already in, and a form without stages", () => {
    expect(() => lockStage(def, emptyLedger(), "hr", successionAnswers.hr, { type: "user", userId: "u1" }, at))
      .toThrow("HR data comes after Candidate self-assessment, which has not been submitted yet.");
    const candidate = lock(emptyLedger(), "candidate", successionAnswers.candidate);
    expect(() => lock(candidate.ledger, "candidate", successionAnswers.candidate)).toThrow("Candidate self-assessment has already been submitted.");
    expect(() => lockStage(asStudioDefinition({ fields: [] }), emptyLedger(), "candidate", {}, { type: "user", userId: "u1" }, at)).toThrow(/has no stages/);
  });

  it("never shows the candidate HR's flight risk, or a score computed from it", () => {
    const done = lock(lock(lock(emptyLedger(), "candidate", successionAnswers.candidate).ledger, "hr", successionAnswers.hr).ledger, "committee", successionAnswers.committee);
    const view = stageView(def, done.ledger, "candidate");

    expect(view.definition.fields.map((f) => f.key)).toEqual([
      "readiness_horizon", "q_strategic_capital_allocation", "q_cross_functional_influence", "q_crisis_decision_velocity",
      "q_culture_values_custodianship", "major_enterprise_initiatives_led", "score_vis", "score_resil",
    ]);
    expect(view.definition.studio.decisionRules).toEqual([]);
    expect(view.inputs).toEqual(successionAnswers.candidate);
    expect(view.earlier).toEqual([]);
    expect(view.results.map((r) => r.id)).toEqual(["readiness", "dimensions"]);
    expect(view.results[0]).toMatchObject({ value: "", band: null });
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("Low_Risk_Committed");
    expect(serialized).not.toContain("96.56");
  });

  it("shows the committee both earlier stages, where an agent's answer came from, and the LRI so far", () => {
    const candidate = lock(emptyLedger(), "candidate", successionAnswers.candidate);
    const hr = lock(candidate.ledger, "hr", successionAnswers.hr, { leadership_360_score: { source: "Q3 360 survey export, row 14" }, lri: { source: "ignored" } });
    expect(hr.ledger.stages[1].provenance).toEqual({ leadership_360_score: { source: "Q3 360 survey export, row 14" } });

    const view = stageView(def, hr.ledger, "committee");
    expect(view.locked).toBe(false);
    expect(view.progress).toEqual([
      { id: "candidate", title: "Candidate self-assessment", locked: true, next: false },
      { id: "hr", title: "HR data", locked: true, next: false },
      { id: "committee", title: "Committee review", locked: false, next: true },
    ]);
    expect(view.earlier.map((e) => e.stageId)).toEqual(["candidate", "hr"]);
    expect(view.earlier[1].answers.find((a) => a.key === "leadership_360_score")).toEqual({ key: "leadership_360_score", label: "360 leadership score", value: 4.8, source: "Q3 360 survey export, row 14" });
    expect(view.results.find((r) => r.id === "readiness")).toMatchObject({ band: { label: "Ready now" } });
    expect(view.results.find((r) => r.id === "outcome")).toMatchObject({ status: "PRIMARY_SUCCESSOR_CERTIFIED" });
  });

  it("shows HR the candidate's answers but not the committee's page", () => {
    const candidate = lock(emptyLedger(), "candidate", successionAnswers.candidate);
    const view = stageView(def, candidate.ledger, "hr");
    expect(view.definition.studio.pages.map((p) => p.id)).toEqual(["self", "hr"]);
    expect(view.definition.fields.some((f) => f.key === "lri")).toBe(false);
    expect(view.inputs).toEqual(successionAnswers.candidate);
  });
});
