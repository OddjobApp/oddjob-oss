/**
 * What the supervisor files after reading a round, and the one figure it is not
 * allowed to report.
 *
 * Consensus among a single speaker is not low — it is undefined. A solo room
 * once produced "20% consensus" and MEDIUM unresolved-disagreement issues out
 * of a discussion that contained no disagreement, because the supervisor was
 * asked to score agreement and duly scored it. The guard against that was a
 * dozen lines in the middle of a 309-line method with nothing pinning it.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const inserted: Array<{ table: string; rows: any[] }> = [];

vi.mock("@server/database_service.js", () => ({
    db: {
        insert: (table: any) => ({
            values: (rows: any) => {
                const name = table?.[Symbol.for("drizzle:Name")] ?? table?._?.name ?? "unknown";
                const list = Array.isArray(rows) ? rows : [rows];
                inserted.push({ table: String(name), rows: list });
                return {
                    returning: async () => list.map((r, i) => ({ id: 900 + i, ...r })),
                    then: (res: any) => res(undefined),
                };
            },
        }),
        select: () => ({
            from: () => ({
                where: () => ({ orderBy: () => ({ limit: async () => [] }) }),
            }),
        }),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

// These moved out of CrewOrchestratorService into crew-supervisor-round.service.ts;
// they are exported functions now rather than methods reached through `as any`.
const svc = (await import("../crew-supervisor-round.service.js")) as any;

const agentTurn = (id: number, agentCardId: number) => ({
    id,
    speakerType: "agent",
    agentCardId,
    speakerName: "A",
    content: "x",
});

const output = (over: Record<string, unknown> = {}) =>
    ({
        critique: null,
        consensus: null,
        summary: null,
        notes: [],
        intents: [],
        positions: [],
        plan: null,
        directive: null,
        consensusLevel: 20,
        divergenceQuestion: "who is right?",
        activeTopic: "",
        nextSteps: "",
        ...over,
    }) as any;

describe("solo-round consensus", () => {
    it("discards a consensus score from a one-agent round", () => {
        const out = output();
        svc.nullifySoloRoundConsensus(out, [agentTurn(1, 5), agentTurn(2, 5)], 3);

        // Two turns, but one distinct speaker — there was nobody to agree with.
        expect(out.consensusLevel).toBeNull();
        expect(out.divergenceQuestion).toBeNull();
    });

    it("keeps the score once two different agents have spoken", () => {
        const out = output();
        svc.nullifySoloRoundConsensus(out, [agentTurn(1, 5), agentTurn(2, 6)], 3);

        expect(out.consensusLevel).toBe(20);
        expect(out.divergenceQuestion).toBe("who is right?");
    });

    it("leaves an already-null score alone", () => {
        const out = output({ consensusLevel: null, divergenceQuestion: "kept" });
        svc.nullifySoloRoundConsensus(out, [agentTurn(1, 5)], 3);

        expect(out.consensusLevel).toBeNull();
        // Nothing to discard, so the divergence question is not touched either.
        expect(out.divergenceQuestion).toBe("kept");
    });

    it("keeps critique and summary, which are not judgements about agreement", () => {
        const out = output({ critique: "unresponsive", summary: "we covered sharding" });
        svc.nullifySoloRoundConsensus(out, [agentTurn(1, 5)], 3);

        expect(out.consensusLevel).toBeNull();
        expect(out.critique).toBe("unresponsive");
        expect(out.summary).toBe("we covered sharding");
    });
});

describe("supervisor notes", () => {
    beforeEach(() => {
        inserted.length = 0;
    });

    it("files nothing, and writes no row, when the supervisor produced nothing", async () => {
        const pending = await svc.persistSupervisorNotes({
            orgId: 7,
            sessionId: 42,
            round: 3,
            output: output(),
            lastAgentTurn: undefined,
        });

        expect(pending).toEqual([]);
        expect(inserted).toHaveLength(0);
    });

    it("files each kind the supervisor produced, in order", async () => {
        const pending = await svc.persistSupervisorNotes({
            orgId: 7,
            sessionId: 42,
            round: 3,
            output: output({
                critique: "unresponsive",
                consensus: "shard by tenant",
                summary: "we covered sharding",
                notes: ["rebalancing unaddressed"],
                intents: ["capacity-planning"],
            }),
            lastAgentTurn: { id: 101 } as any,
        });

        expect(pending.map((p: any) => p.noteType)).toEqual([
            "critique",
            "consensus",
            "summary",
            "note",
            "intent",
        ]);
        expect(inserted).toHaveLength(1);
        expect(inserted[0].rows).toHaveLength(5);
    });

    it("attaches the critique to the turn it was aimed at, and nothing else", async () => {
        await svc.persistSupervisorNotes({
            orgId: 7,
            sessionId: 42,
            round: 3,
            output: output({ critique: "unresponsive", summary: "covered" }),
            lastAgentTurn: { id: 101 } as any,
        });

        const rows = inserted[0].rows;
        expect(rows.find((r: any) => r.noteType === "critique").targetTurnId).toBe(101);
        // A summary is about the round, not about one turn.
        expect(rows.find((r: any) => r.noteType === "summary").targetTurnId).toBeNull();
    });

    it("survives a critique with no agent turn to attach it to", async () => {
        await svc.persistSupervisorNotes({
            orgId: 7,
            sessionId: 42,
            round: 3,
            output: output({ critique: "unresponsive" }),
            lastAgentTurn: undefined,
        });

        expect(inserted[0].rows[0].targetTurnId).toBeNull();
    });
});

describe("supervisor plan", () => {
    beforeEach(() => {
        inserted.length = 0;
    });

    it("writes no row when the supervisor proposed no plan", async () => {
        const plan = await svc.persistSupervisorPlan({
            orgId: 7,
            sessionId: 42,
            round: 3,
            output: output(),
        });

        expect(plan).toBeNull();
        expect(inserted).toHaveLength(0);
    });

    it("persists the plan it did propose", async () => {
        const plan = await svc.persistSupervisorPlan({
            orgId: 7,
            sessionId: 42,
            round: 3,
            output: output({ plan: { title: "Shard rollout", steps: ["measure", "shard"] } }),
        });

        expect(plan).toEqual({ title: "Shard rollout", steps: ["measure", "shard"] });
        expect(inserted).toHaveLength(1);
    });
});

describe("supervisor directive", () => {
    beforeEach(() => {
        inserted.length = 0;
    });

    it("stays silent when it has no directive", async () => {
        const turn = await svc.postSupervisorDirective({
            orgId: 7,
            sessionId: 42,
            round: 3,
            output: output(),
            lastAgentTurn: { id: 101 } as any,
        });

        expect(turn).toBeNull();
        expect(inserted).toHaveLength(0);
    });

    it("speaks into the room in reply to the last agent turn", async () => {
        const turn = await svc.postSupervisorDirective({
            orgId: 7,
            sessionId: 42,
            round: 3,
            output: output({ directive: "@Analyst, cost the tradeoff." }),
            lastAgentTurn: { id: 101 } as any,
        });

        expect(turn.content).toBe("@Analyst, cost the tradeoff.");
        expect(turn.speakerType).toBe("supervisor");
        expect(turn.inReplyToTurnId).toBe(101);
    });
});
