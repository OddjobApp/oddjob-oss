/**
 * Knowledge Verification Workflow Service
 * 
 * Implements approval workflows for knowledge verification, tracks verification history
 * and confidence evolution, provides verification analytics, and auto-escalates low-confidence nodes.
 * 
 * Expected Impact: Structured verification workflow, improved knowledge quality
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEvolutionEvents } from "@shared/schema/index.js";
import { eq, and, desc, sql, gte, lte } from "drizzle-orm";

const logger = createLogger("KnowledgeVerification");

export interface VerificationRequest {
  nodeId: number;
  nodeName: string;
  currentStatus: "staging" | "verified" | "rejected";
  confidenceScore: number;
  requestedBy: string;
  reason: string;
}

export interface VerificationAction {
  nodeId: number;
  action: "approve" | "reject" | "correct";
  verifiedBy: string;
  corrections?: {
    label?: string;
    name?: string;
    data?: any;
  };
  reason: string;
}

export interface VerificationHistory {
  nodeId: number;
  nodeName: string;
  history: Array<{
    status: string;
    confidenceScore: number;
    verifiedBy: string;
    verifiedAt: Date;
    reason: string;
  }>;
}

export interface VerificationAnalytics {
  totalNodes: number;
  stagingNodes: number;
  verifiedNodes: number;
  rejectedNodes: number;
  averageConfidence: number;
  verificationRate: number;
  autoEscalatedCount: number;
}

export class KnowledgeVerificationService {
  private verificationCache: Map<number, VerificationHistory> = new Map();
  private cacheTTL = 300000; // 5 minutes

  /**
   * Submit a node for verification
   */
  async submitForVerification(nodeId: number, requestedBy: string, reason: string): Promise<VerificationRequest> {
    logger.info(`[KnowledgeVerification] Submitting node ${nodeId} for verification`);

    const node = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId)).limit(1);
    if (node.length === 0) {
      throw new Error(`Knowledge node ${nodeId} not found`);
    }

    // Update node status to staging if not already
    if (node[0].verificationStatus !== "staging") {
      await db.update(knowledgeNodes)
        .set({ 
          verificationStatus: "staging",
          updatedAt: new Date()
        })
        .where(eq(knowledgeNodes.id, nodeId));
    }

    const request: VerificationRequest = {
      nodeId,
      nodeName: node[0].name,
      currentStatus: node[0].verificationStatus as any,
      confidenceScore: parseFloat(node[0].confidenceScore?.toString() || "0"),
      requestedBy,
      reason
    };

    return request;
  }

  /**
   * Approve a knowledge node
   */
  async approveNode(nodeId: number, verifiedBy: string, reason: string): Promise<void> {
    logger.info(`[KnowledgeVerification] Approving node ${nodeId}`);

    await db.update(knowledgeNodes)
      .set({
        verificationStatus: "verified",
        verifiedBy,
        verifiedAt: new Date(),
        lastReaffirmedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(knowledgeNodes.id, nodeId));

    // Record evolution event
    await this.recordEvolutionEvent(nodeId, "VERIFICATION", "SUCCESS", {
      action: "approve",
      verifiedBy,
      reason
    });

    // Clear cache
    this.verificationCache.delete(nodeId);
  }

  /**
   * Reject a knowledge node
   */
  async rejectNode(nodeId: number, verifiedBy: string, reason: string): Promise<void> {
    logger.info(`[KnowledgeVerification] Rejecting node ${nodeId}`);

    await db.update(knowledgeNodes)
      .set({
        verificationStatus: "rejected",
        verifiedBy,
        verifiedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(knowledgeNodes.id, nodeId));

    // Record evolution event
    await this.recordEvolutionEvent(nodeId, "VERIFICATION", "SUCCESS", {
      action: "reject",
      verifiedBy,
      reason
    });

    // Clear cache
    this.verificationCache.delete(nodeId);
  }

  /**
   * Correct a knowledge node
   */
  async correctNode(
    nodeId: number,
    verifiedBy: string,
    corrections: {
      label?: string;
      name?: string;
      data?: any;
    },
    reason: string
  ): Promise<void> {
    logger.info(`[KnowledgeVerification] Correcting node ${nodeId}`);

    const updateData: any = {
      verifiedBy,
      verifiedAt: new Date(),
      updatedAt: new Date()
    };

    if (corrections.label) updateData.label = corrections.label;
    if (corrections.name) updateData.name = corrections.name;
    if (corrections.data) updateData.data = corrections.data;

    await db.update(knowledgeNodes)
      .set(updateData)
      .where(eq(knowledgeNodes.id, nodeId));

    // Record evolution event
    await this.recordEvolutionEvent(nodeId, "VERIFICATION", "SUCCESS", {
      action: "correct",
      verifiedBy,
      corrections,
      reason
    });

    // Clear cache
    this.verificationCache.delete(nodeId);
  }

  /**
   * Get verification history for a node
   */
  async getVerificationHistory(nodeId: number): Promise<VerificationHistory> {
    const cached = this.verificationCache.get(nodeId);
    if (cached && Date.now() - (cached.history[0]?.verifiedAt.getTime() || 0) < this.cacheTTL) {
      return cached;
    }

    const node = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId)).limit(1);
    if (node.length === 0) {
      throw new Error(`Knowledge node ${nodeId} not found`);
    }

    // Get evolution events for this node
    const events = await db.select().from(knowledgeEvolutionEvents)
      .where(eq(knowledgeEvolutionEvents.organizationId, node[0].organizationId || 0))
      .orderBy(desc(knowledgeEvolutionEvents.createdAt))
      .limit(50);

    // Filter events related to this node (simplified - in production would have proper filtering)
    const nodeEvents = events.filter(e => 
      e.details && typeof e.details === 'object' && 'nodeId' in e.details
    );

    const history: VerificationHistory = {
      nodeId,
      nodeName: node[0].name,
      history: nodeEvents.map(e => ({
        status: node[0].verificationStatus,
        confidenceScore: parseFloat(node[0].confidenceScore?.toString() || "0"),
        verifiedBy: (e.details as any)?.verifiedBy || "system",
        verifiedAt: e.createdAt,
        reason: (e.details as any)?.reason || "System verification"
      }))
    };

    this.verificationCache.set(nodeId, history);
    return history;
  }

  /**
   * Auto-escalate low-confidence nodes
   */
  async autoEscalateLowConfidenceNodes(organizationId: number, threshold: number = 0.5): Promise<number> {
    logger.info(`[KnowledgeVerification] Auto-escalating low-confidence nodes for org ${organizationId}`);

    const lowConfidenceNodes = await db.select().from(knowledgeNodes).where(
      and(
        eq(knowledgeNodes.organizationId, organizationId),
        eq(knowledgeNodes.verificationStatus, "staging"),
        lte(knowledgeNodes.confidenceScore, String(threshold))
      )
    );

    let escalatedCount = 0;

    for (const node of lowConfidenceNodes) {
      // Record escalation event
      await this.recordEvolutionEvent(node.id, "VERIFICATION", "SUCCESS", {
        action: "auto_escalate",
        reason: `Confidence score ${Number(node.confidenceScore || 0).toFixed(2)} below threshold ${threshold}`,
        threshold
      });

      // Route to the Question Engine so developers are actively notified
      // and can verify, correct, or discard the low-confidence node.
      try {
        const { knowledgeBaseQuestionEngineService } = await import(
          "@domain/agents/core/knowledge-base-question-engine.service.js"
        );
        await knowledgeBaseQuestionEngineService.createQuestion(
          organizationId,
          `knowledge-graph:org-${organizationId}`,
          "low_confidence_compaction",
          {
            nodeId: node.id,
            nodeName: node.name,
            nodeLabel: node.label,
            currentConfidence: Number(node.confidenceScore || 0),
            threshold,
            errorCategory: "knowledge_node_low_confidence",
          }
        );
      } catch (qeErr: any) {
        logger.warn(`[KnowledgeVerification] Question engine escalation failed for node ${node.id}: ${qeErr.message}`);
      }

      escalatedCount++;
    }

    logger.info(`[KnowledgeVerification] Escalated ${escalatedCount} nodes`);
    return escalatedCount;
  }


  /**
   * Get verification analytics
   */
  async getVerificationAnalytics(organizationId: number): Promise<VerificationAnalytics> {
    const [totalNodes, stagingNodes, verifiedNodes, rejectedNodes] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes).where(eq(knowledgeNodes.organizationId, organizationId)),
      db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes).where(
        and(eq(knowledgeNodes.organizationId, organizationId), eq(knowledgeNodes.verificationStatus, "staging"))
      ),
      db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes).where(
        and(eq(knowledgeNodes.organizationId, organizationId), eq(knowledgeNodes.verificationStatus, "verified"))
      ),
      db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes).where(
        and(eq(knowledgeNodes.organizationId, organizationId), eq(knowledgeNodes.verificationStatus, "rejected"))
      )
    ]);

    // Calculate average confidence
    const allNodes = await db.select({ confidenceScore: knowledgeNodes.confidenceScore }).from(knowledgeNodes).where(
      eq(knowledgeNodes.organizationId, organizationId)
    );

    const averageConfidence = allNodes.length > 0
      ? allNodes.reduce((sum, n) => sum + parseFloat(n.confidenceScore?.toString() || "0"), 0) / allNodes.length
      : 0;

    const verificationRate = totalNodes[0].count > 0
      ? (verifiedNodes[0].count / totalNodes[0].count) * 100
      : 0;

    // Count auto-escalated nodes (from evolution events)
    const escalationEvents = await db.select().from(knowledgeEvolutionEvents).where(
      and(
        eq(knowledgeEvolutionEvents.organizationId, organizationId),
        eq(knowledgeEvolutionEvents.type, "VERIFICATION")
      )
    );

    const autoEscalatedCount = escalationEvents.filter(e => 
      e.details && typeof e.details === 'object' && 'action' in e.details && e.details.action === 'auto_escalate'
    ).length;

    return {
      totalNodes: totalNodes[0].count,
      stagingNodes: stagingNodes[0].count,
      verifiedNodes: verifiedNodes[0].count,
      rejectedNodes: rejectedNodes[0].count,
      averageConfidence,
      verificationRate,
      autoEscalatedCount
    };
  }

  /**
   * Record an evolution event
   */
  private async recordEvolutionEvent(nodeId: number, type: string, status: string, details: any): Promise<void> {
    const node = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId)).limit(1);
    if (node.length === 0) return;

    await db.insert(knowledgeEvolutionEvents).values({
      type,
      status,
      details: { nodeId, ...details },
      organizationId: node[0].organizationId,
      createdAt: new Date()
    });
  }

  /**
   * Clear verification cache
   */
  clearCache(): void {
    this.verificationCache.clear();
    logger.info("[KnowledgeVerification] Cache cleared");
  }
}

// Singleton instance
export const knowledgeVerificationService = new KnowledgeVerificationService();
