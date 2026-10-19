import { studioDefinitionSchema, type StudioDefinition } from "./form-studio";

/**
 * Test fixture: the executive succession assessment from the knowledge-base spec,
 * filled in over a cycle by the candidate, then HR, then the succession committee.
 * HR's flight-risk rating feeds the leadership readiness index (LRI), so the
 * candidate's stage sees neither. The sample answers score LRI 96.5625 and
 * PRIMARY_SUCCESSOR_CERTIFIED, as in the golden tests.
 */

const rating = (key: string, label: string) => ({ key, label, type: "number", required: true, pageId: "self", min: 1, max: 5 });
const calc = (key: string, label: string, pageId: string, formula: string) => ({ key, label, type: "computed", pageId, formula });

export function successionForm(): StudioDefinition {
  return studioDefinitionSchema.parse({
    fields: [
      { key: "readiness_horizon", label: "Readiness horizon", type: "select", required: true, pageId: "self", options: ["Emergency_Ready_Now", "Ready_1_to_2_Years", "Stretch_3_to_5_Years", "High_Potential_Pipeline"] },
      rating("q_strategic_capital_allocation", "Strategic capital allocation"),
      rating("q_cross_functional_influence", "Cross-functional influence"),
      rating("q_crisis_decision_velocity", "Crisis decision velocity"),
      rating("q_culture_values_custodianship", "Culture and values custodianship"),
      { key: "major_enterprise_initiatives_led", label: "Enterprise initiatives led", type: "number", required: true, pageId: "self", min: 0 },
      calc("score_vis", "Vision", "self", "(q_strategic_capital_allocation + q_cross_functional_influence) / 10 * 70 + min(30, major_enterprise_initiatives_led * 10)"),
      calc("score_resil", "Resilience", "self", "(q_crisis_decision_velocity + q_culture_values_custodianship) / 10 * 100"),

      { key: "flight_risk_tier", label: "Flight risk", type: "select", required: true, pageId: "hr", options: ["High_Risk_Active_Shopper", "Moderate_Watch", "Low_Risk_Committed"] },
      { key: "candidate_team_retention_rate_pct", label: "Team retention (%)", type: "number", required: true, pageId: "hr", min: 0, max: 100 },
      { key: "internal_promotions_sponsored", label: "Internal promotions sponsored", type: "number", required: true, pageId: "hr", min: 0 },
      { key: "leadership_360_score", label: "360 leadership score", type: "number", required: true, pageId: "hr", min: 1, max: 5, sourceKey: "360_leadership_reputation_score" },
      calc("score_tal", "Talent", "hr", "candidate_team_retention_rate_pct * 0.5 + leadership_360_score / 5 * 30 + min(20, internal_promotions_sponsored * 5)"),
      calc("flight_points", "Flight risk points", "hr", "flight_risk_tier == 'Low_Risk_Committed' ? 100 : flight_risk_tier == 'Moderate_Watch' ? 60 : 20"),

      { key: "gate_zero_emergency_ready_now_successors", label: "No emergency-ready successor on the bench", type: "boolean", pageId: "committee" },
      { key: "committee_notes", label: "Committee notes", type: "textarea", pageId: "committee" },
      calc("lri", "Leadership readiness index", "committee", "0.35 * score_vis + 0.25 * score_tal + 0.25 * score_resil + 0.15 * flight_points"),
    ],
    studio: {
      version: 2,
      pages: [{ id: "self", title: "Self-assessment" }, { id: "hr", title: "HR data" }, { id: "committee", title: "Committee review" }],
      stages: [
        { id: "candidate", title: "Candidate self-assessment", pageIds: ["self"], assignee: { type: "respondent" } },
        { id: "hr", title: "HR data", pageIds: ["hr"], assignee: { type: "role", role: "hr" }, sees: ["candidate"] },
        { id: "committee", title: "Committee review", pageIds: ["committee"], assignee: { type: "role", role: "succession_committee" }, sees: ["candidate", "hr"] },
      ],
      decisionRules: [
        { id: "bench_deficit", when: "gate_zero_emergency_ready_now_successors", status: "CRITICAL_BENCH_DEFICIT_BOARD_ALERT" },
        { id: "primary", when: "lri >= 85 && readiness_horizon == 'Emergency_Ready_Now'", status: "PRIMARY_SUCCESSOR_CERTIFIED" },
        { id: "accelerate", when: "lri >= 70", status: "HIGH_POTENTIAL_ACCELERATOR" },
      ],
      defaultStatus: "LATERAL_REASSIGNMENT_RECOMMENDED",
      results: [
        { id: "readiness", title: "Leadership readiness", type: "score", audience: "respondent", field: "lri", bands: [{ min: 85, max: 100, label: "Ready now", tone: "good" }, { min: 70, max: 84.9999, label: "Accelerate", tone: "warning" }, { min: 0, max: 69.9999, label: "Reassign", tone: "critical" }] },
        { id: "dimensions", title: "Your dimensions", type: "breakdown", audience: "respondent", items: [{ field: "score_vis", label: "Vision", weight: 35 }, { field: "score_resil", label: "Resilience", weight: 25 }] },
        { id: "flight", title: "Flight risk", type: "breakdown", items: [{ field: "flight_points", label: "Flight risk points", weight: 15 }] },
        { id: "outcome", title: "Outcome", type: "status" },
      ],
    },
  });
}

export const successionAnswers = {
  candidate: {
    readiness_horizon: "Emergency_Ready_Now",
    q_strategic_capital_allocation: 5,
    q_cross_functional_influence: 4,
    q_crisis_decision_velocity: 5,
    q_culture_values_custodianship: 5,
    major_enterprise_initiatives_led: 3,
  },
  hr: {
    flight_risk_tier: "Low_Risk_Committed",
    candidate_team_retention_rate_pct: 94.5,
    internal_promotions_sponsored: 4,
    leadership_360_score: 4.8,
  },
  committee: {
    gate_zero_emergency_ready_now_successors: false,
    committee_notes: "Ready now; confirm the transition plan with the board.",
  },
};
