/**
 * The Executive Closing Brief.
 *
 * When this was extracted out of concludeSession it was verified the way a
 * string builder has to be — by byte-comparing rendered output, across ten
 * fixtures, against the pre-split implementation lifted verbatim out of git.
 * That comparison passed and was then deleted rather than committed: it was a
 * second copy of the builder, and freezing the output against it would have
 * blocked the next legitimate change to the brief. To repeat it, lift the
 * builder out of `git show 0c2a84289:server/domain/crew/core/crew-orchestrator.service.ts`
 * and compare.
 *
 * What remains are the properties worth holding: every section says what it
 * found or says plainly that it found nothing, so a thin room still reads as a
 * quiet meeting rather than a broken report.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@server/database_service.js", () => ({ db: {} }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

const { buildClosingBrief } = await import("../crew-session.service.js");

const build = (session: any, record: any) =>
    buildClosingBrief(session, record);

const emptyRecord = {
    turns: [],
    decisions: [],
    plans: [],
    commitments: [],
    notes: [],
    attachments: [],
    breakouts: [],
    generatedArtifacts: [],
};

const fullRecord = {
    ...emptyRecord,
    decisions: [
        { status: "accepted", statement: "Shard the ingest queue by tenant" },
        { status: "rejected", statement: "Buy a managed queue" },
    ],
    plans: [
        {
            title: "Shard rollout",
            steps: [
                { order: 1, description: "Measure current throughput", owner: "Analyst" },
                { order: 2, description: "Shard staging", owner: null },
            ],
        },
    ],
    notes: [
        { noteType: "summary", content: "We agreed on tenant sharding." },
        { noteType: "consensus", content: "Tenant isolation is the priority." },
        { noteType: "critique", content: "should not appear" },
        { noteType: "intent", content: "should not appear either" },
    ],
    attachments: [
        { displayName: "throughput.csv", uploadedBy: "ada" },
        { displayName: "diagram.png", uploadedBy: null },
    ],
    breakouts: [{ subTopic: "Rebalancing strategy", suggestedBy: "Supervisor" }],
    generatedArtifacts: [
        { tool: "render_app_surface", type: "instant_app", title: "Queue Monitor", url: "/apps/queue" },
        { tool: "propose_breakout_room", type: "crew_breakout", title: "Rebalancing", url: undefined },
    ],
};


describe("closing brief content", () => {
    it("states plainly what a thin room did not have", () => {
        const out = build({ title: null, nextSteps: null }, emptyRecord);

        // Empty headings would read as a broken report rather than a quiet room.
        expect(out).toContain("# Executive Meeting Closing Brief: CREW Meeting");
        expect(out).toContain("Discussion successfully concluded and consolidated.");
        expect(out).toContain("No formal decisions recorded.");
        expect(out).toContain("No generated applications or deliverables in this session.");
        expect(out).toContain("No attachments uploaded.");
        expect(out).toContain("No breakout sessions originated from this room.");
        expect(out).toContain("Meeting objectives achieved.");
    });

    it("falls back to the session's next steps when no plan was recorded", () => {
        const out = build({ title: "S", nextSteps: "Measure first" }, emptyRecord);

        expect(out).toContain("- Measure first");
        expect(out).not.toContain("Meeting objectives achieved.");
    });

    it("carries only summary and consensus into section 1", () => {
        const out = build({ title: "S", nextSteps: null }, fullRecord);

        expect(out).toContain("**SUMMARY**: We agreed on tenant sharding.");
        expect(out).toContain("**CONSENSUS**: Tenant isolation is the priority.");
        // A critique is about one agent's turn, not the room's outcome.
        expect(out).not.toContain("should not appear");
    });

    it("links a deliverable that has a url and leaves one that does not", () => {
        const out = build({ title: "S", nextSteps: null }, fullRecord);

        expect(out).toContain("- **Queue Monitor** (instant_app): [Open Resource](/apps/queue)");
        const artifactLines = out.split("\n").filter((l: string) => l.startsWith("- **"));
        expect(artifactLines).toContain("- **Rebalancing** (crew_breakout)");
    });

    it("names an uploader, or says participant when it does not know", () => {
        const out = build({ title: "S", nextSteps: null }, fullRecord);

        expect(out).toContain("**throughput.csv** (Uploaded by ada)");
        expect(out).toContain("**diagram.png** (Uploaded by participant)");
    });

    it("attributes a plan step to its owner only when it has one", () => {
        const out = build({ title: "S", nextSteps: null }, fullRecord);

        expect(out).toContain("- Step 1: Measure current throughput (@Analyst)");
        // The unowned step is the last line of the brief, so match the line itself.
        const stepLines = out.split("\n").filter((l: string) => l.startsWith("- Step "));
        expect(stepLines).toEqual([
            "- Step 1: Measure current throughput (@Analyst)",
            "- Step 2: Shard staging",
        ]);
    });

    it("keeps the sections in a fixed order including Scribe Studio deliverables", () => {
        const out = build({ title: "S", nextSteps: null }, fullRecord);
        const headings = [...out.matchAll(/^## \d\. .+$/gm)].map((m) => m[0]);

        expect(headings).toEqual([
            "## 1. Executive Summary & Consensus",
            "## 2. Key Decisions & Policy Directives",
            "## 3. Scribe Studio Deliverables & Longform Manuscripts",
            "## 4. Work Products & Generated Applications",
            "## 5. Uploaded Attachments & Source Data",
            "## 6. Breakout Sessions & Sub-Threads",
            "## 7. Action Items, Next Steps & Plan",
        ]);
    });

    it("includes commitments and action items in section 7", () => {
        const out = build({ title: "S", nextSteps: null }, {
            ...fullRecord,
            commitments: [{ id: 1, statement: "Analyst will cost the tradeoff by Friday" }],
        });

        expect(out).toContain("cost the tradeoff by Friday");
        expect(out).toContain("### Todos & Commitments");
    });

    it("never reports an unsigned governance request as approved", () => {
        const out = build({ title: "S", nextSteps: null }, {
            ...emptyRecord,
            turns: [{
                id: 1, speakerType: "agent", speakerName: "Ops", content: "", round: 1,
                artifacts: [{
                    tool: "request_governance_approval",
                    payload: { type: "crew_governance_gate_pod", checkpoint: { actionTitle: "Truncate audit log", riskTier: "critical", requestedBy: "MaintenanceWorker" } },
                }],
            }],
        });

        expect(out).toContain("[PENDING GOVERNANCE] **Truncate audit log** (Risk: CRITICAL) — Requested by @MaintenanceWorker");
        expect(out).not.toContain("APPROVED GOVERNANCE");
        expect(out).not.toContain("Authorized by");
    });

    it("synthesizes decision matrices and governance gates from turn artifacts into section 2", () => {
        const recordWithMatrix = {
            ...emptyRecord,
            turns: [
                {
                    id: 1,
                    speakerName: "Producer",
                    speakerType: "agent",
                    topic: "Camera & Aesthetic Selection",
                    content: "We evaluated cinematic treatments and achieved consensus.",
                    artifacts: [
                        {
                            tool: "propose_decision_matrix",
                            payload: {
                                type: "crew_decision_matrix_pod",
                                topic: "Cinematic Treatment",
                                candidates: [{ id: "opt-a", name: "35mm Anamorphic", overallScore: 8.7 }],
                                recommendedCandidateId: "opt-a",
                                consensusPercentage: 88,
                            },
                        },
                        {
                            tool: "request_governance_approval",
                            payload: {
                                type: "crew_governance_gate_pod",
                                checkpoint: {
                                    actionTitle: "Release Master Teaser Reel",
                                    status: "approved",
                                    riskTier: "low",
                                    requestedBy: "Producer",
                                    blastRadius: { estimatedCostUsd: 3.60 },
                                },
                            },
                        },
                    ],
                },
            ],
        };

        const out = build({ title: "Film Studio", nextSteps: null }, recordWithMatrix);
        expect(out).toContain("## 2. Key Decisions & Policy Directives");
        expect(out).toContain("[CONSENSUS DECISION] **Cinematic Treatment**: Ratified **35mm Anamorphic** (Overall Score: 8.7/10) [88% Team Consensus]");
        expect(out).toContain("[APPROVED GOVERNANCE] **Release Master Teaser Reel** (Risk: LOW) [Spend: $3.60] — Requested by @Producer");
        expect(out).toContain("### Deliberated Topics & Key Discussion Points");
        expect(out).toContain("**Camera & Aesthetic Selection** (Led by Producer)");
    });

    it("lists the room's declared #[topic] tags separately from classified topics", () => {
        const out = build({ title: "S", nextSteps: null }, {
            ...emptyRecord,
            turns: [
                { id: 9, speakerName: "You", speakerType: "user", topic: "General", content: "compare #pricing", artifacts: [] },
                { id: 10, speakerName: "Analyst", speakerType: "agent", topic: "Finance", content: "Vendor A looks cheaper. #[Vendor A]", artifacts: [] },
            ],
            turnTopics: [
                { id: 1, turnId: 9, label: "Pricing", source: "user" },
                { id: 2, turnId: 10, label: "Vendor A", source: "agent" },
            ],
        });

        expect(out).toContain("### Topics Declared");
        expect(out).toContain("**#Pricing** — declared 1× by You");
        expect(out).toContain("**#Vendor A** — declared 1× by Analyst");
        // A room with no tags renders no empty section.
        expect(build({ title: "S", nextSteps: null }, emptyRecord)).not.toContain("Topics Declared");
    });
});
