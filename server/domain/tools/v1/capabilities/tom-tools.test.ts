/**
 * Consent gating on the ToM tools.
 *
 * These read inferred psychological state about a named person, so the property
 * that matters is what happens when consent is ABSENT — the default, and the
 * state every user starts in. A gate that fails open is worse than no gate,
 * because it looks like protection.
 *
 * Session scope is the other half: "approved for this session" is only true if a
 * grant from a different session is treated as no grant at all.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let consentRow: Record<string, any> | undefined;
const createdRequests: any[] = [];
let updatedSet: Record<string, any> = {};

const selectChain = () => ({
    from: () => selectChain(),
    where: () => selectChain(),
    limit: async () => (consentRow ? [consentRow] : []),
});

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => selectChain(),
        update: () => ({
            set: (v: Record<string, any>) => { updatedSet = v; return { where: async () => undefined }; },
        }),
    },
}));
vi.mock("@shared/schema/agent/theory-of-mind.js", () => ({
    theoryOfMind: { organizationId: "org", userId: "user", accessConsent: "c", consentSessionId: "s" },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn() }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock("@domain/integrations/core/approval.service.js", () => ({
    approvalService: {
        createApprovalRequest: vi.fn(async (input: any) => {
            createdRequests.push(input);
            return { id: 99 };
        }),
    },
}));

const profileState = {
    cognitiveState: { frustration: 10, confusion: 0, urgency: 0, explorationVsGoal: 50, assessedAt: null },
    epistemicStates: [{ topic: "billing", summary: "explained billing", informedBy: "a", informedAt: "2026-01-01T00:00:00.000Z", confidence: 100 }],
    beliefs: [{ topic: "pricing", proposition: "it is free", alignment: "misaligned", groundTruth: "it is metered", confidence: 80, sourceEvidence: "", observedAt: "", pinned: false }],
    knowledgeGaps: [{ topic: "sso", relatedGoal: "", relevanceScore: 50, dismissed: false, detectedAt: "" }],
    oceanProfile: { openness: 0.9, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, confidence: 80, observationCount: 10, lastCalibratedAt: null },
};
vi.mock("@domain/agents/core/theory-of-mind.service.js", () => ({
    theoryOfMindService: { getToMState: vi.fn(async () => profileState) },
}));

const { TOM_TOOLS } = await import("./tom-tools.js");

const ctx = (sessionId: string | null = "sess-1") =>
    ({ organizationId: 7, userId: "u1", sessionId, agentId: "agent-1" }) as any;

beforeEach(() => {
    consentRow = undefined;
    createdRequests.length = 0;
    updatedSet = {};
    // The gate is behind ENABLE_TOM_PIN_CONSENT_GATE and ships OFF, pending the
    // PIN flow (see the TODO in consentState). These tests describe the gate's
    // behaviour, so they enable it rather than inheriting whatever the ambient
    // environment happens to be — without this they failed everywhere the flag
    // was unset, which read as a broken suite rather than a switched-off control.
    // What the DISABLED default actually does is pinned separately, below.
    vi.stubEnv("ENABLE_TOM_PIN_CONSENT_GATE", "true");
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("reads are refused without consent", () => {
    it.each(["get_user_profile", "check_user_knows"])("%s refuses when never asked", async name => {
        const result: any = await TOM_TOOLS[name].execute({ topic: "billing" }, ctx());

        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("never_asked");
        // No profile content may leak into a refusal.
        expect(JSON.stringify(result)).not.toContain("billing");
    });

    it("refuses while the request is still pending", async () => {
        consentRow = { accessConsent: "pending", consentSessionId: "sess-1" };

        const result: any = await TOM_TOOLS.get_user_profile.execute({}, ctx());
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("awaiting_user");
    });

    it("refuses after a refusal, and does not invite another ask", async () => {
        consentRow = { accessConsent: "denied", consentSessionId: "sess-1" };

        const result: any = await TOM_TOOLS.get_user_profile.execute({}, ctx());
        expect(result.allowed).toBe(false);
        expect(result.nextStep).toBeNull();
    });
});

describe("consent is scoped to the session", () => {
    it("allows a read in the session it was granted in", async () => {
        consentRow = { accessConsent: "granted", consentSessionId: "sess-1" };

        const result: any = await TOM_TOOLS.get_user_profile.execute({}, ctx("sess-1"));
        expect(result.success).toBe(true);
        expect(result.profile.knownTopics).toContain("billing");
    });

    it("refuses the SAME grant from a different session", async () => {
        // The whole meaning of "good for this session": a grant does not carry
        // over, so returning tomorrow re-asks rather than silently continuing.
        consentRow = { accessConsent: "granted", consentSessionId: "sess-1" };

        const result: any = await TOM_TOOLS.get_user_profile.execute({}, ctx("sess-2"));
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe("granted_in_another_session");
    });

    it("refuses when there is no session at all", async () => {
        consentRow = { accessConsent: "granted", consentSessionId: "sess-1" };

        const result: any = await TOM_TOOLS.get_user_profile.execute({}, ctx(null));
        expect(result.allowed).toBe(false);
    });
});

describe("what a granted read exposes", () => {
    beforeEach(() => { consentRow = { accessConsent: "granted", consentSessionId: "sess-1" }; });

    it("withholds the raw OCEAN scores", async () => {
        // The personality estimate is the part a person is most likely to object
        // to being quoted back at them; agents get behaviour, not numbers.
        const result: any = await TOM_TOOLS.get_user_profile.execute({}, ctx());

        expect(JSON.stringify(result)).not.toContain("openness");
        expect(result.profile.oceanProfile).toBeUndefined();
    });

    it("surfaces misaligned beliefs with their correction", async () => {
        const result: any = await TOM_TOOLS.get_user_profile.execute({}, ctx());

        expect(result.profile.misalignedBeliefs[0]).toMatchObject({
            topic: "pricing",
            believes: "it is free",
            actually: "it is metered",
        });
    });

    it("answers check_user_knows with a definite boolean", async () => {
        // "No record" and "does not know" are the same instruction to an agent;
        // an ambiguous null would invite it to guess.
        const known: any = await TOM_TOOLS.check_user_knows.execute({ topic: "Billing" }, ctx());
        const unknown: any = await TOM_TOOLS.check_user_knows.execute({ topic: "sso" }, ctx());

        expect(known.known).toBe(true);
        expect(unknown.known).toBe(false);
        expect(unknown.informedAt).toBeNull();
    });
});

describe("requesting access", () => {
    it("raises a session-scoped approval request the user will see", async () => {
        await TOM_TOOLS.request_user_profile_access.execute(
            { reason: "so I can skip what you already know" },
            ctx(),
        );

        expect(createdRequests).toHaveLength(1);
        expect(createdRequests[0].context).toMatchObject({ kind: "tom_access", scope: "session" });
        // executionId is the idempotency key, so a second ask in one session
        // reuses the pending row instead of stacking notifications.
        expect(createdRequests[0].executionId).toContain("sess-1");
        expect(updatedSet.accessConsent).toBe("pending");
    });

    it("does not ask again once refused", async () => {
        consentRow = { accessConsent: "denied", consentSessionId: "sess-1" };

        const result: any = await TOM_TOOLS.request_user_profile_access.execute(
            { reason: "please reconsider" },
            ctx(),
        );

        expect(createdRequests).toHaveLength(0);
        expect(result.success).toBe(false);
    });

    it("is a no-op when access is already granted for the session", async () => {
        consentRow = { accessConsent: "granted", consentSessionId: "sess-1" };

        const result: any = await TOM_TOOLS.request_user_profile_access.execute(
            { reason: "checking" },
            ctx(),
        );

        expect(result.alreadyGranted).toBe(true);
        expect(createdRequests).toHaveLength(0);
    });
});

/**
 * What ships today.
 *
 * ENABLE_TOM_PIN_CONSENT_GATE is unset in every environment, so consentState()
 * short-circuits to allowed:true for everyone and none of the behaviour above is
 * in force. That is a deliberate hold pending the PIN flow — but a switched-off
 * privacy control should be asserted, not inferred from a TODO. If someone
 * enables the gate, this test fails and points them at the suite above, which is
 * the behaviour they are turning on.
 */
describe("with the gate disabled (the shipped default)", () => {
    beforeEach(() => {
        vi.stubEnv("ENABLE_TOM_PIN_CONSENT_GATE", "");
    });

    it("reads a profile with no consent recorded at all", async () => {
        consentRow = undefined;

        const result: any = await TOM_TOOLS.get_user_profile.execute({}, ctx());

        expect(result.success).toBe(true);
        expect(result.profile).toBeTruthy();
        expect(result.profile.beliefs).toHaveLength(1);
    });

    it("reads a profile the user explicitly denied", async () => {
        consentRow = { accessConsent: "denied", consentSessionId: "sess-1" };

        const result: any = await TOM_TOOLS.get_user_profile.execute({}, ctx());

        expect(result.success).toBe(true);
        expect(result.profile).toBeTruthy();
    });

    it("also exposes the raw OCEAN scores the gated path withholds", async () => {
        consentRow = undefined;

        const result: any = await TOM_TOOLS.get_user_profile.execute({}, ctx());

        // Turning the gate off does more than skip the consent check — it widens
        // what a read returns. Worth stating outright: the disabled state is not
        // "the gate, minus the prompt".
        expect(result.profile.oceanProfile).toMatchObject({ openness: 0.9 });
    });
});
