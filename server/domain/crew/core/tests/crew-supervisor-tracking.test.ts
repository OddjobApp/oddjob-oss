import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The room in crew-1790689275890 ran 38 rounds and recorded nothing: zero
 * supervisor notes, zero commitments, an empty memory row — because every
 * requirement-carrying message was an answer task and skipped the review, and
 * every review that did run failed invisibly.
 *
 * These pin the fix: answer-task rounds still get bookkeeping without the
 * spoken directive; a failed review leaves a durable note saying so; and a
 * user's stated requirement lands in room memory whether or not a model ever
 * saw it.
 */

const inserts: Array<{ table: any; values: any }> = [];
const updates: Array<{ table: any; values: any }> = [];
let selectRows: any[] = [];

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => {
            const c: any = {
                from: () => c,
                where: () => c,
                orderBy: () => c,
                innerJoin: () => c,
                leftJoin: () => c,
                limit: () => Promise.resolve(selectRows),
                // Queries that end at .where() or .from() still resolve to rows.
                then: (resolve: (v: any) => void) => Promise.resolve(selectRows).then(resolve),
            };
            return c;
        },
        insert: (table: any) => ({
            values: (values: any) => {
                inserts.push({ table, values });
                const p = Promise.resolve([{ id: 1 }]);
                return Object.assign(p, {
                    returning: () => Promise.resolve([{ id: 1, title: values?.title ?? "t", steps: values?.steps ?? [] }]),
                });
            },
        }),
        update: (table: any) => ({
            set: (values: any) => {
                updates.push({ table, values });
                return { where: () => Promise.resolve([]) };
            },
        }),
    },
}));

const syncCalls: any[] = [];
vi.mock("../crew-learning.service.js", () => ({
    crewLearningService: {
        syncBlackboardArtifacts: async (params: any) => {
            syncCalls.push(params);
            return { decisionsCreated: 0, claimsCreated: 0, commitmentsCreated: 0 };
        },
    },
}));

vi.mock("../crew-stream.service.js", () => ({
    crewStreamService: { publish: async () => {} },
}));

import { runSupervisor } from "../crew-supervisor-round.service.js";
import { crewSupervisorService } from "../crew-supervisor.service.js";
import { crewLearningService } from "../crew-learning.service.js";
import { digestToolOutput } from "../crew-tools.service.js";
import { crewSessions, supervisorNotes, crewPlans, crewTurns, crewClaims } from "@shared/schema/index.js";
import { extractUserRequirement } from "../crew-orchestrator.service.js";
import { isConfirmationMessage } from "../crew-triage.service.js";

const AGENT_TURN: any = {
    id: 5,
    speakerType: "agent",
    speakerName: "Copilot",
    agentCardId: 7,
    content: "I reviewed the feed and attached the county list.",
    toolsUsed: [],
};

const BASE = {
    orgId: 291,
    sessionId: 484,
    round: 9,
    topic: "test",
    roundTurns: [AGENT_TURN],
    roster: [{ name: "Copilot", description: "a" }],
    cost: { modelCalls: 0, generationMs: 0, toolCalls: 0 },
    projectId: null,
    sessionKey: "crew-test",
};

function healthyOutput(overrides: Record<string, unknown> = {}) {
    return {
        critique: "Copilot's claim needs a citation.",
        consensus: "The county source is agreed.",
        summary: "The room chose Orange County as the target.",
        notes: ["County source chosen."],
        intents: [],
        plan: { title: "Build intake", steps: [{ order: 1, description: "Attach county feed" }] },
        positions: [{ agent: "Copilot", proposition: "Use the county list", confidence: 80 }],
        directive: "@Copilot, draft the intake.",
        activeTopic: "Distressed property intake",
        nextSteps: "Attach the feed.",
        consensusLevel: 80,
        divergenceQuestion: null,
        stageGating: null,
        decisions: [{ statement: "Target is Orange County", confidence: 90 }],
        claims: [],
        commitments: [{ title: "Attach county feed", owner: "Copilot" }],
        ...overrides,
    };
}

