import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { knowledgeNodes } from "@shared/schema/knowledge/graph.js";
import { cosineSimilarity, type VersionedEmbedding } from "@shared/product/embedding-contract.js";
import { embeddingService } from "@domain/knowledge/core/rag/embedding-service.js";

export const knowledgeSemanticGroundingService = {
  async ground(query: string, organizationId: number, limit = 8) {
    const queryEmbedding = await embeddingService.generateVersionedEmbedding(query);
    if (!queryEmbedding) return { embeddingSpace: null, evidence: [], incompatibleSkipped: 0 };

    const nodes = await db.select({
      id: knowledgeNodes.id,
      name: knowledgeNodes.name,
      label: knowledgeNodes.label,
      confidenceScore: knowledgeNodes.confidenceScore,
      embedding: knowledgeNodes.embedding,
      provider: knowledgeNodes.embeddingProvider,
      model: knowledgeNodes.embeddingModel,
      dimensions: knowledgeNodes.embeddingDimensions,
      version: knowledgeNodes.embeddingVersion,
    }).from(knowledgeNodes).where(and(
      eq(knowledgeNodes.organizationId, organizationId),
      eq(knowledgeNodes.verificationStatus, "verified"),
      isNotNull(knowledgeNodes.embedding),
    ));

    let incompatibleSkipped = 0;
    const evidence = nodes.flatMap((node) => {
      try {
        const candidate: VersionedEmbedding = {
          provider: node.provider ?? "unknown",
          model: node.model ?? "unknown",
          dimensions: node.dimensions ?? 0,
          version: node.version ?? "unknown",
          vector: JSON.parse(node.embedding ?? "[]"),
        };
        const similarity = cosineSimilarity(queryEmbedding, candidate);
        if (similarity == null) {
          incompatibleSkipped++;
          return [];
        }
        return [{ id: node.id, name: node.name, label: node.label, confidenceScore: node.confidenceScore, similarity }];
      } catch {
        incompatibleSkipped++;
        return [];
      }
    }).sort((a, b) => b.similarity - a.similarity).slice(0, Math.min(Math.max(limit, 1), 50));

    return {
      embeddingSpace: {
        provider: queryEmbedding.provider,
        model: queryEmbedding.model,
        dimensions: queryEmbedding.dimensions,
        version: queryEmbedding.version,
      },
      evidence,
      incompatibleSkipped,
    };
  },
};
