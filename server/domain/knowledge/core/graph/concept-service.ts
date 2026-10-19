import { db } from "@server/database_service.js";
import { eq, and, sql, desc, inArray, ilike } from "drizzle-orm";
import { knowledgeConcepts, knowledgeTopicConcepts, knowledgeTopics, knowledgePolicyConstraints, knowledgeSmes } from "@shared/schema/knowledge/index.js";
import { withQueryTracking } from "@domain/knowledge/core/query-monitor.service.js";
import type { OrgContext } from "@server/domain/jobs/job.service.js";
import { getOrgConditions } from "@server/utils/index.js";
import { requireOrgId } from "@server/utils/auth-context.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

export class ConceptService {
    /**
     * List all concepts for an organization.
     */
    async listConcepts(orgContext: OrgContext) {
        return withQueryTracking("conceptService.listConcepts", async () => {
            const conditions = getOrgConditions(orgContext, knowledgeConcepts);
            return db.select().from(knowledgeConcepts).where(and(...conditions)).orderBy(knowledgeConcepts.name);
        }, { table: "knowledge_concepts", operation: "select" });
    }

    /**
     * Create or return a concept, scoped to a Project Space.
     *
     * Uniqueness on `knowledge_concepts` is split across TWO PARTIAL indexes
     * (migration 0059):
     *
     *   knowledge_concepts_org_name_unique          (organization_id, name)
     *                                               WHERE project_id IS NULL
     *   knowledge_concepts_org_project_name_unique  (organization_id, project_id, name)
     *                                               WHERE project_id IS NOT NULL
     *
     * Postgres only matches a partial index when the conflict target restates its
     * predicate, so ONE `onConflictDoUpdate` cannot serve both cases — the target has
     * to be chosen from `projectId`. Getting this wrong doesn't error, it just misses
     * the index and raises a unique violation instead of upserting.
     *
     * `DoUpdate` rather than `DoNothing` on purpose: `DoNothing` returns no row, and
     * every caller here needs the id back to attach links or evidence to.
     *
     * Idempotent by design — safe for continuously-running collectors that re-assert
     * the same vocabulary on every tick.
     */
    async upsertConcept(
        name: string,
        description: string,
        orgContext: OrgContext,
        projectId: number | null = null,
    ) {
        return withQueryTracking("conceptService.upsertConcept", async () => {
            const organizationId = requireOrgId(orgContext);

            const conflictTarget = projectId === null
                ? {
                    target: [knowledgeConcepts.organizationId, knowledgeConcepts.name],
                    targetWhere: sql`project_id IS NULL`,
                }
                : {
                    target: [
                        knowledgeConcepts.organizationId,
                        knowledgeConcepts.projectId,
                        knowledgeConcepts.name,
                    ],
                    targetWhere: sql`project_id IS NOT NULL`,
                };

            const [concept] = await db.insert(knowledgeConcepts).values({
                name,
                description,
                organizationId,
                projectId,
                createdAt: new Date(),
                updatedAt: new Date(),
            }).onConflictDoUpdate({
                ...conflictTarget,
                set: { description, updatedAt: new Date() },
            }).returning();

            return concept;
        }, { table: "knowledge_concepts", operation: "insert" });
    }

    /**
     * Create a new concept at org scope.
     *
     * Delegates to {@link upsertConcept}. It previously issued a bare INSERT with no
     * conflict handling and no project scope, so a second call with the same name
     * raised a unique violation.
     */
    async createConcept(name: string, description: string, orgContext: OrgContext) {
        return this.upsertConcept(name, description, orgContext, null);
    }

    /**
     * Manually map a topic to a concept.
     */
    async mapTopicToConcept(topicId: number, conceptId: number) {
        return withQueryTracking("conceptService.mapTopicToConcept", async () => {
            const [existing] = await db.select().from(knowledgeTopicConcepts).where(
                and(
                    eq(knowledgeTopicConcepts.topicId, topicId),
                    eq(knowledgeTopicConcepts.conceptId, conceptId)
                )
            ).limit(1);

            if (!existing) {
                await db.insert(knowledgeTopicConcepts).values({
                    topicId,
                    conceptId,
                    createdAt: new Date()
                });
            }
        }, { table: "knowledge_topic_concepts", operation: "insert" });
    }

