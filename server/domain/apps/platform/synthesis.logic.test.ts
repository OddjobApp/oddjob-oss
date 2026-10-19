import { describe, it, expect } from "vitest";
import {
    extractFeatures,
    heuristicSynthesis,
    parseAiSynthesis,
    BULLET_KEYS,
} from "./synthesis.logic.js";

const NOW = new Date("2026-07-09T12:00:00.000Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const daysAhead = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

const opp = { opportunity_id: "opp_1", name: "Acme Platform", amount: 500000, currency: "USD", stage: "NEGOTIATION" };

describe("extractFeatures", () => {
    it("counts engagement shape and silence from real rows", () => {
        const activities = [
            { opportunity_id: "opp_1", type: "PROPOSAL_OPENED", occurred_at: daysAgo(3), summary: "opened proposal" },
            { opportunity_id: "opp_1", type: "PROPOSAL_OPENED", occurred_at: daysAgo(5), summary: "opened again" },
            { opportunity_id: "opp_1", type: "MEETING", occurred_at: daysAgo(20), summary: "kickoff" },
        ];
        const window = { current_ceiling: 60, status: "DECAYING", grace_period_hours: 48, next_gate_deadline: daysAhead(1) };
        const f = extractFeatures(opp, activities, window, NOW);

        expect(f.proposalOpens).toBe(2);
        expect(f.replies).toBe(0);
        expect(f.meetings).toBe(1);
        expect(f.silenceDays).toBe(3); // most recent activity
        expect(f.lastActivityType).toBe("PROPOSAL_OPENED");
        expect(f.ceiling).toBe(60);
        expect(f.deadlineInDays).toBe(1);
        expect(f.activityCount).toBe(3);
    });

    it("flags competitor mentions from summaries", () => {
        const activities = [
            { opportunity_id: "opp_1", type: "CALL", occurred_at: daysAgo(2), summary: "Buyer is also evaluating a competing vendor" },
        ];
        const f = extractFeatures(opp, activities, null, NOW);
        expect(f.competitorHits.length).toBe(1);
        expect(f.silenceDays).toBe(2);
        expect(f.ceiling).toBeNull();
    });

    it("handles a deal with no activity ever", () => {
        const f = extractFeatures(opp, [], null, NOW);
        expect(f.silenceDays).toBeNull();
        expect(f.lastActivityType).toBeNull();
        expect(f.activityCount).toBe(0);
    });
});

describe("heuristicSynthesis", () => {
    it("returns exactly the three required bullets plus a verdict", () => {
        const f = extractFeatures(opp, [], null, NOW);
        const s = heuristicSynthesis(f);
        expect(s.bullets.map((b) => b.key)).toEqual([...BULLET_KEYS]);
        expect(s.verdict.length).toBeGreaterThan(0);
    });

    it("marks a proposal-opened-no-reply deal as high dark-social risk", () => {
        const activities = [
            { opportunity_id: "opp_1", type: "PROPOSAL_OPENED", occurred_at: daysAgo(1), summary: "opened" },
            { opportunity_id: "opp_1", type: "PROPOSAL_OPENED", occurred_at: daysAgo(2), summary: "opened" },
        ];
        const f = extractFeatures(opp, activities, null, NOW);
        const s = heuristicSynthesis(f);
        const dark = s.bullets.find((b) => b.key === "dark_social")!;
        expect(dark.severity).toBe("high");
        expect(dark.detail).toMatch(/zero replies/);
    });

    it("escalates silence when past the deadline and calls it out in the verdict", () => {
        const activities = [{ opportunity_id: "opp_1", type: "REPLY", occurred_at: daysAgo(30), summary: "ok" }];
        const window = { current_ceiling: 30, status: "DECAYING", grace_period_hours: 48, next_gate_deadline: daysAhead(0) };
        const f = extractFeatures(opp, activities, window, NOW);
        const s = heuristicSynthesis(f);
        const silence = s.bullets.find((b) => b.key === "silence_gaps")!;
        expect(silence.severity).toBe("high");
        expect(s.verdict).toMatch(/prolonged silence/);
    });

    it("stays calm when engagement is healthy", () => {
        const activities = [
            { opportunity_id: "opp_1", type: "REPLY", occurred_at: daysAgo(1), summary: "thanks" },
            { opportunity_id: "opp_1", type: "MEETING", occurred_at: daysAgo(2), summary: "demo" },
        ];
        const window = { current_ceiling: 90, status: "ARMED", grace_period_hours: 72, next_gate_deadline: daysAhead(20) };
        const f = extractFeatures(opp, activities, window, NOW);
        const s = heuristicSynthesis(f);
        expect(s.verdict).toMatch(/Holding steady/);
        expect(s.bullets.every((b) => b.severity === "low")).toBe(true);
    });
});

describe("parseAiSynthesis", () => {
    const heuristic = heuristicSynthesis(extractFeatures(opp, [], null, NOW));

    it("parses well-formed JSON with all three keys", () => {
        const out = JSON.stringify({
            bullets: [
                { key: "silence_gaps", detail: "12 days dark.", severity: "high" },
                { key: "dark_social", detail: "Opens without replies.", severity: "medium" },
                { key: "competitor_signals", detail: "Incumbent in the mix.", severity: "low" },
            ],
            verdict: "Re-arm now.",
        });
        const parsed = parseAiSynthesis(out, heuristic)!;
        expect(parsed).not.toBeNull();
        expect(parsed.bullets.map((b) => b.key)).toEqual([...BULLET_KEYS]);
        expect(parsed.bullets[0].detail).toBe("12 days dark.");
        expect(parsed.verdict).toBe("Re-arm now.");
    });

    it("strips markdown fences and recovers the object", () => {
        const out = "```json\n" + JSON.stringify({
            bullets: [
                { key: "silence_gaps", detail: "a", severity: "high" },
                { key: "dark_social", detail: "b", severity: "high" },
                { key: "competitor_signals", detail: "c", severity: "high" },
            ],
            verdict: "v",
        }) + "\n```";
        const parsed = parseAiSynthesis(out, heuristic)!;
        expect(parsed.verdict).toBe("v");
    });

    it("backfills missing keys from the heuristic", () => {
        const out = JSON.stringify({
            bullets: [{ key: "silence_gaps", detail: "only one", severity: "high" }],
            verdict: "partial",
        });
        const parsed = parseAiSynthesis(out, heuristic)!;
        expect(parsed.bullets.map((b) => b.key)).toEqual([...BULLET_KEYS]);
        const comp = parsed.bullets.find((b) => b.key === "competitor_signals")!;
        expect(comp.detail).toBe(heuristic.bullets.find((b) => b.key === "competitor_signals")!.detail);
    });

    it("returns null when no JSON object is present", () => {
        expect(parseAiSynthesis("the model refused", heuristic)).toBeNull();
    });

    it("coerces an invalid severity to medium", () => {
        const out = JSON.stringify({
            bullets: [
                { key: "silence_gaps", detail: "x", severity: "catastrophic" },
                { key: "dark_social", detail: "y", severity: "medium" },
                { key: "competitor_signals", detail: "z", severity: "low" },
            ],
            verdict: "v",
        });
        const parsed = parseAiSynthesis(out, heuristic)!;
        expect(parsed.bullets.find((b) => b.key === "silence_gaps")!.severity).toBe("medium");
    });
});
