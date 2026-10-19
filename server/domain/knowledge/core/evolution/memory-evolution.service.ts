import { db } from "../../../../database_service.js";
import { knowledgeNodes, knowledgeEvolutionEvents, missions } from "@shared/schema/index.js";
import { rescueSessions } from "@shared/schema/rescue.js";
import { eq, sql, lt, and, desc, count, like } from "drizzle-orm";
import { createLogger } from "../../../../utils/logger.js";

const logger = createLogger("MemoryEvolutionService");

export const memoryEvolutionService = {
  /**
   * Calculate utility scores for all nodes in an organization.
   * Logic: (UsageCount * 0.5) + (ConfidenceScore * 0.3) + (RecencyWeight * 0.2)
   */
  async refreshUtilityScores(organizationId: number): Promise<void> {
    logger.info(`Refreshing utility scores for org ${organizationId}`);

    // Update utility_score based on usage, confidence, and recency
    // Recency is calculated as days since lastReaffirmedAt (max 30 days)
    await db.execute(sql`
      UPDATE knowledge_nodes
      SET utility_score = (
        (COALESCE(usage_count, 0) * 0.5) + 
        (CAST(COALESCE(confidence_score, '85') AS DECIMAL) * 0.5) +
        (GREATEST(0, 30 - EXTRACT(DAY FROM (NOW() - COALESCE(last_reaffirmed_at, created_at, NOW())))) * 0.5)
      )
      WHERE organization_id = ${organizationId}
    `);

    logger.info(`Utility scores updated for org ${organizationId}`);
  },

  /**
   * Archive nodes that fall below the "Zombie Threshold" (utility_score < 5).
   */
  async pruneStaleKnowledge(organizationId: number, threshold: number = 5.0): Promise<number> {
    logger.info(`Pruning stale knowledge for org ${organizationId} with threshold ${threshold}`);

    // Pruning in Phase 4 means moving to 'rejected' or a new 'archived' status.
    // For now, we'll use 'rejected' to hide them from standard RAG/Search.
    const result = await db
      .update(knowledgeNodes)
      .set({ 
        verificationStatus: "rejected", 
        updatedAt: new Date() 
      })
      .where(
        and(
          eq(knowledgeNodes.organizationId, organizationId),
          lt(knowledgeNodes.utilityScore, String(threshold)),
          eq(knowledgeNodes.verificationStatus, "verified")
        )
      )
      .returning({ id: knowledgeNodes.id });

    logger.info(`Pruned ${result.length} stale nodes from org ${organizationId}`);

    // Log the event
    await db.insert(knowledgeEvolutionEvents).values({
      type: "PRUNING",
      status: "SUCCESS",
      organizationId,
      details: {
        nodesPruned: result.length,
        nodeIds: result.map(n => n.id),
        threshold
      }
    });

    return result.length;
  },

  /**
   * Flag and penalize knowledge nodes identified as culprits in repeated mission failures.
   * Logic: If a node is a culprit in >= 3 rescue sessions, reduce utility score.
   * If it's a culprit in >= 5, mark as 'rejected'.
   */
  async flagCulpritNodes(organizationId: number): Promise<{ penalized: number; rejected: number }> {
    logger.info(`Flagging culprit nodes for org ${organizationId}`);

    // 1. Identify nodes with multiple failures
    const culpritStats = await db
      .select({
        nodeId: rescueSessions.culpritNodeId,
        failureCount: count(),
      })
      .from(rescueSessions)
      .where(
        and(
          eq(rescueSessions.organizationId, organizationId),
          sql`${rescueSessions.culpritNodeId} IS NOT NULL`
        )
      )
      .groupBy(rescueSessions.culpritNodeId)
      .having(sql`count(*) >= 3`);

    let penalized = 0;
    let rejected = 0;

    for (const stat of culpritStats) {
      if (!stat.nodeId) continue;

      if (stat.failureCount >= 5) {
        // Hard Reject
        await db.update(knowledgeNodes)
          .set({ 
            verificationStatus: "rejected",
            updatedAt: new Date(),
            data: sql`data || jsonb_build_object('rejection_reason', 'Repeated mission failure culprit')`
          })
          .where(eq(knowledgeNodes.id, stat.nodeId));
        rejected++;
      } else {
        // Penalty
        await db.update(knowledgeNodes)
          .set({ 
            utilityScore: sql`GREATEST(0, (utility_score)::numeric - 20)::text`,
            updatedAt: new Date()
          })
          .where(eq(knowledgeNodes.id, stat.nodeId));
        penalized++;
      }
    }

    if (penalized > 0 || rejected > 0) {
      await db.insert(knowledgeEvolutionEvents).values({
        type: "INTEGRITY_CHECK",
        status: "SUCCESS",
        organizationId,
        details: {
          penalizedCount: penalized,
          rejectedCount: rejected,
          reason: "Repeated failure culprits identified"
        }
      });
    }

    logger.info(`Culprit pruning complete: ${penalized} penalized, ${rejected} rejected`);
    return { penalized, rejected };
  },

  async getMaturityStats(organizationId: number) {
    const nodes = await db.select({
      utilityScore: knowledgeNodes.utilityScore,
      verificationStatus: knowledgeNodes.verificationStatus,
      usageCount: knowledgeNodes.usageCount,
    })
      .from(knowledgeNodes)
      .where(eq(knowledgeNodes.organizationId, organizationId));

    const totalNodes = nodes.length;
    const activeNodes = nodes.filter(n => n.verificationStatus !== 'rejected').length;
    const prunedNodes = nodes.filter(n => n.verificationStatus === 'rejected').length;

    const highUtility = nodes.filter(n => Number(n.utilityScore) >= 80).length;
    const medUtility = nodes.filter(n => Number(n.utilityScore) >= 40 && Number(n.utilityScore) < 80).length;
    const lowUtility = nodes.filter(n => Number(n.utilityScore) < 40).length;

    const avgUtility = totalNodes > 0 
      ? nodes.reduce((acc, n) => acc + Number(n.utilityScore || 0), 0) / totalNodes 
      : 0;

    const totalUsage = nodes.reduce((acc, n) => acc + (n.usageCount || 0), 0);

    // Evolutionary score is a mix of avg utility, usage, and ratio of active nodes
    const maturityScore = Math.min(100, (avgUtility * 0.6) + (Math.min(1, totalUsage / 100) * 20) + (activeNodes / (totalNodes || 1) * 20));

    return {
      maturityScore: Math.round(maturityScore * 10) / 10,
      totalNodes,
      activeNodes,
      prunedNodes,
      utilityDistribution: {
        high: highUtility,
        medium: medUtility,
        low: lowUtility
      },
      avgUtility: Math.round(avgUtility * 10) / 10,
      totalUsage,
      efficiencyGain: Math.round((prunedNodes / (totalNodes || 1)) * 100 * 10) / 10
    };
  },

  async getProactiveMissions(organizationId: number, limit = 10) {
    return db.select()
      .from(missions)
      .where(and(
        eq(missions.organizationId, organizationId),
        like(missions.name, "[PROACTIVE]%")
      ))
      .orderBy(desc(missions.id))
      .limit(limit);
  },

  async getSampleNodeIds(organizationId: number, limit = 50): Promise<number[]> {
    const sampleNodes = await db.select({ id: knowledgeNodes.id })
      .from(knowledgeNodes)
      .where(eq(knowledgeNodes.organizationId, organizationId))
      .limit(limit);
    return sampleNodes.map(n => n.id);
  },

  async getEvolutionHistory(organizationId: number, limit = 20) {
    return db.select()
      .from(knowledgeEvolutionEvents)
      .where(eq(knowledgeEvolutionEvents.organizationId, organizationId))
      .orderBy(desc(knowledgeEvolutionEvents.createdAt))
      .limit(limit);
  },

  /**
   * Explicitly supercharge a node's utility score based on human feedback (Thumbs Up / Thumbs Down).
   * Positive feedback (+15 utility boost, reaffirmed at now), Negative feedback (-20 utility penalty).
   */
  async recordHumanFeedback(nodeId: number, isPositive: boolean): Promise<void> {
    logger.info(`Recording human feedback for node ${nodeId}: ${isPositive ? "positive" : "negative"}`);
    if (isPositive) {
      await db.execute(sql`
        UPDATE knowledge_nodes
        SET utility_score = LEAST(100, (COALESCE(utility_score::numeric, 50) + 15))::text,
            last_reaffirmed_at = NOW(),
            usage_count = COALESCE(usage_count, 0) + 1,
            updated_at = NOW()
        WHERE id = ${nodeId}
      `);
    } else {
      await db.execute(sql`
        UPDATE knowledge_nodes
        SET utility_score = GREATEST(0, (COALESCE(utility_score::numeric, 50) - 20))::text,
            updated_at = NOW()
        WHERE id = ${nodeId}
      `);
    }
  }
};