    /**
     * Automatically discover and link topics to high-level concepts using AI.
     */
    async autoLinkTopicsToConcepts(orgContext: OrgContext) {
        return withQueryTracking("conceptService.autoLinkTopicsToConcepts", async () => {
            // 1. Fetch topics
            const topics = await db.select()
                .from(knowledgeTopics)
                .where(eq(knowledgeTopics.organizationId, orgContext.organizationId as number));

            if (topics.length === 0) return;

            // 2. AI Grouping
            const topicNames = topics.map(t => t.name).join(", ");
            const prompt = `
                Group the following Knowledge Topics into 5-10 high-level "Concepts" (e.g. Infrastructure, Security, Billing, UI/UX).
                Topics: ${topicNames}

                Response JSON:
                { 
                  "concepts": [ 
                    { "name": "Concept Name", "description": "Short description", "topics": ["Topic 1", "Topic 2"] } 
                  ] 
                }
            `;

            const client = AIClientFactory.getClient({ provider: "google" } as any);
            const result = await client.execute({
                credentialId: 0,
                model: "gemini-2.0-flash",
                userPrompt: prompt,
                systemPrompt: "You are a Semantic Classification Engine. Output strict JSON.",
                requestType: "json",
                temperature: 0.1,
                useCache: false,
                enableQueryExpansion: false,
                saveOutputToFile: false,
                maxTokens: 2048
            }, undefined, developmentProviderKey());

            if (!result.success || !result.output) return;

            try {
                const jsonStr = result.output.replace(/```json/g, '').replace(/```/g, '').trim();
                const data = JSON.parse(jsonStr);

                for (const c of data.concepts) {
                    // Ensure Concept exists
                    let [concept] = await db.select().from(knowledgeConcepts).where(
                        and(
                            eq(knowledgeConcepts.organizationId, orgContext.organizationId as number),
                            ilike(knowledgeConcepts.name, c.name)
                        )
                    ).limit(1);

                    if (!concept) {
                        [concept] = await db.insert(knowledgeConcepts).values({
                            name: c.name,
                            description: c.description,
                            organizationId: orgContext.organizationId as number,
                        }).returning();
                    }

                    // Map topics
                    for (const tName of c.topics) {
                        const topic = topics.find(t => t.name.toLowerCase() === tName.toLowerCase());
                        if (topic) {
                            await this.mapTopicToConcept(topic.id, concept.id);
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to parse auto-linkage JSON:", e);
            }
        }, { table: "knowledge_concepts", operation: "insert" });
    }

    /**
     * Link a governance policy rule to a concept.
     */
    async linkPolicyToConcept(conceptId: number, policyRuleId: number, severity: string = "info") {
        return withQueryTracking("conceptService.linkPolicyToConcept", async () => {
            await db.insert(knowledgePolicyConstraints).values({
                conceptId,
                policyRuleId,
                severity
            }).onConflictDoUpdate({
                target: [knowledgePolicyConstraints.conceptId, knowledgePolicyConstraints.policyRuleId],
                set: { severity }
            });
        }, { table: "knowledge_policy_constraints", operation: "insert" });
    }

    /**
     * Link a Subject Matter Expert (SME) to a concept.
     */
    async linkSmeToConcept(conceptId: number, userId: string, level: string = "expert") {
        return withQueryTracking("conceptService.linkSmeToConcept", async () => {
            await db.insert(knowledgeSmes).values({
                conceptId,
                userId,
                level
            }).onConflictDoUpdate({
                target: [knowledgeSmes.conceptId, knowledgeSmes.userId],
                set: { level }
            });
        }, { table: "knowledge_smes", operation: "insert" });
    }
}

export const conceptService = new ConceptService();


