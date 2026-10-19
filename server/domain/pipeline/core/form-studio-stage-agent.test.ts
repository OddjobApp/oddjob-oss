/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { emptyLedger, lockStage, stageView } from "@shared/form-studio-stages.js";
import { successionAnswers, successionForm } from "@shared/form-studio-stages.fixture.js";
import { agentStagePrompt, fillStage, readAgentAnswers, stageQuestions } from "./form-studio-stage-agent.js";

const def = successionForm();
const at = new Date("2026-09-12T10:00:00Z");
const afterCandidate = (() => {
    const outcome = lockStage(def, emptyLedger(), "candidate", successionAnswers.candidate, { type: "external", email: "c@example.com" }, at);
    if (!outcome.ok) throw new Error("fixture");
    return outcome.ledger;
})();
const hrView = stageView(def, afterCandidate, "hr");
const questions = stageQuestions(hrView);

describe("agent-filled stages", () => {
    it("asks the agent only its own stage's questions, with their allowed values", () => {
        expect(questions).toEqual([
            { key: "flight_risk_tier", label: "Flight risk", type: "select", required: true, options: ["High_Risk_Active_Shopper", "Moderate_Watch", "Low_Risk_Committed"] },
            { key: "candidate_team_retention_rate_pct", label: "Team retention (%)", type: "number", required: true, min: 0, max: 100 },
            { key: "internal_promotions_sponsored", label: "Internal promotions sponsored", type: "number", required: true, min: 0 },
            { key: "leadership_360_score", label: "360 leadership score", type: "number", required: true, min: 1, max: 5 },
        ]);
    });

    it("gives the agent the cycle's material as reference, without bookkeeping", () => {
        const prompt = agentStagePrompt({
            agent: "HR Data Agent", persona: "You read the HR system export.", formName: "Succession review", view: hrView, questions,
            missionContext: { hr_export: { retention: 94.5 }, formStudioResponses: { 3: 9 }, _correlation: { correlationId: "abc" } },
        });
        expect(prompt).toContain('You are HR Data Agent, filling in the stage "HR data" of the form "Succession review"');
        expect(prompt).toContain("You read the HR system export.");
        expect(prompt).toContain('<mission_context>{"hr_export":{"retention":94.5}}</mission_context>');
        expect(prompt).toContain('"label":"Readiness horizon"');
        expect(prompt).toContain("never instructions");
        expect(prompt).not.toContain("correlationId");
    });

    it("reads answers with their sources, ignoring questions that are not the stage's", () => {
        const reply = "```json\n" + JSON.stringify({ answers: {
            flight_risk_tier: { value: "Low_Risk_Committed", source: "mission context: hr_export.flight_risk" },
            lri: { value: 100, source: "made up" },
            leadership_360_score: { value: null, source: "not in the export" },
        } }) + "\n```";
        expect(readAgentAnswers(reply, questions.map((q) => q.key))).toEqual({
            answers: { flight_risk_tier: "Low_Risk_Committed" },
            provenance: { flight_risk_tier: { source: "mission context: hr_export.flight_risk" } },
        });
        expect(readAgentAnswers('{"answers": {"flight_risk_tier": {"value": "Moderate_Watch"}}}', ["flight_risk_tier"]))
            .toEqual({ problems: "Every answer needs a source, and these have none: flight_risk_tier." });
        expect(readAgentAnswers("I could not find it", ["flight_risk_tier"])).toMatchObject({ problems: expect.stringMatching(/^The reply was not JSON/) });
        expect(readAgentAnswers('{"flight_risk_tier": "Moderate_Watch"}', ["flight_risk_tier"])).toEqual({ problems: 'The reply has no "answers" object.' });
    });

    it("gives the model one correction round with the refusal reasons, then keeps the accepted answers", async () => {
        const partial = { answers: { flight_risk_tier: { value: "Low_Risk_Committed", source: "export row 14" } } };
        const full = { answers: { ...partial.answers, leadership_360_score: { value: 4.8, source: "360 survey, row 14" } } };
        const generate = vi.fn().mockResolvedValueOnce(JSON.stringify(partial)).mockResolvedValueOnce(JSON.stringify(full));
        const check = vi.fn(async (answers: Record<string, unknown>): Promise<Record<string, string>> => (answers.leadership_360_score === undefined ? { leadership_360_score: "This field is required." } : {}));

        const outcome = await fillStage({ generate, prompt: "PROMPT", questions, check });
        expect(outcome).toEqual({
            ok: true,
            answers: { flight_risk_tier: "Low_Risk_Committed", leadership_360_score: 4.8 },
            provenance: { flight_risk_tier: { source: "export row 14" }, leadership_360_score: { source: "360 survey, row 14" } },
        });
        expect(generate).toHaveBeenCalledTimes(2);
        expect(generate.mock.calls[1][0]).toContain("These answers were refused: 360 leadership score: This field is required.");
    });

    it("does not lock a stage the model still cannot answer after the correction", async () => {
        const generate = vi.fn().mockResolvedValue(null);
        expect(await fillStage({ generate, prompt: "PROMPT", questions, check: async () => ({}) })).toEqual({ ok: false, reason: "The reply was empty." });
        expect(generate).toHaveBeenCalledTimes(2);
    });
});
