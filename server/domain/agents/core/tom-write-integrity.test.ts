/**
 * Write integrity for the ToM record.
 *
 * Two failure modes that leave no trace at runtime:
 *
 *   1. An OCC write that exhausts its retries used to log one line and return
 *      void, so the extraction worker carried on as though the belief had been
 *      stored. Nothing downstream could tell a persisted write from a lost one.
 *   2. epistemicStates is the only dimension the decay batch never prunes
 *      (infinite half-life, zero archive threshold), so it grew for the life of
 *      the user while every OCC write read and rewrote the whole array.
 *
 * Both are asserted here against the real service with the database stubbed,
 * because both are about what happens on the write path rather than what the
 * data looks like afterwards.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EpistemicEntry } from "@shared/schema/agent/theory-of-mind.js";

// ─── Mocks ──────────────────────────────────────────────────────────────────

/** Rows the fake update pretends to have written; empty = OCC conflict. */
let updateResult: Array<{ id: number }> = [{ id: 1 }];
let storedEpistemic: EpistemicEntry[] = [];
const archivedRows: any[] = [];

const selectChain = () => ({
    from: () => selectChain(),
    where: () => selectChain(),
    limit: async () => [{
        id: 1,
        organizationId: 7,
        userId: "u1",
        version: 1,
        epistemicStates: storedEpistemic,
        beliefs: [],
        expectations: [],
        cognitiveState: { frustration: 0, confusion: 0, urgency: 0, explorationVsGoal: 50, assessedAt: null },
        intentModel: { literalIntent: "", inferredIntent: "", inferredConfidence: 0, diverges: false, sessionSignals: [], sessionId: "", updatedAt: null },
        knowledgeGaps: [],
        oceanProfile: { openness: 0.5, conscientiousness: 0.5, extraversion: 0.5, agreeableness: 0.5, neuroticism: 0.5, confidence: 0, observationCount: 0, lastCalibratedAt: null },
        createdAt: new Date(),
        updatedAt: new Date(),
    }],
});

let lastSet: Record<string, any> = {};

vi.mock("@server/database_service.js", () => ({
    db: {
        select: () => selectChain(),
        update: () => ({
            set: (values: Record<string, any>) => {
                lastSet = values;
                return {
                    where: () => ({ returning: async () => updateResult }),
                };
            },
        }),
        insert: () => ({
            values: async (rows: any) => { archivedRows.push(...(Array.isArray(rows) ? rows : [rows])); },
        }),
    },
}));
vi.mock("@domain/core/infrastructure/redis/redis-client.js", () => ({
    nodeRedisClient: { get: vi.fn(), setex: vi.fn(), del: vi.fn() },
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn(), and: vi.fn(), sql: vi.fn(() => "sql"), asc: vi.fn() }));
vi.mock("@shared/schema/agent/theory-of-mind.js", async (importOriginal) => ({
    ...(await importOriginal<any>()),
    theoryOfMind: { version: "version", organizationId: "org", userId: "user" },
}));
vi.mock("@shared/schema/agent/tom-archived-entries.js", () => ({ tomArchivedEntries: {} }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));
vi.mock("./user-representation.service.js", () => ({ userRepresentationService: {} }));

const { occWrite, theoryOfMindService, ToMWriteConflictError } = await import("./theory-of-mind.service.js");

const entry = (topic: string, informedAt: string): EpistemicEntry => ({
    topic,
    summary: `about ${topic}`,
    informedBy: "agent-1",
    informedAt,
    confidence: 100,
});

beforeEach(() => {
    updateResult = [{ id: 1 }];
    storedEpistemic = [];
    archivedRows.length = 0;
    lastSet = {};
});