describe("runSupervisor — trackOnly and failure visibility", () => {
    beforeEach(() => {
        inserts.splice(0);
        syncCalls.splice(0);
        selectRows = [];
        vi.restoreAllMocks();
    });

    it("a track-only round records the review but never speaks", async () => {
        vi.spyOn(crewSupervisorService, "review").mockResolvedValue(healthyOutput());

        const result = await runSupervisor({ ...BASE, trackOnly: true });

        // Bookkeeping ran: notes, plan, blackboard sync.
        expect(inserts.some((i) => i.table === supervisorNotes)).toBe(true);
        expect(inserts.some((i) => i.table === crewPlans)).toBe(true);
        expect(syncCalls).toHaveLength(1);
        expect(result.plan?.title).toBe("Build intake");
        expect(result.activeTopic).toBe("Distressed property intake");

        // But nothing was spoken and no breakout could form.
        expect(result.turn).toBeNull();
        expect(inserts.every((i) => i.table !== crewTurns)).toBe(true);
    });

    it("a normal round still posts the supervisor's directive", async () => {
        vi.spyOn(crewSupervisorService, "review").mockResolvedValue(healthyOutput());

        const result = await runSupervisor(BASE);
        expect(result.turn).not.toBeNull();
        expect(inserts.some((i) => i.table === crewTurns)).toBe(true);
    });

    it("a failed review leaves a durable note instead of silence", async () => {
        vi.spyOn(crewSupervisorService, "review").mockResolvedValue(null);

        const result = await runSupervisor(BASE);

        expect(result.error).toMatch(/no usable output|no output/i);
        const note = inserts.find((i) => i.table === supervisorNotes);
        expect(note).toBeDefined();
        expect(note?.values.noteType).toBe("note");
        expect(note?.values.content).toMatch(/not tracked/);
    });

    it("skips entirely when no agent spoke — the failure note does not fire on an empty round", async () => {
        const review = vi.spyOn(crewSupervisorService, "review");

        const result = await runSupervisor({ ...BASE, roundTurns: [] });

        expect(result.output).toBeNull();
        expect(review).not.toHaveBeenCalled();
        expect(inserts).toHaveLength(0);
    });
});

describe("extractUserRequirement — the user's own words are the record", () => {
    it("captures the requirement the room kept restating", () => {
        const r = extractUserRequirement(
            "I want to build a distressed realestate flow to identify properties that are behind in taxes. I want to be able to search by zipcode and see the results display",
        );
        expect(r).toContain("distressed realestate flow");
        expect(r).toContain("search by zipcode");
    });

    it("captures 'lets use <url>' — a data-source decision", () => {
        const r = extractUserRequirement("Lets use https://liensuite.com/counties/orange-county-ca");
        expect(r).toContain("liensuite.com");
    });

    it("captures scoped configuration answers", () => {
        expect(
            extractUserRequirement("Initially Orange County California, but it should be configureable."),
        ).not.toBeNull();
    });

    it("ignores confirmations — they approve a requirement, they don't state one", () => {
        for (const m of ["Yes", "yes", "1", "Yes proceed", "ok", "Yes, please", "go ahead"]) {
            expect(extractUserRequirement(m)).toBeNull();
        }
    });

    it("ignores confirmations carrying instructions — the requirement was already stated", () => {
        expect(extractUserRequirement("Yes, please upload the attachment")).toBeNull();
        expect(extractUserRequirement("Yes please call get_attachment_text")).toBeNull();
    });

    it("ignores card commands and injected payloads", () => {
        expect(extractUserRequirement('Apply contribution "contrib_abc123def456".')).toBeNull();
        expect(extractUserRequirement('Create flow "abc-123".')).toBeNull();
        expect(extractUserRequirement('[Signal Studio selection: {"signalId":"x","eventType":"Unknown"}] — more words here')).toBeNull();
    });

    it("ignores @mentions — a question to one agent is not a room requirement", () => {
        expect(extractUserRequirement("@Producer what would you add here?")).toBeNull();
    });

    it("ignores short pleasantries", () => {
        expect(extractUserRequirement("hi")).toBeNull();
        expect(extractUserRequirement("thanks")).toBeNull();
    });
});

