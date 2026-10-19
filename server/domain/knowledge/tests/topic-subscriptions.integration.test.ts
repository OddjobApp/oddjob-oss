/** @vitest-environment node */
import { describe, it, expect, beforeAll } from "vitest";
import { configureTestEnvironment } from "../../../../tests/configure-test-environment.js";

/**
 * Following a topic must not carry a private project to the rest of the org:
 * its topics cannot be followed from outside it, and neither the follow list
 * nor the activity feed shows them (or turns from its rooms) to a caller who
 * cannot read the project. Same visibility rule as the topic backlinks.
 */

configureTestEnvironment();

const { db } = await import("@server/database_service.js");
const { orgs } = await import("@shared/schema/auth.js");
const { crewSessions, crewTurns, crewTurnTopics } = await import("@shared/schema/crew.js");
const { knowledgeTopics, topicSubscriptions } = await import("@shared/schema/knowledge-base.js");
const { projects } = await import("@shared/schema/projects.js");
const { topicService } = await import("../core/topic-service.js");

let reachable = false;
try {
    await db.execute("SELECT 1 FROM topic_subscriptions LIMIT 1" as any);
    reachable = true;
} catch (e: any) {
    console.warn(`[topic-subscriptions] SKIPPED — no migrated test database reachable (${e?.message ?? e}).`);
}

const stamp = Date.now();
const USER = `follower-${stamp}`;

describe.skipIf(!reachable)("topic subscriptions", () => {
    let orgId: number, openTopicId: number, privateTopicId: number, privateProjectId: number;
    const ctx = () => ({ organizationId: orgId, userId: USER, isOrgAdmin: false, isSuperAdmin: false }) as any;

    beforeAll(async () => {
        const [org] = await db.insert(orgs).values({ name: `Follow ${stamp}`, slug: `follow-${stamp}` } as any).returning();
        orgId = org.id;
        const [p] = await db.insert(projects).values({ organizationId: orgId, key: `secret-${stamp}`, name: "Secret", visibility: "private", createdBy: "test" } as any).returning();
        privateProjectId = p.id;
        const [open] = await db.insert(knowledgeTopics).values({ name: `Pricing ${stamp}`, organizationId: orgId } as any).returning();
        openTopicId = open.id;
        const [secret] = await db.insert(knowledgeTopics).values({ name: `Acquisition ${stamp}`, organizationId: orgId, projectId: privateProjectId } as any).returning();
        privateTopicId = secret.id;
        // The open topic is tagged in an open room and in a private project's room.
        for (const [key, projectId, content] of [["open", null, "Open room on pricing"], ["secret", privateProjectId, "Private pricing plan"]] as const) {
            const [session] = await db.insert(crewSessions).values({ organizationId: orgId, sessionKey: `follow-${key}-${stamp}`, projectId } as any).returning();
            const [turn] = await db.insert(crewTurns).values({ sessionId: session.id, organizationId: orgId, speakerType: "user", speakerName: key, content } as any).returning();
            await db.insert(crewTurnTopics).values({ sessionId: session.id, turnId: turn.id, organizationId: orgId, topicId: openTopicId, label: "pricing", rawLabel: "#pricing", source: "user", status: "applied" } as any);
        }
    });

    it("refuses to follow a private project's topic from outside the project", async () => {
        await expect(topicService.subscribe(privateTopicId, USER, ctx(), [])).rejects.toThrow(/not found/i);
    });

    it("lists only followed topics the caller can still see", async () => {
        await topicService.subscribe(openTopicId, USER, ctx(), []);
        await topicService.subscribe(privateTopicId, USER, ctx(), [privateProjectId]);

        expect((await topicService.listSubscriptions(USER, ctx(), [])).map(s => s.topicId)).toEqual([openTopicId]);
        expect((await topicService.listSubscriptions(USER, ctx(), [privateProjectId])).map(s => s.topicId).sort())
            .toEqual([openTopicId, privateTopicId].sort());
    });

    it("leaves private projects' rooms out of the activity feed", async () => {
        const outside = await topicService.subscriptionActivity(USER, ctx(), 50, []);
        expect(outside.map(a => a.speakerName)).toEqual(["open"]);
        const member = await topicService.subscriptionActivity(USER, ctx(), 50, [privateProjectId]);
        expect(member.map(a => a.speakerName).sort()).toEqual(["open", "secret"]);
    });

    it("cleans up", async () => {
        await db.delete(topicSubscriptions).where((await import("drizzle-orm")).eq(topicSubscriptions.organizationId, orgId));
    });
});
