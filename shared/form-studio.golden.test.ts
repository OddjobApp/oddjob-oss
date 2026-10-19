/** @vitest-environment node */
import { describe, it, expect } from "vitest";
import {
    asStudioDefinition,
    studioDefinitionSchema,
    studioFieldSchema,
    definitionIssues,
    evaluateStudio,
    evaluateResults,
    runStudioTests,
} from "./form-studio";

/**
 * Golden tests from three knowledge-base specs: feature beta validation,
 * executive succession, and conversational compliance. Each sample payload's
 * expected outcome was computed by hand from the spec's formulas and decision
 * logic. The edge cases pin defects that used to produce confident wrong answers
 * or reject valid submissions.
 */

const PAGES = [
    { id: "meta", title: "Metadata", html: "" },
    { id: "telemetry", title: "Telemetry", html: "" },
    { id: "gates", title: "Hard stops", html: "" },
    { id: "decision", title: "Decision", html: "" },
];

// Written as version 1 definitions, so every golden run also goes through the upgrade to version 2.
function definition(fields: unknown[], options: { extraPages?: unknown[]; tests?: unknown[] } = {}) {
    return asStudioDefinition({
        fields,
        studio: { version: 1, pages: [...PAGES, ...(options.extraPages ?? [])], sources: [], issues: [], reports: [], tests: options.tests ?? [] },
    });
}
function withStudio(def: ReturnType<typeof definition>, studio: Record<string, unknown>) {
    return studioDefinitionSchema.parse({ ...def, studio: { ...def.studio, ...studio } });
}
const num = (key: string, extra: Record<string, unknown> = {}) => ({ key, label: key, type: "number", required: true, pageId: "telemetry", ...extra });
const scale = (key: string, min: number, max: number) => num(key, { min, max });
const bool = (key: string, extra: Record<string, unknown> = {}) => ({ key, label: key, type: "boolean", pageId: "gates", ...extra });
const calc = (key: string, formula: string) => ({ key, label: key, type: "computed", pageId: "decision", formula });

