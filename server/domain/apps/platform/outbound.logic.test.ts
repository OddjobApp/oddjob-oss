import { describe, it, expect } from "vitest";
import {
    buildOutboundContext,
    heuristicDraft,
    buildDraftPrompt,
    parseDraft,
} from "./outbound.logic.js";

const NOW = new Date("2026-07-09T12:00:00.000Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

const opp = { opportunity_id: "opp_1", name: "Acme Platform", account_id: "acc_1", lead_id: "lead_1", amount: 500000, currency: "USD", stage: "NEGOTIATION", owner_rep: "Dana Reid" };
const account = { account_id: "acc_1", name: "Acme Corp", owner_rep: "Dana Reid" };
const lead = { lead_id: "lead_1", name: "Jordan Blake", email: "jordan@acme.example" };

describe("buildOutboundContext", () => {
    it("resolves recipient, silence, and competitor signal from real rows", () => {
        const activities = [
            { opportunity_id: "opp_1", type: "PROPOSAL_OPENED", occurred_at: daysAgo(12), summary: "Opened the proposal, also evaluating another vendor" },
        ];
        const window = { current_ceiling: 30, status: "DECAYING" };
        const c = buildOutboundContext(opp, account, lead, activities, window, NOW);

        expect(c.recipientName).toBe("Jordan Blake");
        expect(c.recipientEmail).toBe("jordan@acme.example");
        expect(c.accountName).toBe("Acme Corp");
        expect(c.silenceDays).toBe(12);
        expect(c.ceiling).toBe(30);
        expect(c.competitorHit).toMatch(/another vendor/);
        expect(c.ownerRep).toBe("Dana Reid");
    });

    it("degrades gracefully with no account, lead, window, or activity", () => {
        const c = buildOutboundContext(opp, null, null, [], null, NOW);
        expect(c.recipientName).toBeNull();
        expect(c.silenceDays).toBeNull();
        expect(c.ceiling).toBeNull();
        expect(c.competitorHit).toBeNull();
        expect(c.accountName).toBe("acc_1"); // falls back to account_id
    });
});

describe("heuristicDraft", () => {
    it("produces a grounded, addressed draft with a sign-off", () => {
        const c = buildOutboundContext(opp, account, lead, [{ opportunity_id: "opp_1", type: "REPLY", occurred_at: daysAgo(9), summary: "thanks" }], { current_ceiling: 60, status: "DECAYING" }, NOW);
        const d = heuristicDraft(c);
        expect(d.subject).toContain("Acme Corp");
        expect(d.body).toContain("Hi Jordan,");
        expect(d.body).toContain("Dana Reid"); // sign-off
        expect(d.body).toContain("9 days");
        expect(d.prompt).toContain("STRICT JSON");
        expect(d.rationale).toMatch(/ceiling at 60%/);
    });

    it("switches to a competitor-aware subject when a rival is in play", () => {
        const c = buildOutboundContext(opp, account, lead, [{ opportunity_id: "opp_1", type: "CALL", occurred_at: daysAgo(3), summary: "Comparing us versus the incumbent" }], null, NOW);
        const d = heuristicDraft(c);
        expect(d.subject).toMatch(/gut-check/);
        expect(d.body).toMatch(/writing/);
    });

    it("addresses an unknown recipient as 'there'", () => {
        const c = buildOutboundContext(opp, account, null, [], null, NOW);
        expect(heuristicDraft(c).body.startsWith("Hi there,")).toBe(true);
    });
});

describe("buildDraftPrompt", () => {
    it("embeds grounded facts and demands strict JSON", () => {
        const c = buildOutboundContext(opp, account, lead, [], { current_ceiling: 60, status: "DECAYING" }, NOW);
        const p = buildDraftPrompt(c);
        expect(p).toContain("Acme Platform");
        expect(p).toContain("$500,000");
        expect(p).toContain("ceiling 60%");
        expect(p).toContain("invent nothing");
        expect(p).toContain('{"subject"');
    });
});

describe("parseDraft", () => {
    const fallback = { prompt: "p", subject: "FB SUBJECT", body: "FB BODY", rationale: "r" };

    it("parses clean JSON", () => {
        const out = JSON.stringify({ subject: "Quick question", body: "Hi Jordan,\nLet's reconnect.\nDana" });
        const d = parseDraft(out, fallback);
        expect(d.subject).toBe("Quick question");
        expect(d.body).toContain("reconnect");
    });

    it("strips ```json fences", () => {
        const out = "```json\n" + JSON.stringify({ subject: "S", body: "B" }) + "\n```";
        expect(parseDraft(out, fallback)).toEqual({ subject: "S", body: "B" });
    });

    it("falls back on unparseable output", () => {
        expect(parseDraft("the model refused", fallback)).toEqual({ subject: "FB SUBJECT", body: "FB BODY" });
    });

    it("falls back per-field when a field is blank", () => {
        const out = JSON.stringify({ subject: "  ", body: "Real body" });
        const d = parseDraft(out, fallback);
        expect(d.subject).toBe("FB SUBJECT");
        expect(d.body).toBe("Real body");
    });
});
