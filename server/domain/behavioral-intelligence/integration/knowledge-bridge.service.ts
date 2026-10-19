/**
 * Behavioral Intelligence Engine — Knowledge Bridge
 *
 * Links scoring vectors, rules, and signals to the Knowledge Graph
 * via topics and concepts. Enables:
 * - Semantic grouping of scoring rules by business concept
 * - Agent context enrichment (agents understand WHY a score crossed)
 * - Knowledge graph queries for scoring patterns
 * - Auto-concept assignment on prediction proposals
 */
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { knowledgeTopics, knowledgeConcepts, knowledgeTopicConcepts } from "@shared/schema/knowledge-base.js";
import { eq, and } from "drizzle-orm";

const logger = createLogger("BIKnowledgeBridge");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConceptTag {
  concept_id: number;
  concept_name: string;
  topic_id?: number;
  topic_name?: string;
}

// ─── Topic/Concept Management ────────────────────────────────────────────────

/**
 * Ensure a knowledge topic exists for a scoring model.
 * Creates it if it doesn't exist.
 */
async function ensureTopic(orgId: number, topicName: string, description?: string): Promise<number> {
  const [existing] = await db.select({ id: knowledgeTopics.id })
    .from(knowledgeTopics)
    .where(and(eq(knowledgeTopics.organizationId, orgId), eq(knowledgeTopics.name, topicName)))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db.insert(knowledgeTopics).values({
    name: topicName,
    description: description || `Behavioral Intelligence: ${topicName}`,
    organizationId: orgId,
    createdBy: "system:bi-engine",
  }).returning({ id: knowledgeTopics.id });

  logger.info(`[KnowledgeBridge] Created topic "${topicName}" (ID: ${created.id}) for org ${orgId}`);
  return created.id;
}

/**
 * Ensure a knowledge concept exists for a scoring vector/signal type.
 */
async function ensureConcept(orgId: number, conceptName: string, description?: string): Promise<number> {
  const [existing] = await db.select({ id: knowledgeConcepts.id })
    .from(knowledgeConcepts)
    .where(and(eq(knowledgeConcepts.organizationId, orgId), eq(knowledgeConcepts.name, conceptName)))
    .limit(1);

  if (existing) return existing.id;

  const [created] = await db.insert(knowledgeConcepts).values({
    name: conceptName,
    description: description || `Behavioral signal: ${conceptName}`,
    organizationId: orgId,
    createdBy: "system:bi-engine",
  }).returning({ id: knowledgeConcepts.id });

  logger.info(`[KnowledgeBridge] Created concept "${conceptName}" (ID: ${created.id}) for org ${orgId}`);
  return created.id;
}

/**
 * Link a concept to a topic (if not already linked).
 */
async function linkConceptToTopic(topicId: number, conceptId: number): Promise<void> {
  await db.insert(knowledgeTopicConcepts).values({ topicId, conceptId })
    .onConflictDoNothing();
}

/**
 * Create the full topic + concept structure for a vector model.
 * Called during blueprint install or model creation.
 */
async function provisionModelKnowledge(
  orgId: number,
  modelName: string,
  vectors: Array<{ name: string; description: string }>
): Promise<{ topicId: number; conceptIds: Record<string, number> }> {
  // Create topic for the model
  const topicId = await ensureTopic(orgId, `BI: ${modelName}`, `Behavioral Intelligence scoring model: ${modelName}`);

  // Create concepts for each vector
  const conceptIds: Record<string, number> = {};
  for (const vector of vectors) {
    const conceptId = await ensureConcept(orgId, `${modelName}: ${vector.name}`, vector.description);
    await linkConceptToTopic(topicId, conceptId);
    conceptIds[vector.name] = conceptId;
  }

  logger.info(`[KnowledgeBridge] Provisioned knowledge for model "${modelName}": topic=${topicId}, concepts=${Object.keys(conceptIds).length}`);
  return { topicId, conceptIds };
}

/**
 * Get the concept tag for a vector (for signal log enrichment).
 */
async function getConceptForVector(orgId: number, modelName: string, vectorName: string): Promise<ConceptTag | null> {
  const conceptName = `${modelName}: ${vectorName}`;
  const [concept] = await db.select({ id: knowledgeConcepts.id, name: knowledgeConcepts.name })
    .from(knowledgeConcepts)
    .where(and(eq(knowledgeConcepts.organizationId, orgId), eq(knowledgeConcepts.name, conceptName)))
    .limit(1);

  if (!concept) return null;
  return { concept_id: concept.id, concept_name: concept.name };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biKnowledgeBridge = {
  ensureTopic,
  ensureConcept,
  linkConceptToTopic,
  provisionModelKnowledge,
  getConceptForVector,
};