describe("recordToolWorkClaims — firsthand work on the ledger", () => {
    const WORK_TURN: any = {
        id: 42,
        speakerType: "agent",
        speakerName: "Copilot",
        toolsUsed: [
            { name: "attach_url", ok: true, ms: 120, digest: "orange-county-delinquent.pdf" },
        ],
        createdAt: new Date("2026-02-10T00:00:00Z"),
    };

    beforeEach(() => {
        inserts.splice(0);
        updates.splice(0);
        selectRows = [];
    });

    it("files a supported claim per successful tool call, sourced to the turn", async () => {
        const { crewLearningService: real } = await vi.importActual<any>("../crew-learning.service.js");

        const created = await real.recordToolWorkClaims({
            sessionId: 484,
            organizationId: 291,
            roundTurns: [WORK_TURN],
        });

        expect(created).toBe(1);
        const row = inserts.find((i) => i.table === crewClaims);
        expect(row?.values.claim).toBe("Copilot ran attach_url — orange-county-delinquent.pdf");
        expect(row?.values.sourceTurnId).toBe(42);
        expect(row?.values.status).toBe("supported");
        expect(row?.values.createdBy).toBe("Copilot");
        expect(row?.values.evidence[0].label).toBe("attach_url");
    });

    it("records nothing for failed calls, meta-tools, or non-agent turns", async () => {
        const { crewLearningService: real } = await vi.importActual<any>("../crew-learning.service.js");

        const created = await real.recordToolWorkClaims({
            sessionId: 484,
            organizationId: 291,
            roundTurns: [
                { ...WORK_TURN, toolsUsed: [
                    { name: "get_blackboard", ok: true, ms: 3 },
                    { name: "browse_web", ok: false, ms: 40, error: "timeout" },
                ] },
                // A supervisor turn's tools are the ledger's own writes.
                { id: 43, speakerType: "supervisor", speakerName: "Room",
                  toolsUsed: [{ name: "attach_url", ok: true, ms: 5 }] },
            ],
        });

        expect(created).toBe(0);
        expect(inserts.every((i) => i.table !== crewClaims)).toBe(true);
    });

    it("does not duplicate a claim a retried round would re-derive", async () => {
        const { crewLearningService: real } = await vi.importActual<any>("../crew-learning.service.js");
        selectRows = [{ sourceTurnId: 42, claim: "Copilot ran attach_url — orange-county-delinquent.pdf" }];

        const created = await real.recordToolWorkClaims({
            sessionId: 484,
            organizationId: 291,
            roundTurns: [WORK_TURN],
        });

        expect(created).toBe(0);
        expect(inserts.every((i) => i.table !== crewClaims)).toBe(true);
    });

    it("merges a later round's same-speaker same-tool work into the standing claim", async () => {
        const { crewLearningService: real } = await vi.importActual<any>("../crew-learning.service.js");
        // An earlier round already filed "Copilot ran attach_url" from turn 40;
        // this round's turn 42 re-ran it with a different digest. The claim is
        // one standing row with accumulating evidence, not a row per round.
        selectRows = [{
            id: 9,
            sourceTurnId: 40,
            claim: "Copilot ran attach_url — stale-digest.pdf",
            evidence: [{ label: "attach_url", excerpt: "stale-digest.pdf" }],
        }];

        const created = await real.recordToolWorkClaims({
            sessionId: 484,
            organizationId: 291,
            roundTurns: [WORK_TURN],
        });

        expect(created).toBe(0);
        expect(inserts.every((i) => i.table !== crewClaims)).toBe(true);
        const merge = updates.find((u) => u.table === crewClaims);
        expect(merge?.values.claim).toBe("Copilot ran attach_url — orange-county-delinquent.pdf");
        expect(merge?.values.sourceTurnId).toBe(42);
        expect(merge?.values.evidence).toHaveLength(2);
    });

    it("keeps different tools and different speakers as separate claims", async () => {
        const { crewLearningService: real } = await vi.importActual<any>("../crew-learning.service.js");
        selectRows = [{
            id: 9,
            sourceTurnId: 40,
            claim: "Copilot ran attach_url — old.pdf",
            evidence: [{ label: "attach_url" }],
        }];

        const created = await real.recordToolWorkClaims({
            sessionId: 484,
            organizationId: 291,
            roundTurns: [{
                ...WORK_TURN,
                toolsUsed: [{ name: "google_search", ok: true, ms: 40, digest: "5 items" }],
            }],
        });

        expect(created).toBe(1);
        expect(updates.every((u) => u.table !== crewClaims)).toBe(true);
    });
});

describe("digestToolOutput", () => {
    it("digests a JSON array into a label list", () => {
        expect(digestToolOutput(JSON.stringify([{ name: "Alpha Feed" }, { name: "Beta Feed" }])))
            .toBe("2 items: Alpha Feed, Beta Feed");
    });

    it("digests a JSON object by its own naming field", () => {
        expect(digestToolOutput(JSON.stringify({ fileName: "report.pdf", attachmentId: 9 })))
            .toBe("report.pdf");
    });

    it("digests prose as its first non-empty line", () => {
        expect(digestToolOutput("\n\nAttached report.pdf to the room.\nSecond line."))
            .toBe("Attached report.pdf to the room.");
    });

    it("caps at one line and 160 chars", () => {
        const long = "x".repeat(300);
        const digest = digestToolOutput(long)!;
        expect(digest.length).toBeLessThanOrEqual(160);
        expect(digest.endsWith("…")).toBe(true);
    });

    it("returns undefined for empty output", () => {
        expect(digestToolOutput("")).toBeUndefined();
        expect(digestToolOutput("   \n  ")).toBeUndefined();
    });
});

describe("isConfirmationMessage", () => {
    it("matches the triage set with and without punctuation", () => {
        expect(isConfirmationMessage("Yes")).toBe(true);
        expect(isConfirmationMessage("Yes!")).toBe(true);
        expect(isConfirmationMessage("proceed.")).toBe(true);
        expect(isConfirmationMessage("build a pipeline")).toBe(false);
    });
});