describe("feature beta validation", () => {
    const beta = definition(
        [
            { key: "product_tier", label: "Tier", type: "select", required: true, pageId: "meta", options: ["Tier_0_Core_Platform", "Tier_1_Revenue_Driver", "Tier_2_Value_Add", "Tier_3_Internal_Tool"] },
            ...["cohort_total_users", "activated_users", "weekly_active_users_d28", "pmf_very_disappointed_count", "pmf_survey_total_responses", "p0_blocking_bugs_open", "p1_major_bugs_open"].map((k) => num(k)),
            scale("avg_ces_score", 1, 7),
            scale("crash_free_sessions_pct", 0, 100),
            scale("willingness_to_pay_pct", 0, 100),
            bool("gate_data_loss_incident"),
            calc("r_pmf", "pmf_very_disappointed_count / pmf_survey_total_responses * 100"),
            calc("rate_activation", "activated_users / cohort_total_users * 100"),
            calc("rate_retention_d28", "weekly_active_users_d28 / activated_users * 100"),
            calc("s_adopt", "min(100, rate_activation * 0.4 + rate_retention_d28 * 0.6)"),
            calc("s_ux", "(avg_ces_score - 1) / 6 * 100"),
            calc("s_pilot", "0.35 * s_adopt + 0.25 * r_pmf + 0.20 * s_ux + 0.20 * willingness_to_pay_pct"),
            calc("gate_p0_defect_unresolved", "p0_blocking_bugs_open > 0"),
            calc("gate_crash_free_below_threshold", "crash_free_sessions_pct < 99.5"),
            calc("launch_status", "gate_p0_defect_unresolved || gate_crash_free_below_threshold || gate_data_loss_incident ? 'GA_LAUNCH_BLOCKED' : s_pilot >= 75 && r_pmf >= 40 && p1_major_bugs_open == 0 ? 'PROCEED_TO_GENERAL_AVAILABILITY' : s_pilot >= 60 && r_pmf >= 25 ? 'EXTEND_PILOT_PHASE' : 'PIVOT_OR_DEPRECATE'"),
        ],
        {
            tests: [{
                name: "spec §7 sample payload",
                inputs: { product_tier: "Tier_1_Revenue_Driver", cohort_total_users: 250, activated_users: 215, weekly_active_users_d28: 178, pmf_very_disappointed_count: 52, pmf_survey_total_responses: 110, avg_ces_score: 6.1, p0_blocking_bugs_open: 0, p1_major_bugs_open: 0, crash_free_sessions_pct: 99.85, willingness_to_pay_pct: 72, gate_data_loss_incident: false },
                expected: { launch_status: "EXTEND_PILOT_PHASE" },
            }],
        },
    );
    const sample = (beta.studio.tests[0] as any).inputs;

    it("has no structural issues and its sample test passes", () => {
        expect(definitionIssues(beta)).toEqual([]);
        expect(runStudioTests(beta).map((t) => t.passed)).toEqual([true]);
    });

    it("scores the sample payload: S_pilot 72.6442, R_pmf 47.2727, EXTEND_PILOT_PHASE", () => {
        const { values, errors } = evaluateStudio(beta, sample, true);
        expect(errors).toEqual({});
        expect(values.r_pmf).toBeCloseTo(47.2727, 4);
        expect(values.s_pilot).toBeCloseTo(72.6442, 4);
        expect(values.launch_status).toBe("EXTEND_PILOT_PHASE");
    });

    it("refuses to score a pilot with no survey responses instead of classing it PIVOT_OR_DEPRECATE", () => {
        const { values, errors } = evaluateStudio(beta, { ...sample, pmf_survey_total_responses: 0, pmf_very_disappointed_count: 0, activated_users: 0, weekly_active_users_d28: 0 }, true);
        expect(errors.r_pmf).toMatch(/Division by zero/);
        expect(values.launch_status).toBe("");
    });

    it("blocks GA when a P0 defect is open", () => {
        const { values } = evaluateStudio(beta, { ...sample, p0_blocking_bugs_open: 1 }, true);
        expect(values.launch_status).toBe("GA_LAUNCH_BLOCKED");
    });

    it("reaches the same launch statuses through ordered decision rules, and waits rather than pivoting without survey data", () => {
        const ruled = withStudio(beta, {
            decisionRules: [
                { id: "hard_stop", when: "gate_p0_defect_unresolved || gate_crash_free_below_threshold || gate_data_loss_incident", status: "GA_LAUNCH_BLOCKED" },
                { id: "proceed", when: "s_pilot >= 75 && r_pmf >= 40 && p1_major_bugs_open == 0", status: "PROCEED_TO_GENERAL_AVAILABILITY" },
                { id: "extend", when: "s_pilot >= 60 && r_pmf >= 25", status: "EXTEND_PILOT_PHASE" },
            ],
            defaultStatus: "PIVOT_OR_DEPRECATE",
            tests: [{ ...(beta.studio.tests[0] as any), expectedStatus: "EXTEND_PILOT_PHASE" }],
            results: [{ id: "hard_stops", title: "Hard stops", type: "gates", items: [{ label: "Open P0 defect", trippedWhen: "gate_p0_defect_unresolved" }, { label: "Data loss", trippedWhen: "gate_data_loss_incident" }] }],
        });
        expect(definitionIssues(ruled)).toEqual([]);
        expect(runStudioTests(ruled).map((t) => t.passed)).toEqual([true]);
        expect(evaluateStudio(ruled, sample, true).decision).toEqual({ state: "decided", status: "EXTEND_PILOT_PHASE", ruleId: "extend", actions: [] });

        const blocked = evaluateStudio(ruled, { ...sample, p0_blocking_bugs_open: 1 }, true);
        expect(blocked.decision).toMatchObject({ state: "decided", status: "GA_LAUNCH_BLOCKED" });
        expect(evaluateResults(ruled, blocked.values, blocked.decision, "reviewer")[0]).toMatchObject({
            items: [{ label: "Open P0 defect", state: "tripped" }, { label: "Data loss", state: "clear" }],
        });

        const noSurvey = evaluateStudio(ruled, { ...sample, pmf_survey_total_responses: 0, pmf_very_disappointed_count: 0 }, true);
        expect(noSurvey.decision).toMatchObject({ state: "pending", ruleId: "proceed" });
    });
});

