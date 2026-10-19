/**
 * ScoringRunner — Unit Tests
 *
 * Tests rule matching, threshold condition logic, and the agent-mediated
 * intervention flow introduced in the Intervention Engine feature.
 * Specifically verifies that:
 *  - The agent is consulted before publishing to eventStream
 *  - Suppressed decisions don't emit events
 *  - Agent errors fall back gracefully and still fire
 *
 * All external I/O (DB, Redis, eventStream, agent) is mocked.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

// vi.mock calls are hoisted to the top of the module, ABOVE these declarations, so
// plain `const` doubles would be read from the temporal dead zone the moment a
// factory ran — the whole suite failed to collect with "Cannot access 'mockPublish'
// before initialization" and never ran a single test. vi.hoisted is evaluated ahead
// of the hoisted vi.mock calls, which is what makes the factories safe. The bindings
// stay module-scoped because the tests below assert on them directly.
const {
    mockPublish,
    mockOn,
    mockInsert,
    mockRedisState,
    mockRedisClient,
    mockEvaluate,
} = vi.hoisted(() => {
    // One shared redis double, not a fresh object per getRedisClient() call. The old
    // factory rebuilt the client each time, so a test that took its own handle
    // asserted against different spies than the runner had used and set() appeared
    // never to have been called. Its methods stay wired to mockRedisState, which the
    // cooldown-suppression tests seed directly.
    const redisState = {} as Record<string, string>;
    return {
        mockPublish: vi.fn().mockResolvedValue(undefined),
        mockOn: vi.fn(),
        mockInsert: vi.fn().mockReturnValue({
            values: vi.fn().mockResolvedValue([]),
        }),
        mockRedisState: redisState,
        mockRedisClient: {
            hincrbyfloat: vi.fn(async (_k: string, _f: string, v: number) => String(v)),
            exists: vi.fn(async (k: string) => (redisState[k] ? 1 : 0)),
            set: vi.fn(async (k: string, v: string, ..._rest: any[]) => { redisState[k] = v; }),
            hgetall: vi.fn(async () => null),
        },
        mockEvaluate: vi.fn(),
    };
});

vi.mock("@domain/core/infrastructure/event-stream.service.js", () => ({
    eventStream: { publish: mockPublish, on: mockOn },
}));

vi.mock("@server/database_service.js", () => ({
    db: { insert: mockInsert },
}));
vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    getRedisClient: vi.fn(() => mockRedisClient),
}));

vi.mock("@domain/knowledge/core/scoring/scoring.service.js", () => ({
    scoringService: {
        listRules:      vi.fn().mockResolvedValue([]),
        listThresholds: vi.fn().mockResolvedValue([]),
    },
}));

vi.mock("@server/utils/logger.js", () => ({
    createLogger: vi.fn(() => ({
        info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    })),
}));

vi.mock("@domain/knowledge/core/scoring/intervention-agent.service.js", () => ({
    interventionAgentService: { evaluate: mockEvaluate },
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import { scoringRunner } from "./scoring-runner.js";
import { scoringService } from "@domain/knowledge/core/scoring/scoring.service.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeEvent(overrides: Record<string, any> = {}) {
    return {
        eventType: "ui_interaction",
        payload:   { page: "pipelines", activity: "click", elementId: "save-btn" },
        context:   { userId: "user-1", sessionId: "sess-1" },
        ...overrides,
    };
}

function makeRule(overrides: Partial<Record<string, any>> = {}) {
    return {
        id:              1,
        name:            "Save click rule",
        enabled:         true,
        ruleType:        "ui_interaction",
        activity:        "click",
        page:            "pipelines",
        pageState:       null,
        card:            null,
        elementType:     null,
        elementId:       "save-btn",
        vector:          "E",
        weight:          1.0,
        triggeredAction: { type: "toast", config: { message: "Great save!" } },
        ...overrides,
    };
}

function makeThreshold(overrides: Partial<Record<string, any>> = {}) {
    return {
        id:              99,
        name:            "E Threshold",
        enabled:         true,
        vector:          "E",
        operator:        ">=",
        thresholdValue:  1.0,
        cooldownMs:      60_000,
        triggeredAction: { type: "toast", config: { message: "You're engaged!" } },
        ...overrides,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────

// File-level reset. Only the last two describe blocks cleared mocks, so call counts
// leaked into the earlier ones — assertions like "publish was not called" failed
// because a previous test had called it. This was invisible while the suite could not
// collect at all.
beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(mockRedisState)) delete mockRedisState[k];
});

describe("scoringRunner.matches()", () => {
    const rule = makeRule();

    it("matches when all specified fields match event payload", () => {
        expect(scoringRunner.matches(rule, makeEvent())).toBe(true);
    });

    it("rejects when activity mismatches", () => {
        expect(scoringRunner.matches(rule, makeEvent({ payload: { activity: "hover" } }))).toBe(false);
    });

    it("rejects when page mismatches", () => {
        expect(
            scoringRunner.matches(rule, makeEvent({ payload: { page: "agents", activity: "click", elementId: "save-btn" } }))
        ).toBe(false);
    });

    it("rejects when elementId mismatches", () => {
        expect(
            scoringRunner.matches(rule, makeEvent({ payload: { page: "pipelines", activity: "click", elementId: "cancel-btn" } }))
        ).toBe(false);
    });

    it("matches when a rule has no elementId (wildcard)", () => {
        const broadRule = makeRule({ elementId: null });
        expect(
            scoringRunner.matches(broadRule, makeEvent({ payload: { page: "pipelines", activity: "click" } }))
        ).toBe(true);
    });

    it("rejects non-ui_interaction events in handleEvent", async () => {
        (scoringService.listRules as Mock).mockResolvedValue([rule]);
        await scoringRunner.handleEvent(makeEvent({ eventType: "system.health" }));
        expect(scoringService.listRules).not.toHaveBeenCalled();
    });
});

describe("scoringRunner.meetsCondition()", () => {
    it.each([
        [5.0, ">",  4.0, true ],
        [5.0, ">",  5.0, false],
        [5.0, ">=", 5.0, true ],
        [3.0, "<",  4.0, true ],
        [3.0, "<=", 3.0, true ],
        [5.0, "=",  5.0, true ],
        [5.0, "=",  4.0, false],
    ])("score=%s operator=%s threshold=%s → %s", (score, op, threshold, expected) => {
        expect(scoringRunner.meetsCondition(score, op, threshold)).toBe(expected);
    });
});

describe("scoringRunner.triggerIntervention() → agent integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const k of Object.keys(mockRedisState)) delete mockRedisState[k];
    });

    it("calls interventionAgentService.evaluate() with correct candidate", async () => {
        const threshold = makeThreshold();
        mockEvaluate.mockResolvedValue({ fire: true, title: "Engaged!", confidence: 0.8 });

        await scoringRunner.triggerIntervention(threshold, "u:user-1", "sess-1", 5.0, makeEvent());

        expect(mockEvaluate).toHaveBeenCalledWith(
            expect.objectContaining({
                thresholdId:   99,
                thresholdName: "E Threshold",
                vector:        "E",
                score:         5.0,
                sessionId:     "sess-1",
                userId:        "user-1",
            })
        );
    });

    it("publishes intervention.triggered when agent fires", async () => {
        const threshold = makeThreshold();
        mockEvaluate.mockResolvedValue({
            fire:        true,
            title:       "You're on a roll!",
            description: "Engagement is high.",
            priority:    "medium",
            confidence:  0.75,
        });

        await scoringRunner.triggerIntervention(threshold, "u:user-1", "sess-1", 5.0);

        expect(mockPublish).toHaveBeenCalledWith(
            "intervention.triggered",
            expect.objectContaining({
                thresholdId: 99,
                vector:      "E",
                title:       "You're on a roll!",
                priority:    "medium",
            }),
            expect.objectContaining({ source: "scoring-runner" })
        );
    });

    it("does NOT publish when agent suppresses", async () => {
        mockEvaluate.mockResolvedValue({ fire: false, confidence: 0.95 });

        await scoringRunner.triggerIntervention(makeThreshold(), "u:user-1", "sess-1", 5.0);

        expect(mockPublish).not.toHaveBeenCalled();
    });

    it("fires raw intervention (fallback) when agent.evaluate throws", async () => {
        mockEvaluate.mockRejectedValue(new Error("LLM unreachable"));

        await scoringRunner.triggerIntervention(makeThreshold(), "u:user-1", "sess-1", 5.0);

        // Should still publish despite agent error
        expect(mockPublish).toHaveBeenCalledWith(
            "intervention.triggered",
            expect.objectContaining({ thresholdId: 99, vector: "E" }),
            expect.anything()
        );
    });

    it("skips publish if threshold is in cooldown", async () => {
        const threshold = makeThreshold();
        // Pre-set the cooldown key
        mockRedisState[`scoring:cooldown:${threshold.id}:u:user-1`] = "1";

        (scoringService.listThresholds as Mock).mockResolvedValue([threshold]);

        // Trigger via checkThresholds (which honours cooldown)
        await scoringRunner.checkThresholds("u:user-1", "E", 5.0, "sess-1");

        expect(mockPublish).not.toHaveBeenCalled();
    });

    it("sets a cooldown key after firing", async () => {
        const threshold = makeThreshold({ cooldownMs: 30_000 });
        mockEvaluate.mockResolvedValue({ fire: true, confidence: 0.8 });
        (scoringService.listThresholds as Mock).mockResolvedValue([threshold]);

        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = (getRedisClient as Mock)();

        await scoringRunner.checkThresholds("u:user-1", "E", 5.0, "sess-1");

        expect(redis.set).toHaveBeenCalledWith(
            expect.stringContaining("scoring:cooldown:99:u:user-1"),
            "1",
            "PX",
            30_000
        );
    });
});

describe("scoringRunner.handleEvent() — end-to-end flow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        for (const k of Object.keys(mockRedisState)) delete mockRedisState[k];
    });

    it("matches rule, increments score, consults agent on threshold breach", async () => {
        const rule      = makeRule();
        const threshold = makeThreshold({ vector: "E", operator: ">=", thresholdValue: 1.0 });

        (scoringService.listRules      as Mock).mockResolvedValue([rule]);
        (scoringService.listThresholds as Mock).mockResolvedValue([threshold]);
        mockEvaluate.mockResolvedValue({ fire: true, confidence: 0.8 });

        // hincrbyfloat returns 1.0 which meets threshold >=1.0
        const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
        const redis = (getRedisClient as Mock)();
        (redis.hincrbyfloat as Mock).mockResolvedValue("1.0");

        await scoringRunner.handleEvent(makeEvent());

        expect(mockEvaluate).toHaveBeenCalledWith(
            expect.objectContaining({ vector: "E", score: 1.0 })
        );
        expect(mockPublish).toHaveBeenCalledWith(
            "intervention.triggered",
            expect.objectContaining({ vector: "E" }),
            expect.anything()
        );
    });

    it("does nothing for irrelevant event types", async () => {
        await scoringRunner.handleEvent(makeEvent({ eventType: "forge.progress" }));
        expect(scoringService.listRules).not.toHaveBeenCalled();
    });

    it("logs error but does not throw when DB insert fails", async () => {
        (scoringService.listRules as Mock).mockResolvedValue([makeRule()]);
        (mockInsert as Mock).mockImplementationOnce(() => {
            throw new Error("DB write failure");
        });

        // Should resolve without throwing
        await expect(scoringRunner.handleEvent(makeEvent())).resolves.toBeUndefined();
    });
});
