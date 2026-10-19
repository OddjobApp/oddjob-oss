import { describe, expect, it, vi, beforeEach } from "vitest";
import { CrewLearningService } from "../crew-learning.service.js";
import type { SupervisorOutput } from "../crew-supervisor.service.js";

// Mock the database service
vi.mock("@server/database_service.js", () => ({
    db: {
        insert: vi.fn(),
        select: vi.fn(),
        update: vi.fn(),
    },
}));

// Mock the logger
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn(),
    }),
}));

import { db } from "@server/database_service.js";

describe("CrewLearningService - syncBlackboardArtifacts", () => {
    let service: CrewLearningService;
    const insertedRows: Record<string, any[]> = {
        crew_decisions: [],
        crew_claims: [],
        crew_commitments: [],
    };

    beforeEach(() => {
        vi.clearAllMocks();
        service = new CrewLearningService();
        insertedRows.crew_decisions = [];
        insertedRows.crew_claims = [];
        insertedRows.crew_commitments = [];

        vi.mocked(db.insert).mockImplementation((table: any) => ({
            values: vi.fn().mockImplementation((values: any) => {
                const tableName = table[Symbol.for("drizzle:Name")] || "unknown";
                if (Array.isArray(values)) {
                    insertedRows[tableName] = [...(insertedRows[tableName] || []), ...values];
                } else {
                    insertedRows[tableName] = [...(insertedRows[tableName] || []), values];
                }
                return Promise.resolve([{ id: 1, ...values }]);
            }),
        }) as any);

        vi.mocked(db.select).mockImplementation(() => ({
            from: vi.fn().mockReturnValue({
                where: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue([
                        {
                            memory: {
                                facts: ["Existing Fact 1"],
                                openQuestions: [],
                                constraints: [],
                            },
                        },
                    ]),
                }),
            }),
        }) as any);

        vi.mocked(db.update).mockImplementation(() => ({
            set: vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue([{ id: 1 }]),
            }),
        }) as any);
    });

    it("automatically extracts decisions, claims, and commitments from structured supervisor output", async () => {
        const mockOutput: SupervisorOutput = {
            directive: "@Security Auditor, initiate the CVE scan.",
            activeTopic: "Python Sandbox Isolation",
            nextSteps: "Run CVE scan and verify rootless cgroups v2 boundaries.",
            consensusLevel: 85,
            critique: "The initial proposal did not specify rootless mode.",
            consensus: "Python execution must use rootless gVisor sandbox with 512MB RAM ceiling.",
            summary: "Agreed on rootless gVisor isolation.",
            notes: ["Rootless mode is mandatory for compliance."],
            intents: [],
            plan: {
                title: "Sandbox Deployment",
                steps: [
                    { order: 1, description: "Configure cgroups v2 memory limits", owner: "Security Auditor" },
                    { order: 2, description: "Deploy rootless runner container", owner: "Site Reliability Engineer" },
                ],
            },
            positions: [
                { agent: "Security Auditor", proposition: "Rootless sandbox is non-negotiable.", confidence: 95 },
                { agent: "Site Reliability Engineer", proposition: "Resource ceiling should be 512MB.", confidence: 90 },
            ],
            divergenceQuestion: null,
            decisions: [
                { statement: "Enforce rootless gVisor sandbox", rationale: "Security invariant", confidence: 95 },
            ],
            claims: [
                { claim: "cgroups v2 prevents memory breakout", agent: "Security Auditor", confidence: 90 },
            ],
            commitments: [
                { title: "Run vulnerability audit on Python base image", owner: "Security Auditor", detail: "Immediate" },
            ],
        };

        const result = await service.syncBlackboardArtifacts({
            orgId: 1,
            sessionId: 100,
            round: 2,
            topic: "Python Sandbox Isolation",
            output: mockOutput,
            projectId: 5,
        });

        expect(result.decisionsCreated).toBeGreaterThanOrEqual(1);
        expect(result.claimsCreated).toBeGreaterThanOrEqual(1);
        expect(result.commitmentsCreated).toBeGreaterThanOrEqual(1);

        expect(db.insert).toHaveBeenCalled();
        expect(db.update).toHaveBeenCalled();
    });

    it("falls back to consensus and positions when explicit arrays are omitted", async () => {
        const mockOutput: SupervisorOutput = {
            directive: "@Growth Marketer, proceed with warming schedule.",
            activeTopic: "Email Deliverability",
            nextSteps: "Begin Phase 1 warmup.",
            consensusLevel: 75,
            critique: "Need strict 45-90s throttling.",
            consensus: "Outbound email must maintain DMARC p=quarantine and daily send ramp.",
            summary: "Agreed on email warming plan.",
            notes: [],
            intents: [],
            plan: null,
            positions: [
                { agent: "Growth Marketer", proposition: "Warmup ramp must not exceed 50 emails/day initially.", confidence: 85 },
            ],
            divergenceQuestion: null,
        };

        const result = await service.syncBlackboardArtifacts({
            orgId: 1,
            sessionId: 101,
            round: 1,
            topic: "Email Deliverability",
            output: mockOutput,
        });

        expect(result.decisionsCreated).toBe(1);
        expect(result.claimsCreated).toBe(1);
        expect(result.commitmentsCreated).toBe(0);
    });
});
