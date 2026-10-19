import { createHash } from "node:crypto";
import { db } from "@server/database_service.js";
import { knowledgeNodes, missions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { embeddingService } from "@domain/knowledge/core/rag/embedding-service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BlackboardKnowledgeExtraction");
const SENSITIVE_KEY = /(password|passphrase|secret|token|api[_-]?key|authorization|cookie|credential)/i;

export function redactBlackboardValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBlackboardValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? "[redacted]" : redactBlackboardValue(item),
    ]));
  }
  return value;
}

export function extractBlackboardCandidates(patch: unknown) {
  const safePatch = redactBlackboardValue(patch);
  if (!safePatch || typeof safePatch !== "object" || Array.isArray(safePatch)) return [];
  return Object.entries(safePatch as Record<string, unknown>)
    .map(([key, value]) => ({ key, value, text: `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}` }))
    .filter((candidate) => candidate.text.length >= 24 && candidate.text.length <= 8_000);
}

export const blackboardKnowledgeExtractionService = {
  async process(input: { missionId: number; patch: unknown; changedBy: string; reason: string; streamId?: string }) {
    const [mission] = await db.select({ id: missions.id, name: missions.name, organizationId: missions.organizationId })
      .from(missions).where(eq(missions.id, input.missionId)).limit(1);
    if (!mission?.organizationId) return { created: 0, skipped: "mission organization unavailable" };

    let created = 0;
    for (const candidate of extractBlackboardCandidates(input.patch)) {
      const fingerprint = createHash("sha256")
        .update(`${mission.organizationId}:${input.missionId}:${candidate.key}:${candidate.text}`)
        .digest("hex");
      const embedded = await embeddingService.generateVersionedEmbedding(candidate.text);
      const inserted = await db.insert(knowledgeNodes).values({
        organizationId: mission.organizationId,
        missionId: input.missionId,
        label: "MissionBlackboardFact",
        name: `${mission.name}: ${candidate.key}`,
        data: { key: candidate.key, value: candidate.value, changeReason: input.reason },
        extractionSources: [{ type: "mission_blackboard", missionId: input.missionId, changedBy: input.changedBy, streamId: input.streamId }],
        fingerprint,
        verificationStatus: "staging",
        confidenceScore: "0.75",
        initialConfidenceScore: "0.75",
        sourceType: "system",
        fidelityClass: "operational",
        embedding: embedded ? JSON.stringify(embedded.vector) : null,
        embeddingProvider: embedded?.provider,
        embeddingModel: embedded?.model,
        embeddingDimensions: embedded?.dimensions,
        embeddingVersion: embedded?.version,
        createdBy: input.changedBy,
      }).onConflictDoNothing().returning({ id: knowledgeNodes.id });
      created += inserted.length;
    }
    logger.debug(`Extracted ${created} staged knowledge node(s) from mission ${input.missionId}`);
    return { created };
  },
};
