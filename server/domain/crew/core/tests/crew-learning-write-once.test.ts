/**
 * The round's learning writes must each happen exactly once.
 *
 * 70c75a386 added a second copy of the knowledge, critique and issue calls
 * keyed on the classified topic instead of the user's message. Nothing failed:
 * every qualifying round quietly banked its conclusions twice and inserted two
 * crew_issues rows, and because raiseIssueIfUnresolved also publishes
 * BLOCKER_CREATED, the blocker event fired twice per round too.
 *
 * Counting the calls is the only thing that catches that, so it is pinned here.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

const learningCalls = {
    writeBackKnowledge: vi.fn(async () => ({ entriesWritten: 1, agentsUpdated: [] })),
    writeBackCritique: vi.fn(async () => true),
    raiseIssueIfUnresolved: vi.fn(async () => null),
    recordIntentObservations: vi.fn(async () => undefined),
};

const beliefCalls = {
    recordPositions: vi.fn(async () => undefined),
    scoreRound: vi.fn(async () => undefined),
};

vi.mock("../crew-learning.service.js", () => ({
    crewLearningService: learningCalls,
    CrewLearningService: class {},
}));

vi.mock("../crew-beliefs.service.js", () => ({
    crewBeliefsService: beliefCalls,
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { crewOrchestratorService } = await import("../crew-orchestrator.service.js");

/** Lets the setImmediate the learning loop defers to actually run. */
const flushDeferred = () => new Promise((resolve) => setImmediate(resolve));

const MESSAGE = "how should we shard the ingest queue?";

function scope(overrides: Record<string, unknown> = {}) {
    return {
        orgId: 7,
        session: { id: 42 },
        round: 3,
        message: MESSAGE,
        topic: "General",
        intent: "Analysis",
        topicResult: { confidence: 0.6 },
        intentResult: { confidence: 0.7 },
        projectId: null,
        members: [{ id: 1, name: "Copilot" }],
        speakers: [{ id: 1, name: "Copilot" }, { id: 2, name: "Analyst" }],
        roundTurns: [
            { id: 100, speakerType: "user", agentCardId: null, content: MESSAGE },
            { id: 101, speakerType: "agent", agentCardId: 1, content: "Shard by tenant." },
        ],
        triage: { mode: "discussion" },
        supervisorResult: {
            output: {
                consensus: "Shard by tenant id.",
                consensusLevel: 20,
                critique: "The tradeoff was not costed.",
                notes: ["Rebalancing was not discussed."],
                positions: [],
                intents: [],
            },
        },
        ...overrides,
    } as any;
}

const run = async (s: any) => {
    (crewOrchestratorService as any).scheduleRoundLearning(s);
    await flushDeferred();
    await flushDeferred();
};

describe("round learning writes", () => {
    beforeEach(() => {
        for (const fn of [...Object.values(learningCalls), ...Object.values(beliefCalls)]) {
            fn.mockClear();
        }
    });

    it("banks knowledge, critique and issues once each per round", async () => {
        await run(scope());

        expect(learningCalls.writeBackKnowledge).toHaveBeenCalledTimes(1);
        expect(learningCalls.writeBackCritique).toHaveBeenCalledTimes(1);
        expect(learningCalls.raiseIssueIfUnresolved).toHaveBeenCalledTimes(1);
        expect(learningCalls.recordIntentObservations).toHaveBeenCalledTimes(1);
    });

    it("keys the stored subject on the user's message, not the coarse topic", async () => {
        await run(scope());

        // The subject reaches the stored text: entries read `On "<subject>": ...`
        // and issues are titled `Unresolved: <subject>`. "General" there is noise.
        expect(learningCalls.writeBackKnowledge).toHaveBeenCalledWith(
            7, expect.anything(), expect.anything(), MESSAGE, null,
        );
        expect(learningCalls.raiseIssueIfUnresolved).toHaveBeenCalledWith(
            expect.objectContaining({ topic: MESSAGE }),
        );
    });

    it("aims the critique at the agent that owns the last agent turn", async () => {
        // The last speaker in the roster is Analyst, but Analyst never spoke —
        // its turn was skipped. Crediting the critique to it would teach the
        // lesson to the wrong agent.
        await run(scope());

        expect(learningCalls.writeBackCritique).toHaveBeenCalledWith(
            7,
            expect.objectContaining({ id: 1, name: "Copilot" }),
            expect.anything(),
            MESSAGE,
            null,
        );
        // toHaveBeenCalledWith matches any call, so assert the wrong agent was
        // never taught: the duplicate this test exists for credited Analyst.
        const critiquedNames = learningCalls.writeBackCritique.mock.calls.map(
            (call: any[]) => call[1]?.name,
        );
        expect(critiquedNames).toEqual(["Copilot"]);
    });

    it("banks nothing for a conversational round", async () => {
        await run(scope({ triage: { mode: "conversational" } }));

        expect(learningCalls.writeBackKnowledge).not.toHaveBeenCalled();
        expect(learningCalls.raiseIssueIfUnresolved).not.toHaveBeenCalled();
        expect(learningCalls.recordIntentObservations).not.toHaveBeenCalled();
    });

    it("banks nothing when the supervisor produced no output", async () => {
        await run(scope({ supervisorResult: { output: null } }));

        expect(learningCalls.writeBackKnowledge).not.toHaveBeenCalled();
        expect(learningCalls.raiseIssueIfUnresolved).not.toHaveBeenCalled();
    });
});
