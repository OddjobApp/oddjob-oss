/**
 * Knowledge Graph Impact Analysis Service
 * 
 * Traces knowledge dependencies through the graph, shows which apps/deployments depend on specific knowledge,
 * identifies critical knowledge nodes (high centrality), and provides knowledge change impact predictions.
 * 
 * Expected Impact: Impact analysis for knowledge changes, critical node identification
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { knowledgeNodes, knowledgeEdges, apps, appDeployments, missions } from "@shared/schema/index.js";
import { eq, and, desc, sql, gte, lte, or } from "drizzle-orm";

const logger = createLogger("KnowledgeImpact");

export interface KnowledgeDependency {
  nodeId: number;
  nodeName: string;
  dependentType: "app" | "deployment" | "mission" | "node";
  dependentId: number;
  dependentName: string;
  relation: string;
  impactLevel: "critical" | "high" | "medium" | "low";
}

export interface CriticalNode {
  nodeId: number;
  nodeName: string;
  centralityScore: number;
  inDegree: number;
  outDegree: number;
  usageCount: number;
  verificationStatus: string;
  riskLevel: "critical" | "high" | "medium" | "low";
}

export interface ImpactPrediction {
  nodeId: number;
  nodeName: string;
  changeType: "update" | "delete" | "deprecate";
  affectedApps: number;
  affectedDeployments: number;
  affectedMissions: number;
  affectedNodes: number;
  overallImpact: "critical" | "high" | "medium" | "low";
  recommendedActions: string[];
}

export class KnowledgeImpactService {
  private dependencyCache: Map<number, KnowledgeDependency[]> = new Map();
  private criticalNodeCache: Map<number, CriticalNode> = new Map();
  private cacheTTL = 600000; // 10 minutes

  /**
   * Trace knowledge dependencies for a node
   */
  async traceDependencies(nodeId: number): Promise<KnowledgeDependency[]> {
    const cached = this.dependencyCache.get(nodeId);
    if (cached) return cached;

    logger.info(`[KnowledgeImpact] Tracing dependencies for node ${nodeId}`);

    const dependencies: KnowledgeDependency[] = [];

    // Get outgoing edges (nodes this node affects)
    const outgoingEdges = await db.select().from(knowledgeEdges).where(eq(knowledgeEdges.sourceId, nodeId));

    for (const edge of outgoingEdges) {
      const targetNode = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, edge.targetId)).limit(1);
      if (targetNode.length > 0) {
        dependencies.push({
          nodeId,
          nodeName: "Source node",
          dependentType: "node",
          dependentId: edge.targetId,
          dependentName: targetNode[0].name,
          relation: edge.relation,
          impactLevel: this.calculateImpactLevel(edge.weight || 0, targetNode[0].usageCount || 0)
        });
      }
    }

    // Check for app dependencies
    const node = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId)).limit(1);
    if (node.length > 0) {
      if (node[0].appId) {
        const app = await db.select().from(apps).where(eq(apps.id, node[0].appId!)).limit(1);
        if (app.length > 0) {
          dependencies.push({
            nodeId,
            nodeName: node[0].name,
            dependentType: "app",
            dependentId: app[0].id,
            dependentName: app[0].name,
            relation: "used_by",
            impactLevel: "high"
          });
        }
      }

      if (node[0].deploymentId) {
        const deployment = await db.select().from(appDeployments).where(eq(appDeployments.id, node[0].deploymentId!)).limit(1);
        if (deployment.length > 0) {
          dependencies.push({
            nodeId,
            nodeName: node[0].name,
            dependentType: "deployment",
            dependentId: deployment[0].id,
            dependentName: `Deployment ${deployment[0].id}`,
            relation: "used_by",
            impactLevel: "high"
          });
        }
      }

      if (node[0].missionId) {
        const mission = await db.select().from(missions).where(eq(missions.id, node[0].missionId!)).limit(1);
        if (mission.length > 0) {
          dependencies.push({
            nodeId,
            nodeName: node[0].name,
            dependentType: "mission",
            dependentId: mission[0].id,
            dependentName: mission[0].name,
            relation: "influences",
            impactLevel: mission[0].status === "active" ? "critical" : "medium"
          });
        }
      }
    }

    this.dependencyCache.set(nodeId, dependencies);
    return dependencies;
  }

  /**
   * Identify critical knowledge nodes by centrality
   */
  async identifyCriticalNodes(organizationId: number): Promise<CriticalNode[]> {
    logger.info(`[KnowledgeImpact] Identifying critical nodes for org ${organizationId}`);

    const criticalNodes: CriticalNode[] = [];

    // Get all nodes for the organization
    const nodes = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.organizationId, organizationId));

    for (const node of nodes) {
      // Calculate in-degree and out-degree
      const [inEdges, outEdges] = await Promise.all([
        db.select().from(knowledgeEdges).where(eq(knowledgeEdges.targetId, node.id)),
        db.select().from(knowledgeEdges).where(eq(knowledgeEdges.sourceId, node.id))
      ]);

      const inDegree = inEdges.length;
      const outDegree = outEdges.length;
      const totalDegree = inDegree + outDegree;

      // Calculate centrality score (simplified PageRank-like)
      const centralityScore = totalDegree > 0 ? (inDegree * 0.6 + outDegree * 0.4) / totalDegree : 0;

      // Calculate risk level
      const usageCount = node.usageCount || 0;
      let riskLevel: "critical" | "high" | "medium" | "low" = "low";

      if (centralityScore > 0.7 && usageCount > 10) riskLevel = "critical";
      else if (centralityScore > 0.5 && usageCount > 5) riskLevel = "high";
      else if (centralityScore > 0.3) riskLevel = "medium";

      criticalNodes.push({
        nodeId: node.id,
        nodeName: node.name,
        centralityScore,
        inDegree,
        outDegree,
        usageCount,
        verificationStatus: node.verificationStatus as string,
        riskLevel
      });
    }

    // Sort by risk level and centrality
    criticalNodes.sort((a, b) => {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) {
        return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      }
      return b.centralityScore - a.centralityScore;
    });

    return criticalNodes;
  }

  /**
   * Predict impact of a knowledge change
   */
  async predictImpact(nodeId: number, changeType: "update" | "delete" | "deprecate"): Promise<ImpactPrediction> {
    logger.info(`[KnowledgeImpact] Predicting impact for node ${nodeId} (${changeType})`);

    const dependencies = await this.traceDependencies(nodeId);
    const node = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId)).limit(1);

    const affectedApps = dependencies.filter(d => d.dependentType === "app").length;
    const affectedDeployments = dependencies.filter(d => d.dependentType === "deployment").length;
    const affectedMissions = dependencies.filter(d => d.dependentType === "mission").length;
    const affectedNodes = dependencies.filter(d => d.dependentType === "node").length;

    // Calculate overall impact
    let overallImpact: "critical" | "high" | "medium" | "low" = "low";
    const criticalDependencies = dependencies.filter(d => d.impactLevel === "critical").length;

    if (criticalDependencies > 0 || changeType === "delete") {
      overallImpact = "critical";
    } else if (affectedMissions > 0) {
      overallImpact = "high";
    } else if (affectedApps > 0 || affectedDeployments > 0) {
      overallImpact = "medium";
    }

    // Generate recommended actions
    const recommendedActions: string[] = [];

    if (changeType === "delete") {
      recommendedActions.push("Create backup before deletion");
      recommendedActions.push("Notify all dependent systems");
      recommendedActions.push("Consider deprecation instead of deletion");
    } else if (changeType === "update") {
      recommendedActions.push("Test with dependent systems");
      recommendedActions.push("Rollback plan required");
      if (overallImpact === "critical") {
        recommendedActions.push("Schedule maintenance window");
      }
    } else if (changeType === "deprecate") {
      recommendedActions.push("Set deprecation timeline");
      recommendedActions.push("Notify consumers");
      recommendedActions.push("Provide migration guide");
    }

    return {
      nodeId,
      nodeName: node[0]?.name || "Unknown",
      changeType,
      affectedApps,
      affectedDeployments,
      affectedMissions,
      affectedNodes,
      overallImpact,
      recommendedActions
    };
  }

  /**
   * Get impact analysis statistics
   */
  async getImpactStats(organizationId: number): Promise<{
    totalNodes: number;
    criticalNodes: number;
    highRiskNodes: number;
    averageCentrality: number;
    totalDependencies: number;
    nodesWithAppDependencies: number;
    nodesWithMissionDependencies: number;
  }> {
    const criticalNodes = await this.identifyCriticalNodes(organizationId);

    const totalNodes = criticalNodes.length;
    const criticalNodeCount = criticalNodes.filter(n => n.riskLevel === "critical").length;
    const highRiskNodeCount = criticalNodes.filter(n => n.riskLevel === "high").length;

    const averageCentrality = totalNodes > 0
      ? criticalNodes.reduce((sum, n) => sum + n.centralityScore, 0) / totalNodes
      : 0;

    // Count total dependencies (simplified)
    const totalDependencies = criticalNodes.reduce((sum, n) => sum + n.inDegree + n.outDegree, 0);

    // Count nodes with app/mission dependencies
    const nodesWithAppDependencies = await db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes).where(
      and(
        eq(knowledgeNodes.organizationId, organizationId),
        sql`${knowledgeNodes.appId} IS NOT NULL`
      )
    );

    const nodesWithMissionDependencies = await db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes).where(
      and(
        eq(knowledgeNodes.organizationId, organizationId),
        sql`${knowledgeNodes.missionId} IS NOT NULL`
      )
    );

    return {
      totalNodes,
      criticalNodes: criticalNodeCount,
      highRiskNodes: highRiskNodeCount,
      averageCentrality,
      totalDependencies,
      nodesWithAppDependencies: nodesWithAppDependencies[0].count,
      nodesWithMissionDependencies: nodesWithMissionDependencies[0].count
    };
  }

  /**
   * Calculate impact level based on edge weight and usage
   */
  private calculateImpactLevel(weight: number, usageCount: number): "critical" | "high" | "medium" | "low" {
    if (weight >= 8 && usageCount > 10) return "critical";
    if (weight >= 5 && usageCount > 5) return "high";
    if (weight >= 3) return "medium";
    return "low";
  }

  /**
   * Clear caches
   */
  clearCaches(): void {
    this.dependencyCache.clear();
    this.criticalNodeCache.clear();
    logger.info("[KnowledgeImpact] Caches cleared");
  }
}

// Singleton instance
export const knowledgeImpactService = new KnowledgeImpactService();
