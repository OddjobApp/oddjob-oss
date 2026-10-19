/**
 * persistTurnTags — the write path for declared-topic tags.
 *
 * The contract under test: tags resolve to knowledge_topics (creating freeform
 * topics on demand), rows land in crew_turn_topics, project rooms scope the
 * vocabulary, and a taxonomy failure returns [] rather than failing the round.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const findTopicByName = vi.fn();
const upsertTopic = vi.fn();
const createDocument = vi.fn();
const insert = vi.fn();
const select = vi.fn();
const update = vi.fn();

vi.mock("@server/database_service.js", () => ({ db: { insert, select, update } }));
vi.mock("@server/utils/logger.js", () => ({
    createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@server/utils/auth-context.js", () => ({
    getSystemOrgContext: (organizationId: number) => ({ organizationId }),
}));
vi.mock("@domain/knowledge/core/topic-service.js", () => ({
    topicService: { findTopicByName, upsertTopic },
}));
vi.mock("@domain/knowledge/core/extraction/document-service.js", () => ({
    documentService: { createDocument },
}));

const { persistTurnTags } = await import("../crew-topics.service.js");

const baseScope = {
    orgId: 7,
    sessionId: 10,
    turnId: 42,
    round: 3,
    source: "user" as const,
    sessionKey: "crew-test",
    speakerName: "You",
};

const { crewTurnTopics, learnedTopicKeywords } = await import("@shared/schema/index.js");

/** Every (table, values) pair handed to db.insert — keyed by the schema table. */
const valuesCalls: Array<{ table: any; value: any }> = [];

