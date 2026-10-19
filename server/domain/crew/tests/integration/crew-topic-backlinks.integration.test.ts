/** @vitest-environment node */
import { describe, it, expect, beforeAll } from "vitest";
import { configureTestEnvironment } from "../../../../../tests/configure-test-environment.js";

/**
 * Topic backlinks quote the turns tagged with a topic. A shared topic must not
 * carry a private project's conversation to the rest of the org: only rooms with
 * no project, or in a project the caller can read, contribute.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { orgs } = await import("@shared/schema/auth.js");
const { crewSessions, crewTurns, crewTurnTopics } = await import("@shared/schema/crew.js");
const { knowledgeTopics } = await import("@shared/schema/knowledge-base.js");
const { projects } = await import("@shared/schema/projects.js");
const { getTopicBacklinks } = await import("../../core/crew-topics.service.js");

let reachable = false;
try {
    await db.execute("SELECT 1 FROM crew_turn_topics LIMIT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[topic-backlinks] SKIPPED — no migrated test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();

describe.skipIf(!reachable)("CREW topic backlinks", () => {
    let orgId: number, topicId: number, privateProjectId: number;

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Backlinks ${stamp}`, slug: `backlinks-${stamp}` } as any).returning();
        orgId = org.id;
        const [p] = await db.insert(projects).values({ organizationId: orgId, key: `secret-${stamp}`, name: "Secret", visibility: "private", createdBy: "test" } as any).returning();
        privateProjectId = p.id;
        const [topic] = await db.insert(knowledgeTopics).values({ name: `Pricing ${stamp}`, organizationId: orgId } as any).returning();
        topicId = topic.id;
        for (const [key, projectId, content] of [["open", null, "Open room on pricing"], ["secret", privateProjectId, "Private pricing plan"]] as const) {
            const [session] = await db.insert(crewSessions).values({ organizationId: orgId, sessionKey: `${key}-${stamp}`, projectId } as any).returning();
            const [turn] = await db.insert(crewTurns).values({ sessionId: session.id, organizationId: orgId, speakerType: "user", speakerName: "Sam", content } as any).returning();
            await db.insert(crewTurnTopics).values({ sessionId: session.id, turnId: turn.id, organizationId: orgId, topicId, label: "pricing", rawLabel: "#pricing", source: "user" } as any);
        }
    });

    it("leaves out rooms in projects the caller cannot read", async () => {
        const turns = await getTopicBacklinks(orgId, topicId, 50, []);
        expect(turns.map(t => t.excerpt)).toEqual(["Open room on pricing"]);
    });

    it("includes them for a caller who can read the project", async () => {
        const turns = await getTopicBacklinks(orgId, topicId, 50, [privateProjectId]);
        expect(turns.map(t => t.excerpt).sort()).toEqual(["Open room on pricing", "Private pricing plan"]);
    });
});
