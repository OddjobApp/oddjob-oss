/**
 * Cross-Domain Data Lineage Service
 * 
 * Traces data flow across jobs, knowledge topics, datasets, knowledge graph, and missions.
 * Provides unified lineage tracking showing how job outputs flow into knowledge graphs
 * and influence missions.
 * 
 * Expected Impact: Full visibility into data provenance, impact analysis for changes
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { jobs, knowledgeTopics, datasets, knowledgeNodes, knowledgeEdges, missions, pipelineExecutions } from "@shared/schema/index.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

const logger = createLogger("DataLineage");

export interface LineageNode {
  id: string;
  type: "job" | "knowledge_topic" | "dataset" | "knowledge_node" | "mission" | "pipeline_execution";
  name: string;
  data: any;
  timestamp: Date;
}

export interface LineageEdge {
  sourceId: string;
  targetId: string;
  relation: string;
  timestamp: Date;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface ImpactAnalysis {
  affectedMissions: Array<{ id: number; name: string; impact: "high" | "medium" | "low" }>;
  affectedJobs: Array<{ id: number; name: string; impact: "high" | "medium" | "low" }>;
  affectedKnowledgeNodes: Array<{ id: number; name: string; impact: "high" | "medium" | "low" }>;
}

export class DataLineageService {
  private lineageCache: Map<string, LineageGraph> = new Map();
  private cacheTTL = 300000; // 5 minutes

  /**
   * Trace lineage from a job to all downstream consumers
   */
  async traceJobLineage(jobId: number): Promise<LineageGraph> {
    const cacheKey = `job-${jobId}`;
    const cached = this.lineageCache.get(cacheKey);
    
    if (cached && Date.now() - (cached.nodes[0]?.timestamp.getTime() || 0) < this.cacheTTL) {
      return cached;
    }

    logger.info(`[DataLineage] Tracing lineage for job ${jobId}`);

    const nodes: LineageNode[] = [];
    const edges: LineageEdge[] = [];

    // Get job details
    const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (job.length === 0) {
      throw new Error(`Job ${jobId} not found`);
    }

    nodes.push({
      id: `job-${jobId}`,
      type: "job",
      name: job[0].name,
      data: job[0],
      timestamp: job[0].createdAt || new Date()
    });

    // Trace to knowledge topics
    if (job[0].outputKnowledgeTopicId) {
      const topic = await db.select().from(knowledgeTopics).where(eq(knowledgeTopics.id, job[0].outputKnowledgeTopicId!)).limit(1);
      if (topic.length > 0) {
        nodes.push({
          id: `topic-${topic[0].id}`,
          type: "knowledge_topic",
          name: topic[0].name,
          data: topic[0],
          timestamp: topic[0].createdAt || new Date()
        });

        edges.push({
          sourceId: `job-${jobId}`,
          targetId: `topic-${topic[0].id}`,
          relation: "outputs_to",
          timestamp: job[0].createdAt || new Date()
        });

        // Trace to knowledge nodes from this topic
        const topicNodes = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.knowledgeTopicId, topic[0].id));
        for (const node of topicNodes) {
          nodes.push({
            id: `node-${node.id}`,
            type: "knowledge_node",
            name: node.name,
            data: node,
            timestamp: node.createdAt || new Date()
          });

          edges.push({
            sourceId: `topic-${topic[0].id}`,
            targetId: `node-${node.id}`,
            relation: "contains",
            timestamp: node.createdAt || new Date()
          });
        }

        // Batch-fetch all missions referenced by these nodes (single query)
        const missionIds = [...new Set(topicNodes.map(n => n.missionId).filter((id): id is number => id != null))];
        if (missionIds.length > 0) {
          const relatedMissions = await db.select().from(missions).where(inArray(missions.id, missionIds));
          const missionMap = new Map(relatedMissions.map(m => [m.id, m]));

          for (const node of topicNodes) {
            if (!node.missionId) continue;
            const mission = missionMap.get(node.missionId);
            if (!mission) continue;

            if (!nodes.some(n => n.id === `mission-${mission.id}`)) {
              nodes.push({
                id: `mission-${mission.id}`,
                type: "mission",
                name: mission.name,
                data: mission,
                timestamp: mission.createdAt || new Date()
              });
            }

            edges.push({
              sourceId: `node-${node.id}`,
              targetId: `mission-${mission.id}`,
              relation: "influences",
              timestamp: mission.createdAt || new Date()
            });
          }
        }
      }
    }

    // Trace to datasets
    if (job[0].outputDatasetId) {
      const dataset = await db.select().from(datasets).where(eq(datasets.id, job[0].outputDatasetId!)).limit(1);
      if (dataset.length > 0) {
        nodes.push({
          id: `dataset-${dataset[0].id}`,
          type: "dataset",
          name: dataset[0].name,
          data: dataset[0],
          timestamp: dataset[0].createdAt || new Date()
        });

        edges.push({
          sourceId: `job-${jobId}`,
          targetId: `dataset-${dataset[0].id}`,
          relation: "outputs_to",
          timestamp: job[0].createdAt || new Date()
        });
      }
    }

    const graph: LineageGraph = { nodes, edges };
    this.lineageCache.set(cacheKey, graph);

    logger.info(`[DataLineage] Traced ${nodes.length} nodes and ${edges.length} edges for job ${jobId}`);
    return graph;
  }

  /**
   * Trace lineage from a knowledge node to upstream sources
   */
  async traceKnowledgeNodeLineage(nodeId: number): Promise<LineageGraph> {
    const cacheKey = `node-${nodeId}`;
    const cached = this.lineageCache.get(cacheKey);
    
    if (cached && Date.now() - (cached.nodes[0]?.timestamp.getTime() || 0) < this.cacheTTL) {
      return cached;
    }

    logger.info(`[DataLineage] Tracing lineage for knowledge node ${nodeId}`);

    const nodes: LineageNode[] = [];
    const edges: LineageEdge[] = [];

    // Get node details
    const node = await db.select().from(knowledgeNodes).where(eq(knowledgeNodes.id, nodeId)).limit(1);
    if (node.length === 0) {
      throw new Error(`Knowledge node ${nodeId} not found`);
    }

    nodes.push({
      id: `node-${nodeId}`,
      type: "knowledge_node",
      name: node[0].name,
      data: node[0],
      timestamp: node[0].createdAt || new Date()
    });

    // Trace to knowledge topic
    if (node[0].knowledgeTopicId) {
      const topic = await db.select().from(knowledgeTopics).where(eq(knowledgeTopics.id, node[0].knowledgeTopicId)).limit(1);
      if (topic.length > 0) {
        nodes.push({
          id: `topic-${topic[0].id}`,
          type: "knowledge_topic",
          name: topic[0].name,
          data: topic[0],
          timestamp: topic[0].createdAt || new Date()
        });

        edges.push({
          sourceId: `node-${nodeId}`,
          targetId: `topic-${topic[0].id}`,
          relation: "belongs_to",
          timestamp: node[0].createdAt || new Date()
        });

        // Trace to jobs that output to this topic
        const jobsOutputting = await db.select().from(jobs).where(eq(jobs.outputKnowledgeTopicId, topic[0].id));
        for (const job of jobsOutputting) {
          nodes.push({
            id: `job-${job.id}`,
            type: "job",
            name: job.name,
            data: job,
            timestamp: job.createdAt || new Date()
          });

          edges.push({
            sourceId: `job-${job.id}`,
            targetId: `topic-${topic[0].id}`,
            relation: "outputs_to",
            timestamp: job.createdAt || new Date()
          });
        }
      }
    }

    // Trace to pipeline execution
    if (node[0].pipelineExecutionId) {
      const execution = await db.select().from(pipelineExecutions).where(eq(pipelineExecutions.id, node[0].pipelineExecutionId!)).limit(1);
      if (execution.length > 0) {
        nodes.push({
          id: `execution-${execution[0].id}`,
          type: "pipeline_execution",
          name: `Execution ${execution[0].id}`,
          data: execution[0],
          timestamp: execution[0].startedAt || new Date()
        });

        edges.push({
          sourceId: `execution-${execution[0].id}`,
          targetId: `node-${nodeId}`,
          relation: "extracted",
          timestamp: execution[0].startedAt || new Date()
        });
      }
    }

    // Trace to mission
    if (node[0].missionId) {
      const mission = await db.select().from(missions).where(eq(missions.id, node[0].missionId)).limit(1);
      if (mission.length > 0) {
        nodes.push({
          id: `mission-${mission[0].id}`,
          type: "mission",
          name: mission[0].name,
          data: mission[0],
          timestamp: mission[0].createdAt || new Date()
        });

        edges.push({
          sourceId: `node-${nodeId}`,
          targetId: `mission-${mission[0].id}`,
          relation: "influences",
          timestamp: mission[0].createdAt || new Date()
        });
      }
    }

    const graph: LineageGraph = { nodes, edges };
    this.lineageCache.set(cacheKey, graph);

    logger.info(`[DataLineage] Traced ${nodes.length} nodes and ${edges.length} edges for node ${nodeId}`);
    return graph;
  }

  /**
   * Analyze impact of changing a job
   */
  async analyzeJobChangeImpact(jobId: number): Promise<ImpactAnalysis> {
    logger.info(`[DataLineage] Analyzing impact of job ${jobId} changes`);

    const lineage = await this.traceJobLineage(jobId);
    
    const affectedMissions: Array<{ id: number; name: string; impact: "high" | "medium" | "low" }> = [];
    const affectedJobs: Array<{ id: number; name: string; impact: "high" | "medium" | "low" }> = [];
    const affectedKnowledgeNodes: Array<{ id: number; name: string; impact: "high" | "medium" | "low" }> = [];

    // Analyze missions
    for (const node of lineage.nodes) {
      if (node.type === "mission") {
        const missionData = node.data;
        const impact = this.calculateImpact(missionData.status, missionData.currentSpendUsd);
        affectedMissions.push({
          id: missionData.id,
          name: missionData.name,
          impact
        });
      }
    }

    // Analyze knowledge nodes
    for (const node of lineage.nodes) {
      if (node.type === "knowledge_node") {
        const nodeData = node.data;
        const impact = this.calculateNodeImpact(nodeData.usageCount, nodeData.verificationStatus);
        affectedKnowledgeNodes.push({
          id: nodeData.id,
          name: nodeData.name,
          impact
        });
      }
    }

    // Find dependent jobs (jobs that use the same knowledge topic)
    const job = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (job.length > 0 && job[0].outputKnowledgeTopicId) {
      const dependentJobs = await db.select().from(jobs).where(
        and(
          eq(jobs.outputKnowledgeTopicId, job[0].outputKnowledgeTopicId!),
          sql`${jobs.id} != ${jobId}`
        )
      );

      for (const depJob of dependentJobs) {
        affectedJobs.push({
          id: depJob.id,
          name: depJob.name,
          impact: "medium"
        });
      }
    }

    return {
      affectedMissions,
      affectedJobs,
      affectedKnowledgeNodes
    };
  }

  /**
   * Get lineage statistics
   */
  async getLineageStats(organizationId: number): Promise<{
    totalJobs: number;
    jobsWithKnowledgeOutput: number;
    jobsWithDatasetOutput: number;
    totalKnowledgeNodes: number;
    nodesWithMissionLink: number;
    totalMissions: number;
    missionsWithKnowledge: number;
  }> {
    const [allJobs, jobsWithKnowledge, jobsWithDataset, allNodes, nodesWithMission, allMissions, missionsWithKnowledge] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(jobs).where(eq(jobs.organizationId, organizationId)),
      db.select({ count: sql<number>`count(*)` }).from(jobs).where(
        and(eq(jobs.organizationId, organizationId), sql`${jobs.outputKnowledgeTopicId} IS NOT NULL`)
      ),
      db.select({ count: sql<number>`count(*)` }).from(jobs).where(
        and(eq(jobs.organizationId, organizationId), sql`${jobs.outputDatasetId} IS NOT NULL`)
      ),
      db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes).where(eq(knowledgeNodes.organizationId, organizationId)),
      db.select({ count: sql<number>`count(*)` }).from(knowledgeNodes).where(
        and(eq(knowledgeNodes.organizationId, organizationId), sql`${knowledgeNodes.missionId} IS NOT NULL`)
      ),
      db.select({ count: sql<number>`count(*)` }).from(missions).where(eq(missions.organizationId, organizationId)),
      db.select({ count: sql<number>`count(*)` }).from(missions).where(
        and(eq(missions.organizationId, organizationId), sql`${missions.contextCoreUrl} IS NOT NULL`)
      )
    ]);

    return {
      totalJobs: allJobs[0]?.count || 0,
      jobsWithKnowledgeOutput: jobsWithKnowledge[0]?.count || 0,
      jobsWithDatasetOutput: jobsWithDataset[0]?.count || 0,
      totalKnowledgeNodes: allNodes[0]?.count || 0,
      nodesWithMissionLink: nodesWithMission[0]?.count || 0,
      totalMissions: allMissions[0]?.count || 0,
      missionsWithKnowledge: missionsWithKnowledge[0]?.count || 0
    };
  }

  /**
   * Calculate impact level based on status and spend
   */
  private calculateImpact(status: string, spendUsd: any): "high" | "medium" | "low" {
    const spend = parseFloat(spendUsd?.toString() || "0");
    
    if (status === "active" && spend > 10) return "high";
    if (status === "active") return "medium";
    return "low";
  }

  /**
   * Calculate node impact based on usage and verification
   */
  private calculateNodeImpact(usageCount: number, verificationStatus: string): "high" | "medium" | "low" {
    if (usageCount > 10 && verificationStatus === "verified") return "high";
    if (usageCount > 5) return "medium";
    return "low";
  }

  /**
   * Clear lineage cache
   */
  clearCache(): void {
    this.lineageCache.clear();
    logger.info("[DataLineage] Cache cleared");
  }
}

// Singleton instance
export const dataLineageService = new DataLineageService();
