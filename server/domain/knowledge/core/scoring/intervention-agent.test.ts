/**
 * InterventionAgentService — Unit Tests
 *
 * Tests the decision logic, fallback behaviour, same-vector recency gate,
 * persistence, outcome recording, and distillation trigger.
 *
 * Dependencies (db, Redis, systemAiService) are fully mocked so these tests
 * run without an external database or Redis instance.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

// ── Shared mock state ──────────────────────────────────────────────────────

const mockRedis: Record<string, any> = {};

const mockRedisClient = {
    get:          vi.fn(async (k: string) => mockRedis[k] ?? null),
    set:          vi.fn(async (k: string, v: any, ...args: any[]) => { mockRedis[k] = v; }),
    hgetall:      vi.fn(async () => ({ S: "1.5", C: "2.0", O: "0.5", R: "1.0", E: "0.0" })),
    hincrbyfloat: vi.fn(async () => "1.0"),
};

vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    getRedisClient: vi.fn(() => mockRedisClient),
}));

const mockInsertReturning = vi.fn().mockResolvedValue([{ id: 42 }]);
const mockUpdateSet = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
const mockSelectFrom = {
    from:    vi.fn().mockReturnThis(),
    where:   vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit:   vi.fn().mockResolvedValue([]),
    then:    vi.fn((onFulfilled: any) => Promise.resolve([]).then(onFulfilled)),
};

vi.mock("@server/database_service.js", () => ({
    db: {
        select:  vi.fn(() => mockSelectFrom),
        insert:  vi.fn(() => ({ values: vi.fn(() => ({ returning: mockInsertReturning })) })),
        update:  vi.fn(() => mockUpdateSet),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info:  vi.fn(),
        debug: vi.fn(),
        warn:  vi.fn(),
        error: vi.fn(),
    })),
}));

vi.mock("@domain/ai/core/system-ai.service.js", () => ({
    systemAiService: { generateJson: vi.fn() },
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import { interventionAgentService } from "./intervention-agent.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeCandidate(overrides: Partial<Parameters<typeof interventionAgentService.evaluate>[0]> = {}) {
    return {
        thresholdId:   1,
        thresholdName: "High Struggle",
        vector:        "S",
        score:         5.0,
        sessionId:     "sess-test",
        userId:        "user-1",
        action:        { type: "toast" as const, config: { message: "Need help?" } },
        vectorState:   { S: 5.0, C: 1.0, O: 0, R: 0, E: 0 },
        location:      "/pipelines/42",
        ...overrides,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("InterventionAgentService.evaluate()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Restore mockRedisClient implementations after clearAllMocks
        mockRedisClient.get.mockImplementation(async (k: string) => mockRedis[k] ?? null);
        mockRedisClient.set.mockImplementation(async (k: string, v: any) => { mockRedis[k] = v; });
        mockRedisClient.hgetall.mockResolvedValue({ S: "1.5", C: "2.0", O: "0.5", R: "1.0", E: "0.0" });
        mockRedisClient.hincrbyfloat.mockResolvedValue("1.0");
        // Clear Redis mock state between tests
        for (const k of Object.keys(mockRedis)) delete mockRedis[k];
    });

    it("returns fire:true when LLM approves the intervention", async () => {
        (systemAiService.generateJson as Mock).mockResolvedValue({
            fire:        true,
            title:       "You seem stuck",
            description: "I noticed some repeated errors.",
            aiPrompt:    "Help the user with pipelines",
            rationale:   "S-score crossed threshold 5",
            priority:    "high",
            confidence:  0.87,
        });

        const decision = await interventionAgentService.evaluate(makeCandidate());

        expect(decision.fire).toBe(true);
        expect(decision.title).toBe("You seem stuck");
        expect(decision.priority).toBe("high");
        expect(decision.confidence).toBeCloseTo(0.87);
    });

    it("returns fire:false when LLM suppresses the intervention", async () => {
        (systemAiService.generateJson as Mock).mockResolvedValue({
            fire:       false,
            confidence: 0.92,
        });

        const decision = await interventionAgentService.evaluate(makeCandidate());

        expect(decision.fire).toBe(false);
    });

    it("falls back to built-in rules when LLM throws", async () => {
        (systemAiService.generateJson as Mock).mockRejectedValue(new Error("LLM unavailable"));

        const decision = await interventionAgentService.evaluate(makeCandidate());

        // Fallback should fire (no recency key set) and return reasonable values
        expect(typeof decision.fire).toBe("boolean");
        expect(decision.confidence).toBeDefined();
    });

    it("suppresses when same-vector recency key is set in Redis", async () => {
        // Pre-set the recency key so the gate blocks
        mockRedis["iv:recent:sess-test:S"] = "1";

        (systemAiService.generateJson as Mock).mockResolvedValue({
            fire:       true,
            confidence: 0.9,
        });

        const decision = await interventionAgentService.evaluate(makeCandidate());

        expect(decision.fire).toBe(false);
        expect(decision.confidence).toBeGreaterThan(0.9);
    });

    it("sets the recency key in Redis when firing", async () => {
        const redis = mockRedisClient;

        (systemAiService.generateJson as Mock).mockResolvedValue({
            fire:       true,
            confidence: 0.8,
        });

        await interventionAgentService.evaluate(makeCandidate({ vector: "C", sessionId: "sess-redis" }));

        expect(redis.set).toHaveBeenCalledWith(
            expect.stringContaining("iv:recent:sess-redis:C"),
            "1",
            "PX",
            expect.any(Number)
        );
    });

    it("persists decision to interventionMemory and returns memoryId", async () => {
        (systemAiService.generateJson as Mock).mockResolvedValue({ fire: true, confidence: 0.7 });

        const decision = await interventionAgentService.evaluate(makeCandidate());

        expect(decision.memoryId).toBe(42); // mocked returning id
    });

    it("includes loaded DB policies in the LLM prompt", async () => {
        // Simulate DB returning two policies
        mockSelectFrom.limit = vi.fn().mockResolvedValueOnce([
            { rule: "Never fire on first page load." },
            { rule: "Wait 3 minutes between S-vector interventions." },
        ]).mockResolvedValue([]);

        (systemAiService.generateJson as Mock).mockResolvedValue({ fire: true, confidence: 0.75 });

        await interventionAgentService.evaluate(makeCandidate());

        const prompt = (systemAiService.generateJson as Mock).mock.calls[0][0] as string;
        expect(prompt).toContain("Never fire on first page load.");
        expect(prompt).toContain("Wait 3 minutes between S-vector interventions.");
    });

    it("includes recent memory examples as few-shot context", async () => {
        // First call: policies (empty), second call: memory rows
        mockSelectFrom.limit = vi.fn()
            .mockResolvedValueOnce([]) // policies
            .mockResolvedValueOnce([  // memory
                { vector: "S", location: "/pipelines", agentDecision: "fire", outcome: "dismissed" },
                { vector: "C", location: "/agents",   agentDecision: "suppress", outcome: null },
            ]);

        (systemAiService.generateJson as Mock).mockResolvedValue({ fire: true, confidence: 0.8 });

        await interventionAgentService.evaluate(makeCandidate());

        const prompt = (systemAiService.generateJson as Mock).mock.calls[0][0] as string;
        expect(prompt).toContain("vector=S");
        expect(prompt).toContain("outcome=dismissed");
    });
});

describe("InterventionAgentService.recordOutcome()", () => {
    beforeEach(() => vi.clearAllMocks());

    it("updates the memory row with outcome and resolvedAt", async () => {
        const { db } = await import("@server/database_service.js");

        await interventionAgentService.recordOutcome("iv-abc-123", "accepted", 4500);

        expect(db.update).toHaveBeenCalled();
        expect(mockUpdateSet.set).toHaveBeenCalledWith(
            expect.objectContaining({ outcome: "accepted", timeToActionMs: 4500 })
        );
    });

    it("handles DB errors gracefully without throwing", async () => {
        const { db } = await import("@server/database_service.js");
        (db.update as Mock).mockImplementationOnce(() => { throw new Error("DB down"); });

        // Should not throw
        await expect(
            interventionAgentService.recordOutcome("iv-err", "expired")
        ).resolves.toBeUndefined();
    });
});

describe("InterventionAgentService.distillPolicies()", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockSelectFrom.then.mockImplementation((onFulfilled: any) => Promise.resolve([]).then(onFulfilled));
        mockSelectFrom.limit.mockResolvedValue([]);
    });

    it("inserts new policies and suggestions from LLM response", async () => {
        const { db } = await import("@server/database_service.js");

        // Simulate 15 resolved memory rows (enough to distill)
        // First DB call goes through .from() only (round count), second uses .limit()
        mockSelectFrom.then.mockImplementationOnce((onFulfilled: any) => Promise.resolve([{ max: 0 }]).then(onFulfilled));
        mockSelectFrom.limit.mockResolvedValueOnce(
            Array.from({ length: 15 }, (_, i) => ({
                vector: "S", location: "/page", agentDecision: "fire",
                outcome: i % 2 === 0 ? "accepted" : "dismissed",
                timeToActionMs: 3000,
            }))
        );

        (systemAiService.generateJson as Mock).mockResolvedValue({
            policies:    ["Do not fire S-vector during active form editing."],
            suggestions: [{ suggestionType: "cooldown_extend", rationale: "High dismiss rate", proposedChange: { cooldownMs: 120000 } }],
        });

        await interventionAgentService.distillPolicies();

        expect(db.insert).toHaveBeenCalledTimes(2); // policies + suggestions
    });

    it("skips distillation when fewer than 10 resolved outcomes exist", async () => {
        const { db } = await import("@server/database_service.js");

        mockSelectFrom.then.mockImplementationOnce((onFulfilled: any) => Promise.resolve([{ max: 0 }]).then(onFulfilled));
        mockSelectFrom.limit.mockResolvedValueOnce(Array.from({ length: 5 }, () => ({ outcome: "dismissed" })));

        await interventionAgentService.distillPolicies();

        // generateJson should not be called if we skip early
        expect(systemAiService.generateJson).not.toHaveBeenCalled();
    });
});
