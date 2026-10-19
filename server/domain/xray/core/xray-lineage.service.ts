/**
 * Xray Lineage Service
 *
 * Enterprise-grade data lineage tracking across pipelines, jobs, and datasets.
 * Provides impact analysis, dependency mapping, and data flow visualization.
 *
 * Features:
 * - Full dataset lineage graph construction (multi-hop)
 * - Impact analysis: "If Dataset A changes, what is affected?"
 * - Cross-pipeline lineage tracking
 * - Lineage visualization data for UI
 * - Downstream/upstream dependency queries
 * - Data quality propagation tracking
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { eq, and, or, inArray, sql, desc, asc } from "drizzle-orm";
import { datasets } from "@shared/schema/datasets.js";
import { jobs, jobDependencies } from "@shared/schema/jobs/index.js";
import { pipelines, pipelineSteps, pipelineExecutions } from "@shared/schema/pipelines/index.js";
import { missions } from "@shared/schema/missions/core.js";
import { knowledgeNodes, knowledgeEdges } from "@shared/schema/knowledge/graph.js";

const logger = createLogger("XrayLineage");

export interface LineageNode {
  id: string;
  type: "dataset" | "job" | "pipeline" | "mission" | "knowledge" | "unknown";
  dbId: number;
  name: string;
  description?: string;
  metadata: Record<string, any>;
  depth: number; // Distance from root
}

export interface LineageEdge {
  source: string;
  target: string;
  relation: "WRITES_TO" | "READS_FROM" | "TRIGGERS" | "EXTRACTS_TO" | "DERIVES_FROM";
  metadata?: Record<string, any>;
}

export interface LineageGraph {
  rootNode: LineageNode;
  nodes: LineageNode[];
  edges: LineageEdge[];
  maxDepth: number;
  totalPaths: number;
}

export interface ImpactAnalysis {
  sourceDatasetId: number;
  directlyAffected: AffectedEntity[];
  indirectlyAffected: AffectedEntity[];
  totalImpactScore: number;
  blastRadius: "minimal" | "moderate" | "significant" | "critical";
  recommendedActions: string[];
}

export interface AffectedEntity {
  id: number;
  type: "dataset" | "job" | "pipeline" | "mission" | "app" | "knowledge" | "unknown";
  name: string;
  path: string[]; // Path from source to this entity
  depth: number;
  impactType: "direct" | "indirect" | "derived";
  confidence: number;
}

export interface DataFlowPath {
  path: LineageNode[];
  edges: LineageEdge[];
  pathLength: number;
  freshness: Date | null;
  quality: number; // 0-100 data quality score
}

export const xrayLineageService = {
  /**
   * Build complete lineage graph for a dataset (upstream + downstream)
   */
  async buildLineageGraph(
    datasetId: number,
    options: {
      maxDepth?: number;
      direction?: "both" | "upstream" | "downstream";
      includeMissions?: boolean;
    } = {}
  ): Promise<LineageGraph> {
    const { maxDepth = 5, direction = "both", includeMissions = true } = options;
    
    logger.info(`[XrayLineage] Building lineage graph for dataset ${datasetId} (depth: ${maxDepth})`);

    // Get dataset details
    const [dataset] = await db
      .select({
        id: datasets.id,
        name: datasets.name,
        description: datasets.description,
        organizationId: datasets.organizationId,
      })
      .from(datasets)
      .where(eq(datasets.id, datasetId))
      .limit(1);

    if (!dataset) {
      throw new Error(`Dataset ${datasetId} not found`);
    }

    const rootNode: LineageNode = {
      id: `dataset::${datasetId}`,
      type: "dataset",
      dbId: datasetId,
      name: dataset.name,
      description: dataset.description || undefined,
      metadata: { organizationId: dataset.organizationId },
      depth: 0,
    };

    const nodes = new Map<string, LineageNode>();
    const edges: LineageEdge[] = [];
    
    nodes.set(rootNode.id, rootNode);

    // Build downstream lineage (dataset → jobs → datasets → ...)
    if (direction === "both" || direction === "downstream") {
      await this.buildDownstreamLineage(rootNode, nodes, edges, maxDepth, includeMissions);
    }

    // Build upstream lineage (dataset ← jobs ← datasets ← ...)
    if (direction === "both" || direction === "upstream") {
      await this.buildUpstreamLineage(rootNode, nodes, edges, maxDepth);
    }

    // Calculate graph statistics
    const maxDepthFound = Math.max(...Array.from(nodes.values()).map((n) => n.depth));
    const totalPaths = this.countPaths(rootNode.id, edges, nodes);

    return {
      rootNode,
      nodes: Array.from(nodes.values()),
      edges,
      maxDepth: maxDepthFound,
      totalPaths,
    };
  },

  /**
   * Build downstream lineage (what this dataset feeds into)
   */
  async buildDownstreamLineage(
    rootNode: LineageNode,
    nodes: Map<string, LineageNode>,
    edges: LineageEdge[],
    maxDepth: number,
    includeMissions: boolean,
    currentDepth: number = 0
  ): Promise<void> {
    if (currentDepth >= maxDepth) return;

    const datasetId = rootNode.dbId;

    // Find jobs that read from this dataset
    const consumingJobs = await db
      .select({
        id: jobs.id,
        name: jobs.name,
        type: jobs.type,
        outputDatasetId: jobs.outputDatasetId,
        outputKnowledgeTopicId: jobs.outputKnowledgeTopicId,
        organizationId: jobs.organizationId,
      })
      .from(jobs)
      .where(
        and(
          sql`${jobs.config}->>'datasetId' = ${datasetId}::text OR ${jobs.config}->'datasetIds' @> ${`[${datasetId}]`}::jsonb`,
          eq(jobs.isHidden, false)
        )
      );

    for (const job of consumingJobs) {
      const jobNodeId = `job::${job.id}`;
      
      if (!nodes.has(jobNodeId)) {
        const jobNode: LineageNode = {
          id: jobNodeId,
          type: "job",
          dbId: job.id,
          name: job.name,
          description: `Job type: ${job.type}`,
          metadata: { jobType: job.type, organizationId: job.organizationId },
          depth: currentDepth + 1,
        };
        nodes.set(jobNodeId, jobNode);

        edges.push({
          source: rootNode.id,
          target: jobNodeId,
          relation: "READS_FROM",
          metadata: { datasetId },
        });

        // Recurse: job → output datasets
        if (job.outputDatasetId && job.outputDatasetId !== datasetId) {
          await this.addDatasetFromJob(
            job,
            jobNode,
            nodes,
            edges,
            maxDepth,
            includeMissions,
            currentDepth + 1
          );
        }

        // Job → knowledge graph
        if (job.outputKnowledgeTopicId) {
          await this.addKnowledgeFromJob(job, jobNode, nodes, edges, currentDepth + 1);
        }
      }
    }

    // Find pipelines that include this dataset in steps
    const pipelineSteps_withDataset = await db
      .select({
        pipelineId: pipelineSteps.pipelineId,
        stepId: pipelineSteps.id,
      })
      .from(pipelineSteps)
      .innerJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
      .where(
        sql`${jobs.config}->>'datasetId' = ${datasetId}::text OR ${jobs.config}->'datasetIds' @> ${`[${datasetId}]`}::jsonb`
      );

    const pipelineIds = [...new Set(pipelineSteps_withDataset.map((s) => s.pipelineId))];

    for (const pipelineId of pipelineIds) {
      const [pipeline] = await db
        .select({
          id: pipelines.id,
          name: pipelines.name,
          description: pipelines.description,
          organizationId: pipelines.organizationId,
        })
        .from(pipelines)
        .where(eq(pipelines.id, pipelineId))
        .limit(1);

      if (pipeline) {
        const pipelineNodeId = `pipeline::${pipeline.id}`;
        
        if (!nodes.has(pipelineNodeId)) {
          const pipelineNode: LineageNode = {
            id: pipelineNodeId,
            type: "pipeline",
            dbId: pipeline.id,
            name: pipeline.name,
            description: pipeline.description || undefined,
            metadata: { organizationId: pipeline.organizationId },
            depth: currentDepth + 1,
          };
          nodes.set(pipelineNodeId, pipelineNode);

          edges.push({
            source: rootNode.id,
            target: pipelineNodeId,
            relation: "READS_FROM",
            metadata: { via: "pipeline step" },
          });

          // Include missions that use this pipeline
          if (includeMissions) {
            await this.addMissionsFromPipeline(pipeline, pipelineNode, nodes, edges, currentDepth + 2);
          }
        }
      }
    }
  },

  /**
   * Build upstream lineage (what feeds into this dataset)
   */
  async buildUpstreamLineage(
    rootNode: LineageNode,
    nodes: Map<string, LineageNode>,
    edges: LineageEdge[],
    maxDepth: number,
    currentDepth: number = 0
  ): Promise<void> {
    if (currentDepth >= maxDepth) return;

    const datasetId = rootNode.dbId;

    // Find jobs that write to this dataset
    const producingJobs = await db
      .select({
        id: jobs.id,
        name: jobs.name,
        type: jobs.type,
        config: jobs.config,
        organizationId: jobs.organizationId,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.outputDatasetId, datasetId),
          eq(jobs.isHidden, false)
        )
      );

    for (const job of producingJobs) {
      const jobNodeId = `job::${job.id}`;
      
      if (!nodes.has(jobNodeId)) {
        const jobNode: LineageNode = {
          id: jobNodeId,
          type: "job",
          dbId: job.id,
          name: job.name,
          description: `Job type: ${job.type}`,
          metadata: { jobType: job.type, organizationId: job.organizationId },
          depth: -(currentDepth + 1), // Negative for upstream
        };
        nodes.set(jobNodeId, jobNode);

        edges.push({
          source: jobNodeId,
          target: rootNode.id,
          relation: "WRITES_TO",
          metadata: {},
        });

        // Recurse: find what feeds this job
        const inputDatasetIds = this.extractDatasetIdsFromConfig(job.config);
        for (const inputDatasetId of inputDatasetIds) {
          if (inputDatasetId !== datasetId) {
            await this.addDatasetUpstream(
              inputDatasetId,
              jobNode,
              nodes,
              edges,
              maxDepth,
              currentDepth + 1
            );
          }
        }
      }
    }

    // Find job dependencies
    const dependentJobs = await db
      .select({
        jobId: jobDependencies.jobId,
        dependsOnJobId: jobDependencies.dependsOnJobId,
      })
      .from(jobDependencies)
      .where(
        inArray(
          jobDependencies.dependsOnJobId,
          producingJobs.map((j) => j.id)
        )
      );

    for (const dep of dependentJobs) {
      const [dependentJob] = await db
        .select({
          id: jobs.id,
          name: jobs.name,
          type: jobs.type,
        })
        .from(jobs)
        .where(eq(jobs.id, dep.jobId))
        .limit(1);

      if (dependentJob) {
        const jobNodeId = `job::${dependentJob.id}`;
        
        if (!nodes.has(jobNodeId)) {
          const jobNode: LineageNode = {
            id: jobNodeId,
            type: "job",
            dbId: dependentJob.id,
            name: dependentJob.name,
            description: `Job type: ${dependentJob.type}`,
            metadata: { jobType: dependentJob.type },
            depth: -(currentDepth + 1),
          };
          nodes.set(jobNodeId, jobNode);

          edges.push({
            source: jobNodeId,
            target: `job::${dep.dependsOnJobId}`,
            relation: "DERIVES_FROM",
            metadata: { dependency: "job" },
          });
        }
      }
    }
  },

  /**
   * Add dataset downstream from a job
   */
  async addDatasetFromJob(
    job: any,
    jobNode: LineageNode,
    nodes: Map<string, LineageNode>,
    edges: LineageEdge[],
    maxDepth: number,
    includeMissions: boolean,
    currentDepth: number
  ): Promise<void> {
    if (!job.outputDatasetId || currentDepth >= maxDepth) return;

    const datasetNodeId = `dataset::${job.outputDatasetId}`;
    
    if (!nodes.has(datasetNodeId)) {
      const [dataset] = await db
        .select({
          id: datasets.id,
          name: datasets.name,
          description: datasets.description,
        })
        .from(datasets)
        .where(eq(datasets.id, job.outputDatasetId))
        .limit(1);

      if (dataset) {
        const datasetNode: LineageNode = {
          id: datasetNodeId,
          type: "dataset",
          dbId: dataset.id,
          name: dataset.name,
          description: dataset.description || undefined,
          metadata: {},
          depth: currentDepth,
        };
        nodes.set(datasetNodeId, datasetNode);

        edges.push({
          source: jobNode.id,
          target: datasetNodeId,
          relation: "WRITES_TO",
          metadata: { jobId: job.id },
        });

        // Continue recursion
        await this.buildDownstreamLineage(
          datasetNode,
          nodes,
          edges,
          maxDepth,
          includeMissions,
          currentDepth
        );
      }
    }
  },

  /**
   * Add knowledge graph node from job
   */
  async addKnowledgeFromJob(
    job: any,
    jobNode: LineageNode,
    nodes: Map<string, LineageNode>,
    edges: LineageEdge[],
    currentDepth: number
  ): Promise<void> {
    const knowledgeNodeId = `knowledge::${job.outputKnowledgeTopicId}`;
    
    if (!nodes.has(knowledgeNodeId)) {
      const [knowledgeTopic] = await db
        .select({
          id: knowledgeNodes.id,
          name: knowledgeNodes.name,
        })
        .from(knowledgeNodes)
        .where(eq(knowledgeNodes.knowledgeTopicId, job.outputKnowledgeTopicId))
        .limit(1);

      if (knowledgeTopic) {
        const kNode: LineageNode = {
          id: knowledgeNodeId,
          type: "knowledge",
          dbId: knowledgeTopic.id,
          name: knowledgeTopic.name,
          metadata: {},
          depth: currentDepth,
        };
        nodes.set(knowledgeNodeId, kNode);

        edges.push({
          source: jobNode.id,
          target: knowledgeNodeId,
          relation: "EXTRACTS_TO",
          metadata: {},
        });
      }
    }
  },

  /**
   * Add missions that use a pipeline
   */
  async addMissionsFromPipeline(
    pipeline: any,
    pipelineNode: LineageNode,
    nodes: Map<string, LineageNode>,
    edges: LineageEdge[],
    currentDepth: number
  ): Promise<void> {
    // Find missions that have triggered this pipeline
    const missionPipelineLinks = await db
      .selectDistinct({
        missionId: pipelineExecutions.missionId,
      })
      .from(pipelineExecutions)
      .where(
        and(
          eq(pipelineExecutions.pipelineId, pipeline.id),
          sql`${pipelineExecutions.missionId} IS NOT NULL`
        )
      )
      .limit(10);

    for (const link of missionPipelineLinks) {
      if (!link.missionId) continue;

      const [mission] = await db
        .select({
          id: missions.id,
          name: missions.name,
          objective: missions.objective,
        })
        .from(missions)
        .where(eq(missions.id, link.missionId))
        .limit(1);

      if (mission) {
        const missionNodeId = `mission::${mission.id}`;
        
        if (!nodes.has(missionNodeId)) {
          const missionNode: LineageNode = {
            id: missionNodeId,
            type: "mission",
            dbId: mission.id,
            name: mission.name,
            description: mission.objective || undefined,
            metadata: {},
            depth: currentDepth,
          };
          nodes.set(missionNodeId, missionNode);

          edges.push({
            source: pipelineNode.id,
            target: missionNodeId,
            relation: "TRIGGERS",
            metadata: {},
          });
        }
      }
    }
  },

  /**
   * Add dataset upstream (what feeds into a job)
   */
  async addDatasetUpstream(
    datasetId: number,
    jobNode: LineageNode,
    nodes: Map<string, LineageNode>,
    edges: LineageEdge[],
    maxDepth: number,
    currentDepth: number
  ): Promise<void> {
    if (currentDepth >= maxDepth) return;

    const datasetNodeId = `dataset::${datasetId}`;
    
    if (!nodes.has(datasetNodeId)) {
      const [dataset] = await db
        .select({
          id: datasets.id,
          name: datasets.name,
          description: datasets.description,
        })
        .from(datasets)
        .where(eq(datasets.id, datasetId))
        .limit(1);

      if (dataset) {
        const datasetNode: LineageNode = {
          id: datasetNodeId,
          type: "dataset",
          dbId: dataset.id,
          name: dataset.name,
          description: dataset.description || undefined,
          metadata: {},
          depth: -(currentDepth + 1),
        };
        nodes.set(datasetNodeId, datasetNode);

        edges.push({
          source: datasetNodeId,
          target: jobNode.id,
          relation: "READS_FROM",
          metadata: {},
        });

        // Continue upstream recursion
        await this.buildUpstreamLineage(
          datasetNode,
          nodes,
          edges,
          maxDepth,
          currentDepth + 1
        );
      }
    }
  },

  /**
   * Extract dataset IDs from job config
   */
  extractDatasetIdsFromConfig(config: any): number[] {
    if (!config) return [];
    
    const ids: number[] = [];
    
    if (config.datasetId) {
      ids.push(config.datasetId);
    }
    
    if (Array.isArray(config.datasetIds)) {
      ids.push(...config.datasetIds.filter((id: any) => typeof id === "number"));
    }
    
    return [...new Set(ids)];
  },

  /**
   * Count total paths in lineage graph
   */
  countPaths(rootId: string, edges: LineageEdge[], nodes: Map<string, LineageNode>): number {
    // Build adjacency list
    const adj = new Map<string, string[]>();
    for (const edge of edges) {
      if (!adj.has(edge.source)) {
        adj.set(edge.source, []);
      }
      adj.get(edge.source)!.push(edge.target);
    }

    // DFS to count paths
    const visited = new Set<string>();
    let pathCount = 0;

    const dfs = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const neighbors = adj.get(nodeId) || [];
      if (neighbors.length === 0) {
        pathCount++;
      } else {
        for (const neighbor of neighbors) {
          dfs(neighbor);
        }
      }

      visited.delete(nodeId);
    };

    dfs(rootId);
    return pathCount;
  },

  /**
   * Impact Analysis: If Dataset A changes, what is affected?
   */
  async analyzeImpact(
    datasetId: number,
    options: {
      maxDepth?: number;
      includeIndirect?: boolean;
    } = {}
  ): Promise<ImpactAnalysis> {
    const { maxDepth = 5, includeIndirect = true } = options;

    logger.info(`[XrayLineage] Analyzing impact of dataset ${datasetId}`);

    // Build downstream lineage
    const graph = await this.buildLineageGraph(datasetId, {
      maxDepth,
      direction: "downstream",
      includeMissions: true,
    });

    const directlyAffected: AffectedEntity[] = [];
    const indirectlyAffected: AffectedEntity[] = [];

    for (const node of graph.nodes) {
      if (node.id === graph.rootNode.id) continue;

      // Find path from root to this node
      const path = this.findPath(graph.rootNode.id, node.id, graph.edges);
      const impactType = node.depth === 1 ? "direct" : "indirect";

      const entity: AffectedEntity = {
        id: node.dbId,
        type: node.type,
        name: node.name,
        path: path.map((n) => n.name),
        depth: node.depth,
        impactType,
        confidence: Math.max(0.9 - node.depth * 0.1, 0.4),
      };

      if (impactType === "direct") {
        directlyAffected.push(entity);
      } else if (includeIndirect) {
        indirectlyAffected.push(entity);
      }
    }

    // Calculate total impact score
    const totalEntities = directlyAffected.length + indirectlyAffected.length;
    const totalImpactScore = Math.min(totalEntities * 10, 100);

    // Determine blast radius
    let blastRadius: ImpactAnalysis["blastRadius"] = "minimal";
    if (totalImpactScore > 80) blastRadius = "critical";
    else if (totalImpactScore > 50) blastRadius = "significant";
    else if (totalImpactScore > 20) blastRadius = "moderate";

    // Generate recommended actions
    const recommendedActions = this.generateImpactRecommendations(
      directlyAffected,
      indirectlyAffected,
      blastRadius
    );

    return {
      sourceDatasetId: datasetId,
      directlyAffected: directlyAffected.slice(0, 20),
      indirectlyAffected: indirectlyAffected.slice(0, 50),
      totalImpactScore,
      blastRadius,
      recommendedActions,
    };
  },

  /**
   * Find path from source to target in lineage graph
   */
  findPath(sourceId: string, targetId: string, edges: LineageEdge[]): LineageNode[] {
    // BFS to find path
    const queue: { nodeId: string; path: string[] }[] = [{ nodeId: sourceId, path: [sourceId] }];
    const visited = new Set<string>();

    // Build adjacency
    const adj = new Map<string, string[]>();
    for (const edge of edges) {
      if (!adj.has(edge.source)) {
        adj.set(edge.source, []);
      }
      adj.get(edge.source)!.push(edge.target);
    }

    while (queue.length > 0) {
      const { nodeId, path } = queue.shift()!;

      if (nodeId === targetId) {
        // Return path as nodes (simplified)
        return path.map((id) => ({ id, name: id, type: "unknown" as const, dbId: 0, metadata: {}, depth: 0 }));
      }

      if (visited.has(nodeId)) continue;
      visited.add(nodeId);

      const neighbors = adj.get(nodeId) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push({ nodeId: neighbor, path: [...path, neighbor] });
        }
      }
    }

    return [];
  },

  /**
   * Generate recommendations based on impact analysis
   */
  generateImpactRecommendations(
    direct: AffectedEntity[],
    indirect: AffectedEntity[],
    blastRadius: string
  ): string[] {
    const actions: string[] = [];

    if (blastRadius === "critical" || blastRadius === "significant") {
      actions.push("Schedule change during maintenance window");
      actions.push("Notify all downstream system owners");
      actions.push("Prepare rollback plan");
    }

    if (direct.length > 5) {
      actions.push("Consider phased rollout of changes");
    }

    if (indirect.length > 20) {
      actions.push("High blast radius - requires architecture review");
    }

    const affectedMissions = [...direct, ...indirect].filter((e) => e.type === "mission");
    if (affectedMissions.length > 0) {
      actions.push(`Pause ${affectedMissions.length} affected missions during change`);
    }

    const affectedPipelines = [...direct, ...indirect].filter((e) => e.type === "pipeline");
    if (affectedPipelines.length > 0) {
      actions.push("Validate pipeline configurations after change");
    }

    return actions;
  },

  /**
   * Get lineage visualization data for UI
   */
  async getLineageVisualization(
    datasetId: number,
    maxDepth: number = 3
  ): Promise<{
    nodes: Array<{
      id: string;
      label: string;
      type: string;
      depth: number;
      x?: number;
      y?: number;
    }>;
    edges: Array<{
      source: string;
      target: string;
      label: string;
    }>;
  }> {
    const graph = await this.buildLineageGraph(datasetId, { maxDepth });

    // Assign positions for visualization (simple layout)
    const nodes = graph.nodes.map((node, idx) => ({
      id: node.id,
      label: node.name,
      type: node.type,
      depth: node.depth,
      x: node.depth * 200 + (idx % 3) * 50, // Horizontal by depth
      y: (idx % 5) * 100 + Math.abs(node.depth) * 30, // Vertical spread
    }));

    const edges = graph.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      label: edge.relation,
    }));

    return { nodes, edges };
  },

  /**
   * Batch lineage analysis for multiple datasets
   */
  async batchLineageAnalysis(
    datasetIds: number[],
    maxDepth: number = 3
  ): Promise<
    {
      datasetId: number;
      lineage?: LineageGraph;
      impact?: ImpactAnalysis;
      error?: string;
    }[]
  > {
    const results = [];

    for (const datasetId of datasetIds) {
      try {
        const lineage = await this.buildLineageGraph(datasetId, { maxDepth });
        const impact = await this.analyzeImpact(datasetId, { maxDepth });

        results.push({ datasetId, lineage, impact });
      } catch (error: any) {
        results.push({ datasetId, error: error.message });
      }
    }

    return results;
  },

  /**
   * Find datasets that are "hot" (many dependencies)
   */
  async findHotDatasets(
    organizationId: number,
    limit: number = 10
  ): Promise<
    {
      datasetId: number;
      datasetName: string;
      downstreamCount: number;
      blastRadius: string;
      riskScore: number;
    }[]
  > {
    // Required rather than optional, for the same reason as
    // getHighRiskMissions: `sql`true`` listed every tenant's datasets with
    // their impact scores, and the route sourced the organization from
    // ?orgId=, so leaving it off returned the whole platform.
    const orgFilter = eq(datasets.organizationId, organizationId);

    const allDatasets = await db
      .select({
        id: datasets.id,
        name: datasets.name,
      })
      .from(datasets)
      .where(orgFilter)
      .limit(100);

    const scored = await Promise.all(
      allDatasets.map(async (dataset) => {
        const impact = await this.analyzeImpact(dataset.id, { maxDepth: 2 });
        const downstreamCount = impact.directlyAffected.length + impact.indirectlyAffected.length;

        return {
          datasetId: dataset.id,
          datasetName: dataset.name,
          downstreamCount,
          blastRadius: impact.blastRadius,
          riskScore: impact.totalImpactScore,
        };
      })
    );

    return scored
      .filter((d) => d.downstreamCount > 0)
      .sort((a, b) => b.downstreamCount - a.downstreamCount)
      .slice(0, limit);
  },
};

export default xrayLineageService;