describe("occWrite failure is detectable", () => {
    it("resolves when the write lands", async () => {
        await expect(occWrite(7, "u1", () => ({ beliefs: [] }))).resolves.toBeUndefined();
    });

    it("throws rather than returning silently when retries are exhausted", async () => {
        // Zero rows updated on every attempt = permanent version conflict.
        updateResult = [];

        await expect(occWrite(7, "u1", () => ({ beliefs: [] }))).rejects.toThrow(ToMWriteConflictError);
    });

    it("names the tenant and user, so an exhausted write is traceable", async () => {
        updateResult = [];

        await expect(occWrite(7, "u1", () => ({ beliefs: [] }))).rejects.toThrow(/orgId=7 userId=u1/);
    });

    it("propagates to a caller that does not catch — the extraction worker relies on this", async () => {
        // BullMQ retries the job on a thrown error; a silent return meant a lost
        // belief was indistinguishable from a stored one.
        updateResult = [];

        let surfaced = false;
        try {
            await theoryOfMindService.recordEpistemicEntry(7, "u1", {
                topic: "billing",
                summary: "explained billing",
                informedBy: "agent-1",
                informedAt: new Date().toISOString(),
            });
        } catch {
            surfaced = true;
        }

        expect(surfaced).toBe(true);
    });
});

describe("epistemicStates stays bounded", () => {
    const CAP = 200;

    it("keeps appending while under the cap", async () => {
        storedEpistemic = [entry("a", "2026-01-01T00:00:00.000Z")];

        await theoryOfMindService.recordEpistemicEntry(7, "u1", {
            topic: "b",
            summary: "s",
            informedBy: "agent-1",
            informedAt: "2026-01-02T00:00:00.000Z",
        });

        expect(lastSet.epistemicStates).toHaveLength(2);
        expect(archivedRows).toHaveLength(0);
    });

    it("evicts down to the cap once it is exceeded", async () => {
        storedEpistemic = Array.from({ length: CAP }, (_, i) =>
            entry(`topic-${i}`, new Date(2026, 0, 1, 0, i).toISOString()),
        );

        await theoryOfMindService.recordEpistemicEntry(7, "u1", {
            topic: "brand-new",
            summary: "s",
            informedBy: "agent-1",
            informedAt: new Date(2027, 0, 1).toISOString(),
        });

        expect(lastSet.epistemicStates).toHaveLength(CAP);
    });

    it("evicts the OLDEST entry, not an arbitrary one", async () => {
        storedEpistemic = Array.from({ length: CAP }, (_, i) =>
            entry(`topic-${i}`, new Date(2026, 0, 1, 0, i).toISOString()),
        );

        await theoryOfMindService.recordEpistemicEntry(7, "u1", {
            topic: "brand-new",
            summary: "s",
            informedBy: "agent-1",
            informedAt: new Date(2027, 0, 1).toISOString(),
        });

        const topics = (lastSet.epistemicStates as EpistemicEntry[]).map(e => e.topic);
        expect(topics).not.toContain("topic-0"); // oldest, gone
        expect(topics).toContain("topic-199");   // newest of the old, kept
        expect(topics).toContain("brand-new");
    });

    it("archives what it evicts rather than dropping it", async () => {
        // Parity with every other dimension: aged-out state stays recoverable.
        storedEpistemic = Array.from({ length: CAP }, (_, i) =>
            entry(`topic-${i}`, new Date(2026, 0, 1, 0, i).toISOString()),
        );

        await theoryOfMindService.recordEpistemicEntry(7, "u1", {
            topic: "brand-new",
            summary: "s",
            informedBy: "agent-1",
            informedAt: new Date(2027, 0, 1).toISOString(),
        });

        expect(archivedRows).toHaveLength(1);
        expect(archivedRows[0]).toMatchObject({
            organizationId: 7,
            userId: "u1",
            dimension: "epistemic",
        });
        expect(archivedRows[0].entryData.topic).toBe("topic-0");
    });

    it("replaces rather than grows when the topic already exists", async () => {
        // Dedupe by topic is what keeps this bounded in the normal case; the cap
        // only catches genuinely distinct topics accumulating.
        storedEpistemic = [entry("billing", "2026-01-01T00:00:00.000Z")];

        await theoryOfMindService.recordEpistemicEntry(7, "u1", {
            topic: "Billing",
            summary: "updated",
            informedBy: "agent-2",
            informedAt: "2026-06-01T00:00:00.000Z",
        });

        expect(lastSet.epistemicStates).toHaveLength(1);
        expect((lastSet.epistemicStates as EpistemicEntry[])[0].summary).toBe("updated");
    });
});