describe("executive succession", () => {
    const succession = definition([
        { key: "readiness_horizon", label: "Horizon", type: "select", required: true, pageId: "meta", options: ["Emergency_Ready_Now", "Ready_1_to_2_Years", "Stretch_3_to_5_Years", "High_Potential_Pipeline"] },
        { key: "flight_risk_tier", label: "Flight risk", type: "select", required: true, pageId: "telemetry", options: ["High_Risk_Active_Shopper", "Moderate_Watch", "Low_Risk_Committed"] },
        ...["q_strategic_capital_allocation", "q_cross_functional_influence", "q_crisis_decision_velocity", "q_culture_values_custodianship"].map((k) => scale(k, 1, 5)),
        num("major_enterprise_initiatives_led"),
        num("internal_promotions_sponsored"),
        scale("candidate_team_retention_rate_pct", 0, 100),
        { ...scale("leadership_360_score", 1, 5), sourceKey: "360_leadership_reputation_score" },
        bool("gate_zero_emergency_ready_now_successors"),
        calc("score_vis", "(q_strategic_capital_allocation + q_cross_functional_influence) / 10 * 70 + min(30, major_enterprise_initiatives_led * 10)"),
        calc("score_tal", "candidate_team_retention_rate_pct * 0.5 + leadership_360_score / 5 * 30 + min(20, internal_promotions_sponsored * 5)"),
        calc("score_resil", "(q_crisis_decision_velocity + q_culture_values_custodianship) / 10 * 100"),
        calc("flight_points", "flight_risk_tier == 'Low_Risk_Committed' ? 100 : flight_risk_tier == 'Moderate_Watch' ? 60 : 20"),
        calc("lri", "0.35 * score_vis + 0.25 * score_tal + 0.25 * score_resil + 0.15 * flight_points"),
        calc("status", "gate_zero_emergency_ready_now_successors ? 'CRITICAL_BENCH_DEFICIT_BOARD_ALERT' : lri >= 85 && readiness_horizon == 'Emergency_Ready_Now' ? 'PRIMARY_SUCCESSOR_CERTIFIED' : lri >= 70 ? 'HIGH_POTENTIAL_ACCELERATOR' : 'LATERAL_REASSIGNMENT_RECOMMENDED'"),
    ]);
    const sample = {
        readiness_horizon: "Emergency_Ready_Now", flight_risk_tier: "Low_Risk_Committed",
        q_strategic_capital_allocation: 5, q_cross_functional_influence: 4, major_enterprise_initiatives_led: 3,
        candidate_team_retention_rate_pct: 94.5, internal_promotions_sponsored: 4, leadership_360_score: 4.8,
        q_crisis_decision_velocity: 5, q_culture_values_custodianship: 5, gate_zero_emergency_ready_now_successors: false,
    };

    it("scores the sample payload: LRI 96.5625, PRIMARY_SUCCESSOR_CERTIFIED", () => {
        expect(definitionIssues(succession)).toEqual([]);
        const { values, errors } = evaluateStudio(succession, sample, true);
        expect(errors).toEqual({});
        expect(values.score_vis).toBe(93);
        expect(values.score_tal).toBeCloseTo(96.05, 6);
        expect(values.score_resil).toBe(100);
        expect(values.lri).toBeCloseTo(96.5625, 6);
        expect(values.status).toBe("PRIMARY_SUCCESSOR_CERTIFIED");
    });

    it("rejects a 1-5 rating entered as 9", () => {
        const { errors } = evaluateStudio(succession, { ...sample, q_strategic_capital_allocation: 9 }, true);
        expect(errors.q_strategic_capital_allocation).toBe("Enter a number within the allowed range.");
    });

    it("runs in two stages, shows the candidate readiness but not flight risk, and places them on the 9-box", () => {
        const staged = withStudio(succession, {
            stages: [
                { id: "panel", title: "Talent panel", pageIds: ["meta", "telemetry"], assignee: { type: "role", role: "talent_committee" } },
                { id: "board", title: "Board review", pageIds: ["gates", "decision"], assignee: { type: "role", role: "board" }, sees: ["panel"] },
            ],
            decisionRules: [
                { id: "bench_deficit", when: "gate_zero_emergency_ready_now_successors", status: "CRITICAL_BENCH_DEFICIT_BOARD_ALERT" },
                { id: "primary", when: "lri >= 85 && readiness_horizon == 'Emergency_Ready_Now'", status: "PRIMARY_SUCCESSOR_CERTIFIED" },
                { id: "accelerate", when: "lri >= 70", status: "HIGH_POTENTIAL_ACCELERATOR" },
            ],
            defaultStatus: "LATERAL_REASSIGNMENT_RECOMMENDED",
            results: [
                { id: "readiness", title: "Leadership readiness", type: "score", audience: "respondent", field: "lri", bands: [{ min: 85, max: 100, label: "Ready now", tone: "good" }, { min: 70, max: 84.9999, label: "Accelerate", tone: "warning" }, { min: 0, max: 69.9999, label: "Reassign", tone: "critical" }] },
                { id: "dimensions", title: "Dimensions", type: "breakdown", audience: "respondent", items: [{ field: "score_vis", label: "Vision", weight: 35 }, { field: "score_tal", label: "Talent", weight: 25 }, { field: "score_resil", label: "Resilience", weight: 25 }] },
                { id: "flight", title: "Flight risk", type: "breakdown", items: [{ field: "flight_points", label: "Flight risk points", weight: 15 }] },
                { id: "nine_box", title: "9-box", type: "grid", x: { field: "score_vis", label: "Performance", cuts: [60, 85] }, y: { field: "score_tal", label: "Potential", cuts: [60, 85] }, cells: [["Risk", "Effective", "Trusted"], ["Inconsistent", "Core", "High performer"], ["Enigma", "Growth", "Star"]] },
            ],
        });
        expect(definitionIssues(staged)).toEqual([]);

        const panelErrors = evaluateStudio(staged, {}, true, { stageId: "panel" }).errors;
        expect(Object.keys(panelErrors)).toEqual(expect.arrayContaining(["readiness_horizon", "flight_risk_tier", "q_strategic_capital_allocation"]));
        expect(evaluateStudio(staged, {}, true, { stageId: "board" }).errors).toEqual({});

        const { values, decision } = evaluateStudio(staged, sample, true);
        expect(decision).toMatchObject({ state: "decided", status: "PRIMARY_SUCCESSOR_CERTIFIED" });
        const candidate = evaluateResults(staged, values, decision, "respondent");
        expect(candidate.map((b) => b.id)).toEqual(["readiness", "dimensions"]);
        expect(candidate[0]).toMatchObject({ band: { label: "Ready now" } });
        expect(evaluateResults(staged, values, decision, "reviewer").find((b) => b.id === "nine_box")).toMatchObject({ cell: { row: 2, column: 2, label: "Star" } });
    });

    it("keeps the spec's digit-leading key as sourceKey, which a key cannot be", () => {
        expect(studioFieldSchema.safeParse({ key: "360_leadership_reputation_score", label: "360", type: "number" }).success).toBe(false);
        const field = succession.fields.find((f) => f.key === "leadership_360_score");
        expect(field?.sourceKey).toBe("360_leadership_reputation_score");
    });
});

