
import { db } from "@server/database_service.js";
import { knowledgeTopics, knowledgeTopicDocuments, datasets } from "@shared/schema/index.js";
import { eq, and, sql, desc, ilike } from "drizzle-orm";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { requireOrgId } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "../../../domain/jobs/job.service.js";
import { getOrgConditions } from "../../../utils/index.js";

const logger = createLogger("TopicService");

export const topicService = {
    /**
     * List knowledge topics
     */
    async listTopics(orgContext: OrgContext, includeCounts = false) {
        return withQueryTracking("topicService.listTopics", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeTopics);

            const topics = await db.select().from(knowledgeTopics).where(and(...conditions)).orderBy(knowledgeTopics.name);

            if (!includeCounts) return topics;

            const counts = await db
                .select({
                    topicId: knowledgeTopicDocuments.topicId,
                    count: sql<number>`COUNT(${knowledgeTopicDocuments.documentId})`,
                })
                .from(knowledgeTopicDocuments)
                .groupBy(knowledgeTopicDocuments.topicId);

            const countMap = new Map(counts.map((row) => [row.topicId, Number(row.count)]));
            return topics.map((topic) => ({
                ...topic,
                documentCount: countMap.get(topic.id) ?? 0,
            }));
        }, { table: "knowledge_topics", operation: "select" });
    },

    /**
     * List datasets for an organization
     */
    async listDatasets(orgContext: OrgContext) {
        return withQueryTracking("topicService.listDatasets", async () => {
            const conditions = getOrgConditions(orgContext, datasets);
            return await db.select().from(datasets).where(and(...conditions)).orderBy(datasets.name);
        }, { table: "datasets", operation: "select" });
    },

    async getTopicById(topicId: number, orgContext: OrgContext) {
        return withQueryTracking("topicService.getTopicById", async () => {
            const conditions = [
                eq(knowledgeTopics.id, topicId),
                ...getOrgConditions(orgContext, knowledgeTopics)
            ];

            const [topic] = await db.select().from(knowledgeTopics).where(and(...conditions)).limit(1);
            if (!topic) throw new NotFoundError("Topic not found");
            return topic;
        }, { table: "knowledge_topics", operation: "select" });
    },

    /**
     * Create or return a topic, scoped to a Project Space.
     *
     * `knowledge_topics` splits uniqueness across two PARTIAL indexes, exactly
     * as `knowledge_concepts` does (migration 0059):
     *
     *   knowledge_topics_org_name_unique          (organization_id, name)
     *                                             WHERE project_id IS NULL
     *   knowledge_topics_org_project_name_unique  (organization_id, project_id, name)
     *                                             WHERE project_id IS NOT NULL
     *
     * Postgres matches a partial index only when the conflict target restates
     * its predicate, so the target has to be chosen from `projectId`. See
     * `conceptService.upsertConcept` for the same reasoning.
     *
     * Idempotent, so a continuously running promoter can re-assert the same
     * place on every tick without raising a unique violation.
     */
    async upsertTopic(
        input: { name: string; description?: string | null; parentTopicId?: number | null },
        orgContext: OrgContext,
        projectId: number | null = null,
    ) {
        return withQueryTracking("topicService.upsertTopic", async () => {
            const organizationId = requireOrgId(orgContext);

            const conflictTarget = projectId === null
                ? {
                    target: [knowledgeTopics.organizationId, knowledgeTopics.name],
                    targetWhere: sql`project_id IS NULL`,
                }
                : {
                    target: [knowledgeTopics.organizationId, knowledgeTopics.projectId, knowledgeTopics.name],
                    targetWhere: sql`project_id IS NOT NULL`,
                };

            const [topic] = await db.insert(knowledgeTopics).values({
                name: input.name,
                description: input.description,
                parentTopicId: input.parentTopicId,
                organizationId,
                projectId,
                createdAt: new Date(),
                updatedAt: new Date(),
            }).onConflictDoUpdate({
                ...conflictTarget,
                set: { description: input.description, updatedAt: new Date() },
            }).returning();

            return topic;
        }, { table: "knowledge_topics", operation: "insert" });
    },

    async createTopic(input: { name: string; description?: string | null; parentTopicId?: number | null }, orgContext: OrgContext) {
        return withQueryTracking("topicService.createTopic", async () => {
            const [topic] = await db.insert(knowledgeTopics).values({
                name: input.name,
                description: input.description,
                parentTopicId: input.parentTopicId,
                organizationId: orgContext.organizationId,
                createdAt: new Date(),
                updatedAt: new Date(),
            }).returning();
            logger.info("Topic created", { topicId: topic.id });
            return topic;
        }, { table: "knowledge_topics", operation: "insert" });
    },

    async updateTopic(topicId: number, input: { name?: string; description?: string | null; parentTopicId?: number | null }, orgContext: OrgContext) {
        return withQueryTracking("topicService.updateTopic", async () => {
            await this.getTopicById(topicId, orgContext); // Verify access

            const [updated] = await db.update(knowledgeTopics)
                .set({ ...input, updatedAt: new Date() })
                .where(eq(knowledgeTopics.id, topicId))
                .returning();

            logger.info("Topic updated", { topicId });
            return updated;
        }, { table: "knowledge_topics", operation: "update" });
    },

    async deleteTopic(topicId: number, orgContext: OrgContext) {
        return withQueryTracking("topicService.deleteTopic", async () => {
            await this.getTopicById(topicId, orgContext); // Verify access
            await db.delete(knowledgeTopics).where(eq(knowledgeTopics.id, topicId));
            logger.info("Topic deleted", { topicId });
        }, { table: "knowledge_topics", operation: "delete" });
    },

    /**
     * Merge `sourceId` into `targetId`: every reference the vocabulary has
     * accumulated — tagged turns, linked documents/concepts, breakouts,
     * session standing topics, spatial evidence, job/RAG/xray bindings —
     * repoints to the target, and the source row is deleted. The cure for
     * freeform-tag vocabulary forks ("Q4 Launch" vs "Launch Q4").
     *
     * Scope guard: merging across Project Space boundaries is rejected — a
     * project-scoped topic must not be silently promoted org-wide or leak
     * into a sibling project's vocabulary. `crew_turn_topics.label` keeps the
     * declared text (that's the historical record); only the entity link moves.
     */
    async mergeTopic(sourceId: number, targetId: number, orgContext: OrgContext) {
        return withQueryTracking("topicService.mergeTopic", async () => {
            if (sourceId === targetId) {
                throw new BadRequestError("A topic cannot be merged into itself.");
            }
            const source = await this.getTopicById(sourceId, orgContext);
            const target = await this.getTopicById(targetId, orgContext);
            if ((source.projectId ?? null) !== (target.projectId ?? null)) {
                throw new BadRequestError(
                    "Topics can only be merged within the same scope — a Project Space topic and an org-wide topic are different vocabularies.",
                );
            }

            const {
                knowledgeTopicConcepts, spatialConceptEvidence, xrayNodeDocumentation,
                ragAssets, jobOutputKnowledge, knowledgeNodes, jobs,
                crewTurnTopics, crewBreakouts, crewSessions,
            } = await import("@shared/schema/index.js");

            await db.transaction(async (tx) => {
                // Composite-PK link tables: repoint links the target lacks,
                // drop the ones that would collide.
                await tx.execute(sql`UPDATE knowledge_topic_documents SET topic_id = ${targetId} WHERE topic_id = ${sourceId} AND document_id NOT IN (SELECT document_id FROM knowledge_topic_documents WHERE topic_id = ${targetId})`);
                await tx.execute(sql`DELETE FROM knowledge_topic_documents WHERE topic_id = ${sourceId}`);
                await tx.execute(sql`UPDATE knowledge_topic_concepts SET topic_id = ${targetId} WHERE topic_id = ${sourceId} AND concept_id NOT IN (SELECT concept_id FROM knowledge_topic_concepts WHERE topic_id = ${targetId})`);
                await tx.execute(sql`DELETE FROM knowledge_topic_concepts WHERE topic_id = ${sourceId}`);

                // Followers tracked the vocabulary, not the row — repoint
                // subscriptions rather than letting the cascade drop them.
                // Skip users who already follow the target.
                await tx.execute(sql`UPDATE topic_subscriptions ts SET topic_id = ${targetId} WHERE ts.topic_id = ${sourceId} AND NOT EXISTS (SELECT 1 FROM topic_subscriptions other WHERE other.organization_id = ts.organization_id AND other.user_id = ts.user_id AND other.topic_id = ${targetId})`);
                await tx.execute(sql`DELETE FROM topic_subscriptions WHERE topic_id = ${sourceId}`);

                await tx.update(crewTurnTopics).set({ topicId: targetId }).where(eq(crewTurnTopics.topicId, sourceId));
                await tx.update(crewBreakouts).set({ topicId: targetId }).where(eq(crewBreakouts.topicId, sourceId));
                await tx.update(crewSessions).set({ activeTopicId: targetId }).where(eq(crewSessions.activeTopicId, sourceId));
                await tx.update(knowledgeTopics).set({ parentTopicId: targetId }).where(eq(knowledgeTopics.parentTopicId, sourceId));
                await tx.update(spatialConceptEvidence).set({ topicId: targetId }).where(eq(spatialConceptEvidence.topicId, sourceId));
                await tx.update(jobs).set({ outputKnowledgeTopicId: targetId }).where(eq(jobs.outputKnowledgeTopicId, sourceId));
                await tx.update(ragAssets).set({ knowledgeTopicId: targetId }).where(eq(ragAssets.knowledgeTopicId, sourceId));
                await tx.update(jobOutputKnowledge).set({ knowledgeTopicId: targetId }).where(eq(jobOutputKnowledge.knowledgeTopicId, sourceId));
                await tx.update(knowledgeNodes).set({ knowledgeTopicId: targetId }).where(eq(knowledgeNodes.knowledgeTopicId, sourceId));
                await tx.update(xrayNodeDocumentation).set({ knowledgeTopicId: targetId }).where(eq(xrayNodeDocumentation.knowledgeTopicId, sourceId));

                await tx.delete(knowledgeTopics).where(eq(knowledgeTopics.id, sourceId));
            });

            logger.info("Topic merged", { sourceId, targetId, sourceName: source.name, targetName: target.name });
            return target;
        }, { table: "knowledge_topics", operation: "delete" });
    },

    /** Follow a topic — idempotent so a double-click never 409s. */
    async subscribe(topicId: number, userId: string, orgContext: OrgContext, visibleProjectIds: number[] = []) {
        return withQueryTracking("topicService.subscribe", async () => {
            const organizationId = requireOrgId(orgContext);
            const topic = await this.getTopicById(topicId, orgContext); // verify in-org
            // A private project's topic is not followable from outside it: following
            // would put its name in the follower's list. Same answer as a missing topic.
            if (topic.projectId != null && !visibleProjectIds.includes(topic.projectId)) {
                throw new NotFoundError("Topic not found");
            }
            const { topicSubscriptions } = await import("@shared/schema/index.js");
            const [row] = await db.insert(topicSubscriptions)
                .values({ topicId, organizationId, userId })
                .onConflictDoNothing()
                .returning();
            return row ?? { topicId, organizationId, userId };
        }, { table: "topic_subscriptions", operation: "insert" });
    },

    async unsubscribe(topicId: number, userId: string, orgContext: OrgContext) {
        return withQueryTracking("topicService.unsubscribe", async () => {
            const organizationId = requireOrgId(orgContext);
            const { topicSubscriptions } = await import("@shared/schema/index.js");
            await db.delete(topicSubscriptions)
                .where(and(
                    eq(topicSubscriptions.topicId, topicId),
                    eq(topicSubscriptions.userId, userId),
                    eq(topicSubscriptions.organizationId, organizationId),
                ));
        }, { table: "topic_subscriptions", operation: "delete" });
    },

    /**
     * The topics this user follows in the org, leaving out topics of projects
     * they can no longer see (a follow can outlive their project membership).
     */
    async listSubscriptions(userId: string, orgContext: OrgContext, visibleProjectIds: number[] = []) {
        return withQueryTracking("topicService.listSubscriptions", async () => {
            const organizationId = requireOrgId(orgContext);
            const { topicSubscriptions } = await import("@shared/schema/index.js");
            const { inArray, isNull, or } = await import("drizzle-orm");
            return db
                .select({
                    subscriptionId: topicSubscriptions.id,
                    topicId: topicSubscriptions.topicId,
                    name: knowledgeTopics.name,
                    projectId: knowledgeTopics.projectId,
                    subscribedAt: topicSubscriptions.createdAt,
                })
                .from(topicSubscriptions)
                .innerJoin(knowledgeTopics, eq(knowledgeTopics.id, topicSubscriptions.topicId))
                .where(and(
                    eq(topicSubscriptions.organizationId, organizationId),
                    eq(topicSubscriptions.userId, userId),
                    visibleProjectIds.length
                        ? or(isNull(knowledgeTopics.projectId), inArray(knowledgeTopics.projectId, visibleProjectIds))
                        : isNull(knowledgeTopics.projectId),
                ));
        }, { table: "topic_subscriptions", operation: "select" });
    },

    /**
     * Activity feed for followed topics: recently applied turn tags across the
     * org's rooms. Rooms in projects outside `visibleProjectIds` are left out,
     * as in the topic backlinks: each entry names the room, speaker and tag, so
     * a private project's turns must not reach the org through a followed topic.
     */
    async subscriptionActivity(userId: string, orgContext: OrgContext, limit = 50, visibleProjectIds: number[] = []) {
        return withQueryTracking("topicService.subscriptionActivity", async () => {
            const organizationId = requireOrgId(orgContext);
            const { topicSubscriptions, crewTurnTopics, crewSessions, crewTurns } = await import("@shared/schema/index.js");
            const { inArray, isNull, or } = await import("drizzle-orm");
            const subs = await db
                .select({ topicId: topicSubscriptions.topicId })
                .from(topicSubscriptions)
                .where(and(
                    eq(topicSubscriptions.organizationId, organizationId),
                    eq(topicSubscriptions.userId, userId),
                ));
            const topicIds = subs.map((s) => s.topicId);
            if (!topicIds.length) return [];
            return db
                .select({
                    topicId: crewTurnTopics.topicId,
                    topicName: knowledgeTopics.name,
                    label: crewTurnTopics.label,
                    turnTopicId: crewTurnTopics.id,
                    turnId: crewTurnTopics.turnId,
                    sessionId: crewTurnTopics.sessionId,
                    sessionKey: crewSessions.sessionKey,
                    source: crewTurnTopics.source,
                    speakerName: crewTurns.speakerName,
                    createdAt: crewTurnTopics.createdAt,
                })
                .from(crewTurnTopics)
                .innerJoin(knowledgeTopics, eq(knowledgeTopics.id, crewTurnTopics.topicId))
                .innerJoin(crewSessions, eq(crewSessions.id, crewTurnTopics.sessionId))
                .innerJoin(crewTurns, eq(crewTurns.id, crewTurnTopics.turnId))
                .where(and(
                    eq(crewTurnTopics.organizationId, organizationId),
                    eq(crewTurnTopics.status, "applied"),
                    inArray(crewTurnTopics.topicId, topicIds),
                    visibleProjectIds.length
                        ? or(isNull(crewSessions.projectId), inArray(crewSessions.projectId, visibleProjectIds))
                        : isNull(crewSessions.projectId),
                ))
                .orderBy(desc(crewTurnTopics.createdAt))
                .limit(limit);
        }, { table: "crew_turn_topics", operation: "select" });
    },
    async findTopicByName(name: string, orgContext: OrgContext) {
        return withQueryTracking("topicService.findTopicByName", async () => {
            const conditions = [
                ilike(knowledgeTopics.name, `%${name}%`),
                ...getOrgConditions(orgContext, knowledgeTopics)
            ];

            const topics = await db.select().from(knowledgeTopics).where(and(...conditions)).limit(10);
            return topics;
        }, { table: "knowledge_topics", operation: "select" });
    },
};


