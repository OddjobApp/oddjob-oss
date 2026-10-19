import { describe, it, expect } from "vitest";
import {
    buildOnboardingPacket,
    provisioningStages,
    markHandedOff,
} from "./onboarding.logic.js";

const opp = {
    opportunity_id: "opp_1",
    name: "Acme Platform",
    account_id: "acc_1",
    lead_id: "lead_1",
    amount: 500000,
    currency: "USD",
    stage: "CLOSED_WON",
    owner_rep: "Dana Reid",
    closed_at: "2026-07-10T00:00:00.000Z",
};
const account = { account_id: "acc_1", name: "Acme Corp", domain: "acme.example", industry: "SaaS", segment: "ENTERPRISE", owner_rep: "Dana Reid" };
const lead = { lead_id: "lead_1", name: "Jordan Blake", email: "jordan@acme.example" };

describe("buildOnboardingPacket", () => {
    it("assembles account, contact, and terms from the won deal", () => {
        const p = buildOnboardingPacket(opp, account, lead);
        expect(p.deal_name).toBe("Acme Platform");
        expect(p.account).toMatchObject({ name: "Acme Corp", domain: "acme.example", industry: "SaaS", segment: "ENTERPRISE", owner_rep: "Dana Reid" });
        expect(p.primary_contact).toEqual({ name: "Jordan Blake", email: "jordan@acme.example" });
        expect(p.terms).toEqual({ amount: 500000, currency: "USD", stage: "CLOSED_WON", closed_at: "2026-07-10T00:00:00.000Z" });
    });

    it("degrades gracefully with no account or lead", () => {
        const p = buildOnboardingPacket(opp, null, null);
        expect(p.account.name).toBe("acc_1"); // falls back to account_id
        expect(p.account.domain).toBeNull();
        expect(p.primary_contact).toEqual({ name: null, email: null });
        expect(p.terms.amount).toBe(500000);
    });
});

describe("provisioningStages", () => {
    it("leads with the Forge scaffold, then mirrors the follow-up blueprints", () => {
        const stages = provisioningStages(["Won-Deal Handoff", "Onboarding Kickoff"]);
        expect(stages[0].key).toBe("forge_scaffold");
        expect(stages[0].status).toBe("provisioning");
        expect(stages.slice(1).map((s) => s.name)).toEqual(["Won-Deal Handoff", "Onboarding Kickoff"]);
        expect(stages.slice(1).every((s) => s.status === "pending")).toBe(true);
        expect(stages[1].key).toBe("won_deal_handoff"); // slugified
    });

    it("falls back to a default kickoff stage when no blueprints are declared", () => {
        const stages = provisioningStages([]);
        expect(stages).toHaveLength(2);
        expect(stages[1].name).toBe("Onboarding Kickoff");
    });
});

describe("markHandedOff", () => {
    it("completes the Forge stage and advances the first remaining stage", () => {
        const stages = provisioningStages(["Won-Deal Handoff", "Onboarding Kickoff"]);
        const after = markHandedOff(stages);
        expect(after[0].status).toBe("done"); // forge scaffold complete
        expect(after[1].status).toBe("provisioning"); // first blueprint now owned by the cycle
        expect(after[2].status).toBe("pending");
    });

    it("is a no-op-safe transform that keeps stage identity/order", () => {
        const stages = provisioningStages(["Kickoff"]);
        const after = markHandedOff(stages);
        expect(after.map((s) => s.key)).toEqual(stages.map((s) => s.key));
    });
});