describe("conversational compliance", () => {
    const compliance = definition(
        [
            { key: "line_of_business", label: "Line of business", type: "select", required: true, pageId: "meta", options: ["Consumer_Lending_CFPB", "Life_Insurance", "Securities_FINRA", "Health_Medicare"] },
            bool("recording_consent_secured", { required: true, pageId: "telemetry" }),
            bool("apr_interest_rate_disclosed", { pageId: "telemetry" }),
            bool("cancellation_right_disclosed", { pageId: "telemetry" }),
            bool("customer_dob_ssn_verified", { pageId: "telemetry" }),
            bool("cvv_card_pin_masked_audio", { pageId: "telemetry" }),
            bool("customer_explicit_verbal_assent", { pageId: "telemetry" }),
            num("disclosure_speech_rate_wpm", { required: false }),
            num("deceptive_guarantee_utterances"),
            num("high_pressure_refusal_spikes"),
            num("unauthorized_tax_legal_advice"),
            bool("gate_recording_without_consent"),
            bool("gate_fraudulent_guarantee"),
            { key: "apr_value", label: "APR", type: "number", required: true, pageId: "lending" },
            calc("score_disclose", "recording_consent_secured * 35 + apr_interest_rate_disclosed * 35 + cancellation_right_disclosed * 30"),
            calc("penalty_speech", "max(0, (disclosure_speech_rate_wpm - 180) * 0.5)"),
            calc("score_conduct", "max(0, 100 - deceptive_guarantee_utterances * 40 - high_pressure_refusal_spikes * 25 - unauthorized_tax_legal_advice * 35)"),
            calc("score_identity", "customer_dob_ssn_verified * 50 + cvv_card_pin_masked_audio * 50"),
            calc("compliance_index", "max(0, 0.40 * (score_disclose - penalty_speech) + 0.30 * score_conduct + 0.15 * score_identity + 0.15 * (customer_explicit_verbal_assent * 100))"),
            calc("status", "gate_recording_without_consent || gate_fraudulent_guarantee ? 'STATUTORY_VIOLATION_SUPERVISOR_ALERT' : compliance_index >= 95 ? 'COMPLIANT_RECORD_CERTIFIED' : 'BINDING_SUSPENDED_REVIEW_REQUIRED'"),
        ],
        { extraPages: [{ id: "lending", title: "Lending disclosures", html: "", visibleWhen: "line_of_business == 'Consumer_Lending_CFPB'" }] },
    );
    const sample = {
        line_of_business: "Consumer_Lending_CFPB", recording_consent_secured: true, apr_interest_rate_disclosed: true,
        cancellation_right_disclosed: true, customer_dob_ssn_verified: true, cvv_card_pin_masked_audio: true,
        customer_explicit_verbal_assent: true, disclosure_speech_rate_wpm: 142, deceptive_guarantee_utterances: 0,
        high_pressure_refusal_spikes: 0, unauthorized_tax_legal_advice: 0, gate_recording_without_consent: false,
        gate_fraudulent_guarantee: false, apr_value: 19.9,
    };

    it("scores the sample payload: disclosure 100, penalty 0, index 100, COMPLIANT_RECORD_CERTIFIED", () => {
        expect(definitionIssues(compliance)).toEqual([]);
        const { values, errors } = evaluateStudio(compliance, sample, true);
        expect(errors).toEqual({});
        expect(values.score_disclose).toBe(100);
        expect(values.penalty_speech).toBe(0);
        expect(values.compliance_index).toBe(100);
        expect(values.status).toBe("COMPLIANT_RECORD_CERTIFIED");
    });

    it("accepts a submission whose lending page does not apply and whose optional speech rate is blank", () => {
        const { apr_value: _apr, disclosure_speech_rate_wpm: _wpm, ...rest } = sample;
        const { values, errors } = evaluateStudio(compliance, { ...rest, line_of_business: "Life_Insurance" }, true);
        expect(errors).toEqual({});
        // Scores that need the missing rate have no value rather than a guessed one.
        expect(values.penalty_speech).toBe("");
    });

    it("rejects a submission whose required recording consent is unticked", () => {
        const { errors } = evaluateStudio(compliance, { ...sample, recording_consent_secured: false }, true);
        expect(errors.recording_consent_secured).toBe("This must be checked.");
    });

    it("routes a recording without consent to the supervisor alert", () => {
        const { values } = evaluateStudio(compliance, { ...sample, gate_recording_without_consent: true }, true);
        expect(values.status).toBe("STATUTORY_VIOLATION_SUPERVISOR_ALERT");
    });

    it("decides through rules, without waiting on an APR that an insurance call never asks for", () => {
        const ruled = withStudio(compliance, {
            decisionRules: [
                { id: "statutory", when: "gate_recording_without_consent || gate_fraudulent_guarantee", status: "STATUTORY_VIOLATION_SUPERVISOR_ALERT", actions: ["alert_supervisor"] },
                { id: "apr_cap", when: "line_of_business == 'Consumer_Lending_CFPB' && apr_value > 36", status: "BINDING_SUSPENDED_REVIEW_REQUIRED" },
                { id: "certified", when: "compliance_index >= 95", status: "COMPLIANT_RECORD_CERTIFIED" },
            ],
            defaultStatus: "BINDING_SUSPENDED_REVIEW_REQUIRED",
            actions: [{ id: "alert_supervisor", label: "Alert the compliance supervisor", type: "notify", channel: "inbox", to: "compliance_supervisor", message: "Statutory violation on a recorded call" }],
        });
        expect(definitionIssues(ruled)).toEqual([]);
        expect(evaluateStudio(ruled, sample, true).decision).toMatchObject({ state: "decided", status: "COMPLIANT_RECORD_CERTIFIED" });

        const { apr_value: _apr, ...insurance } = sample;
        expect(evaluateStudio(ruled, { ...insurance, line_of_business: "Life_Insurance" }, true).decision)
            .toMatchObject({ state: "decided", status: "COMPLIANT_RECORD_CERTIFIED", ruleId: "certified" });

        expect(evaluateStudio(ruled, { ...sample, gate_fraudulent_guarantee: true }, true).decision)
            .toEqual({ state: "decided", status: "STATUTORY_VIOLATION_SUPERVISOR_ALERT", ruleId: "statutory", actions: ["alert_supervisor"] });
    });
});
