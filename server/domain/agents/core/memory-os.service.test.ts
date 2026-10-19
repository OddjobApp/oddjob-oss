import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryOSService, PROMOTION_IMPORTANCE_THRESHOLD } from "./memory-os.service.js";
import { longTermMemoryService } from "./long-term-memory.service.js";

const generateJson = vi.fn();
vi.mock("@domain/ai/core/system-ai.service.js", () => ({
    systemAiService: {
        generateJson: (...args: any[]) => generateJson(...args),
    },
}));

describe("MemoryOSService", () => {
    const testSessionId = "session_test_memoryos_1";

    beforeEach(() => {
        vi.clearAllMocks();
        MemoryOSService.clearSession(testSessionId);
    });

    describe("Short-Term Working Memory", () => {
        it("records and retrieves short-term turns with FIFO capacity eviction", () => {
            for (let i = 1; i <= 25; i++) {
                MemoryOSService.recordShortTerm({
                    sessionId: testSessionId,
                    role: i % 2 === 0 ? "agent" : "user",
                    content: `Turn content ${i}`
                });
            }

            // Should cap at MAX_SHORT_TERM_PER_SESSION (20)
            const bundlePromise = MemoryOSService.recallUnifiedContext({
                sessionId: testSessionId,
                organizationId: 1,
                queryText: "test"
            });

            return bundlePromise.then(bundle => {
                expect(bundle.shortTerm.length).toBe(6); // Default recall limit is 6
                expect(bundle.shortTerm[bundle.shortTerm.length - 1].content).toBe("Turn content 25");
            });
        });
    });

    describe("Mid-Term Session Memory & Auto-Promotion", () => {
        it("promotes high-importance takeaways to Long-Term Memory automatically", async () => {
            const rememberSpy = vi.spyOn(longTermMemoryService, "remember").mockResolvedValue(undefined as any);

            const insight = MemoryOSService.recordMidTerm({
                sessionId: testSessionId,
                organizationId: 1,
                userId: "user-123",
                topic: "Postgres SSL Requirements",
                takeaway: "Always require verify-full SSL mode in production environments.",
                importance: 9,
                category: "constraint"
            });

            expect(insight.id).toBeDefined();
            expect(rememberSpy).toHaveBeenCalledWith(expect.objectContaining({
                organizationId: 1,
                userId: "user-123",
                type: "strategy",
                content: "Postgres SSL Requirements: Always require verify-full SSL mode in production environments.",
                importance: 9
            }));
        });

        it.each([
            [PROMOTION_IMPORTANCE_THRESHOLD, true],
            [PROMOTION_IMPORTANCE_THRESHOLD - 1, false],
        ])("importance %i promotes: %s", async (importance, shouldPromote) => {
            // Pins the boundary itself rather than a value near it. The threshold
            // moved from 8 to 7 because the extractor scores `entity` insights at
            // 7, which made that category unreachable in practice.
            const rememberSpy = vi.spyOn(longTermMemoryService, "remember").mockResolvedValue(undefined);

            MemoryOSService.recordMidTerm({
                sessionId: testSessionId,
                organizationId: 1,
                topic: "Boundary",
                takeaway: "t",
                importance,
                category: "entity",
            });

            expect(rememberSpy).toHaveBeenCalledTimes(shouldPromote ? 1 : 0);
        });

        it("does not auto-promote low-importance insights", async () => {
            const rememberSpy = vi.spyOn(longTermMemoryService, "remember").mockResolvedValue(undefined as any);

            MemoryOSService.recordMidTerm({
                sessionId: testSessionId,
                organizationId: 1,
                topic: "User Greeting",
                takeaway: "User prefers informal morning greetings.",
                importance: 4,
                category: "feedback"
            });

            expect(rememberSpy).not.toHaveBeenCalled();
        });
    });

    describe("Unified 3-Tier Context Synthesis", () => {
        it("combines short, mid, and long term memories into a structured context bundle", async () => {
            vi.spyOn(longTermMemoryService, "recall").mockResolvedValue([
                { id: 1, type: "fact", content: "Tenant uses GCP us-central1 as primary region." } as any
            ]);

            MemoryOSService.recordShortTerm({
                sessionId: testSessionId,
                role: "user",
                content: "Where should we deploy our new service?"
            });

            MemoryOSService.recordMidTerm({
                sessionId: testSessionId,
                organizationId: 1,
                topic: "Service Architecture",
                takeaway: "Decided on Cloud Run serverless container deployment.",
                importance: 7,
                category: "decision"
            });

            const bundle = await MemoryOSService.recallUnifiedContext({
                sessionId: testSessionId,
                organizationId: 1,
                queryText: "deployment region"
            });

            expect(bundle.longTerm.length).toBe(1);
            expect(bundle.midTerm.length).toBe(1);
            expect(bundle.shortTerm.length).toBe(1);

            expect(bundle.synthesizedContextString).toContain("Established Long-Term Knowledge:");
            expect(bundle.synthesizedContextString).toContain("Tenant uses GCP us-central1");
            expect(bundle.synthesizedContextString).toContain("Session Key Decisions & Facts:");
            expect(bundle.synthesizedContextString).toContain("Decided on Cloud Run serverless");
            expect(bundle.synthesizedContextString).toContain("Recent Working Context");
        });

        it("returns no short-term turns when the caller asks for zero", async () => {
            // `arr.slice(-0)` is `arr.slice(0)` — the whole array. A caller whose
            // prompt already carries the transcript asks for 0 and must get 0,
            // not every turn back again.
            vi.spyOn(longTermMemoryService, "recall").mockResolvedValue([]);

            MemoryOSService.recordShortTerm({
                sessionId: testSessionId,
                role: "user",
                content: "should not come back",
            });

            const bundle = await MemoryOSService.recallUnifiedContext({
                sessionId: testSessionId,
                organizationId: 1,
                queryText: "anything",
                limitShortTerm: 0,
            });

            expect(bundle.shortTerm).toEqual([]);
            expect(bundle.synthesizedContextString).not.toContain("should not come back");
        });
    });

    describe("Insight Extraction (the write path)", () => {
        const turns = [
            { id: "t1", sessionId: "s", role: "user" as const, content: "Always use Gemini, never OpenAI.", timestamp: Date.now() },
        ];

        it("clamps importance to the 1-10 integer scale the column stores", async () => {
            // A model answering on a 0-1 scale must not land as importance 0.
            generateJson.mockResolvedValue({
                insights: [
                    { topic: "A", takeaway: "a", category: "fact", importance: 0.8 },
                    { topic: "B", takeaway: "b", category: "fact", importance: 47 },
                    { topic: "C", takeaway: "c", category: "fact", importance: "not a number" },
                ],
            });

            const result = await MemoryOSService.extractInsights(turns);

            expect(result.map(r => r.importance)).toEqual([1, 10, 5]);
            expect(result.every(r => Number.isInteger(r.importance))).toBe(true);
        });

        it("maps an unrecognised category to fact rather than passing it through", async () => {
            generateJson.mockResolvedValue({
                insights: [{ topic: "A", takeaway: "a", category: "vibes", importance: 5 }],
            });

            const result = await MemoryOSService.extractInsights(turns);

            expect(result[0].category).toBe("fact");
        });

        it("drops items missing a topic or takeaway", async () => {
            generateJson.mockResolvedValue({
                insights: [
                    { topic: "", takeaway: "orphan", category: "fact", importance: 5 },
                    { topic: "no takeaway", category: "fact", importance: 5 },
                    { topic: "keeper", takeaway: "real", category: "fact", importance: 5 },
                ],
            });

            const result = await MemoryOSService.extractInsights(turns);

            expect(result.map(r => r.topic)).toEqual(["keeper"]);
        });

        it("returns nothing when the model finds nothing durable", async () => {
            generateJson.mockResolvedValue({ insights: [] });
            expect(await MemoryOSService.extractInsights(turns)).toEqual([]);
        });

        it("returns nothing when the model call fails or returns junk", async () => {
            generateJson.mockResolvedValue(null);
            expect(await MemoryOSService.extractInsights(turns)).toEqual([]);

            generateJson.mockRejectedValue(new Error("quota exceeded"));
            expect(await MemoryOSService.extractInsights(turns)).toEqual([]);
        });

        it("does not manufacture a session digest when nothing durable was said", async () => {
            // The old behaviour wrote "Session conversation with N turns spanning
            // <ISO date>" for every session — promotable, durable, and useless.
            generateJson.mockResolvedValue({ insights: [] });

            MemoryOSService.recordShortTerm({
                sessionId: testSessionId,
                role: "user",
                content: "what time is it",
            });

            const insights = await MemoryOSService.consolidateSession(testSessionId, 1);

            expect(insights).toEqual([]);
        });

        it("consolidates extracted insights into mid-term memory", async () => {
            generateJson.mockResolvedValue({
                insights: [{ topic: "AI provider", takeaway: "Always use Gemini, never OpenAI.", category: "preference", importance: 9 }],
            });
            const rememberSpy = vi.spyOn(longTermMemoryService, "remember").mockResolvedValue(undefined);

            MemoryOSService.recordShortTerm({
                sessionId: testSessionId,
                role: "user",
                content: "Always use Gemini, never OpenAI.",
            });

            const insights = await MemoryOSService.consolidateSession(testSessionId, 1, "user-1");

            expect(insights).toHaveLength(1);
            expect(insights[0].category).toBe("preference");
            // importance 9 crosses the promotion threshold
            expect(rememberSpy).toHaveBeenCalled();
        });
    });

    describe("Category to long-term memory type mapping", () => {
        it.each([
            ["preference", "preference"],
            ["entity", "entity"],
            ["fact", "fact"],
            ["feedback", "fact"],
            ["decision", "strategy"],
            ["constraint", "strategy"],
        ])("promotes a %s insight as long-term type %s", async (category, expectedType) => {
            // Before this map the service could only ever emit strategy or fact,
            // so preferences and entities — the two types personalization needs —
            // were unreachable no matter what the extractor produced.
            const rememberSpy = vi.spyOn(longTermMemoryService, "remember").mockResolvedValue(undefined);

            await MemoryOSService.promoteToLongTerm({
                id: "mtm_1",
                sessionId: testSessionId,
                organizationId: 1,
                topic: "T",
                takeaway: "t",
                importance: 9,
                category: category as any,
                createdAt: Date.now(),
            });

            expect(rememberSpy).toHaveBeenCalledWith(
                expect.objectContaining({ type: expectedType, source: "auto_extracted" }),
            );
        });
    });

    describe("Working memory bounds", () => {
        it("evicts the least-recent session once the session ceiling is passed", () => {
            // These maps are process-lifetime statics; without a ceiling every
            // session the server ever sees is retained until restart.
            const ceiling = (MemoryOSService as any).MAX_TRACKED_SESSIONS as number;

            for (let i = 0; i < ceiling + 5; i++) {
                MemoryOSService.recordShortTerm({
                    sessionId: `evict_test_${i}`,
                    role: "user",
                    content: `turn ${i}`,
                });
            }

            const store = (MemoryOSService as any).shortTermStore as Map<string, unknown>;
            expect(store.size).toBeLessThanOrEqual(ceiling);
            expect(store.has("evict_test_0")).toBe(false);
            expect(store.has(`evict_test_${ceiling + 4}`)).toBe(true);

            for (let i = 0; i < ceiling + 5; i++) MemoryOSService.clearSession(`evict_test_${i}`);
        });
    });
});