describe("persistTurnTags", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        valuesCalls.length = 0;
        insert.mockImplementation((table: any) => ({
            values: vi.fn((value: any) => {
                valuesCalls.push({ table, value });
                return {
                    onConflictDoNothing: vi.fn(() => ({ returning: vi.fn(async () => [{ id: 99, status: value.status ?? "applied" }]) })),
                    onConflictDoUpdate: vi.fn(async () => []),
                };
            }),
        }) as any);
        findTopicByName.mockResolvedValue([]);
        upsertTopic.mockImplementation(async (input: { name: string }) => ({ id: 501, name: input.name, projectId: null }));
        select.mockImplementation(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(async () => [{ id: 9, topicAffinities: [], topicLabelAffinities: [] }]),
                })),
            })),
        }) as any);
        update.mockImplementation(() => ({
            set: vi.fn(() => ({ where: vi.fn(async () => []) })),
        }) as any);
    });

    const flush = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };

    const tagValues = () => valuesCalls.filter((c) => c.table === crewTurnTopics).map((c) => c.value);
    const learnedValues = () => valuesCalls.filter((c) => c.table === learnedTopicKeywords).map((c) => c.value);

    it("resolves tags to knowledge_topics and returns rows keyed by turn", async () => {
        const rows = await persistTurnTags({
            ...baseScope,
            text: "compare #[Vendor A] and #pricing please",
        });

        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ turnTopicId: 99, topicId: 501, label: "Vendor A" });
        expect(upsertTopic).toHaveBeenCalledWith(
            { name: "Vendor A" },
            { organizationId: 7 },
            null,
        );
        expect(upsertTopic).toHaveBeenCalledWith(
            { name: "Pricing" },
            { organizationId: 7 },
            null,
        );
    });

    it("reuses an existing topic at the same project scope instead of upserting", async () => {
        findTopicByName.mockResolvedValue([{ id: 5, name: "pricing", projectId: null }]);

        const rows = await persistTurnTags({ ...baseScope, text: "more on #Pricing" });

        expect(rows).toHaveLength(1);
        expect(rows[0].topicId).toBe(5);
        expect(upsertTopic).not.toHaveBeenCalled();
    });

    it("treats a same-named topic in a different Project Space as not existing", async () => {
        findTopicByName.mockResolvedValue([{ id: 5, name: "Pricing", projectId: 77 }]);

        await persistTurnTags({ ...baseScope, projectId: 12, text: "#Pricing in our space" });

        expect(upsertTopic).toHaveBeenCalledWith(
            { name: "Pricing" },
            { organizationId: 7 },
            12,
        );
    });

    it("returns [] for untagged text without touching the database", async () => {
        const rows = await persistTurnTags({ ...baseScope, text: "plain message, no tags" });

        expect(rows).toEqual([]);
        expect(insert).not.toHaveBeenCalled();
        expect(upsertTopic).not.toHaveBeenCalled();
    });

    it("swallows taxonomy failures — a round must never die on a tag write", async () => {
        findTopicByName.mockRejectedValue(new Error("db down"));

        const rows = await persistTurnTags({ ...baseScope, text: "#pricing matters" });

        expect(rows).toEqual([]);
    });

    it("indexes a tagged user turn as a knowledge document under its topics", async () => {
        await persistTurnTags({
            ...baseScope,
            text: "we should compare #[Vendor A] and #[Vendor B] on total cost of ownership",
        });
        // indexTaggedTurn is fire-and-forget — flush the microtask chain.
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        expect(createDocument).toHaveBeenCalledTimes(1);
        const [input, ctx] = createDocument.mock.calls[0];
        expect(input.sourceType).toBe("crew_turn");
        expect(input.title).toContain("Crew turn 42");
        expect(input.topicIds).toEqual([501]);
        expect(input.metadata).toMatchObject({ sessionId: 10, turnId: 42, round: 3 });
        expect(ctx.organizationId).toBe(7);
    });

    it("does not index agent turns — agent write-back already lands elsewhere", async () => {
        await persistTurnTags({
            ...baseScope,
            source: "agent",
            text: "agent prose declaring #[consensus] was reached in this long paragraph",
        });
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        expect(createDocument).not.toHaveBeenCalled();
    });

    it("persists agent tags as pending when the room gates them", async () => {
        const rows = await persistTurnTags({
            ...baseScope,
            source: "agent",
            text: "agent declared #[consensus] and #wrap-up here",
            gateAgentTags: true,
        });

        expect(rows).toHaveLength(2);
        expect(tagValues().every((v) => v.status === "pending")).toBe(true);
    });

    it("auto-applies agent tags when the gate is off", async () => {
        await persistTurnTags({
            ...baseScope,
            source: "agent",
            text: "agent declared #[consensus] here",
        });

        expect(tagValues().every((v) => v.status === "applied")).toBe(true);
    });

    it("reinforces learned keywords for user labels under the classified topic", async () => {
        await persistTurnTags({
            ...baseScope,
            text: "more on #[compound interest] math please",
            classifiedTopic: "Finance",
        });
        await flush();

        expect(learnedValues()).toEqual([
            { organizationId: 7, label: "Compound Interest", topic: "Finance" },
        ]);
    });

    it("teaches the classifier nothing when the classified topic is General", async () => {
        await persistTurnTags({
            ...baseScope,
            text: "a #[misc note] with no real category",
            classifiedTopic: "General",
        });
        await flush();

        expect(learnedValues()).toEqual([]);
    });

    it("learns nothing from agent tags — only user declarations train the classifier", async () => {
        await persistTurnTags({
            ...baseScope,
            source: "agent",
            text: "agent said #[compound interest] matters",
            classifiedTopic: "Finance",
        });
        await flush();

        expect(learnedValues()).toEqual([]);
    });

    it("records agent label affinities and promotes the classified category", async () => {
        await persistTurnTags({
            ...baseScope,
            source: "agent",
            text: "agent declared #[consensus] was reached in this paragraph",
            agentCardId: 9,
            classifiedTopic: "Finance",
        });
        await flush();

        expect(update).toHaveBeenCalled();
        const setArg = update.mock.results[0].value.set.mock.calls[0][0];
        expect(setArg.topicLabelAffinities).toEqual([{ label: "Consensus", count: 1 }]);
        expect(setArg.topicAffinities).toEqual(["Finance"]);
    });

    it("does not learn affinities from pending (ungated-approval) agent tags", async () => {
        await persistTurnTags({
            ...baseScope,
            source: "agent",
            text: "agent declared #[consensus] was reached in this paragraph",
            agentCardId: 9,
            classifiedTopic: "Finance",
            gateAgentTags: true,
        });
        await flush();

        expect(update).not.toHaveBeenCalled();
    });
});
