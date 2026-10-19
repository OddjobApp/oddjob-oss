/**
 * Xray Composition Service
 *
 * Builds a semantic entity graph (screens, APIs, components, jobs, pipelines,
 * missions, datasets, knowledge clusters, npm modules, operational cycles, programs) for a given scope.
 *
 * Scope "oddjob"  → platform-level entities scoped to the requesting org
 * Scope <slug>    → entities belonging to a specific forged app workspace
 */

import path from "node:path";
import fs from "node:fs/promises";
import { Dirent } from "node:fs";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { 
  missions, missionMembers, missionRuns, 
  pipelines, pipelineSteps, jobs, 
  datasets, knowledgeTopics, knowledgeNodes, knowledgeEdges,
  operationalCycles, apps, agentDeployments, skills
} from "@shared/schema/index.js";
import { eq, and, or, isNull, isNotNull, inArray, sql, desc, like, ilike, count } from "drizzle-orm";
import { missionRunService } from "@domain/mission/core/mission-run.service.js";
import { parseRouteFile, extractDomainFromPath } from "./parsers/route-parser.js";
import { parseEndpointFile, extractDomainFromRoutePath } from "./parsers/endpoint-parser.js";
import { parseComponentFile, extractParentDir } from "./parsers/component-parser.js";
import { discoverDomainModules, discoverWorkspacePackages, detectCrossModuleImports } from "./parsers/module-parser.js";
import { listSourceFilesSafe } from "./utils/safe-scanner.js";
import { parseXrayE2ESpec } from "./parsers/e2e-spec-parser.js";

const FORGE_WORKSPACE = process.env.FORGE_WORKSPACE ?? "C:\\LocalData\\forge\\workspace";

import type {
  CompositionGraph,
  CompositionNode,
  CompositionEdge,
  CompositionScope,
  CompositionNodeType,
  EdgeRelation,
} from "../types/composition.js";

const logger = createLogger("XrayComposition");

// ─── Helpers ─────────────────────────────────────────────────────────────────

function nodeId(type: CompositionNodeType, key: string | number): string {
  return `${type}::${key}`;
}

function edge(
  source: string,
  target: string,
  relation: EdgeRelation,
  label: string
): CompositionEdge {
  return { id: `${source}→${target}:${relation}`, source, target, relation, label };
}

/** Recursively list .tsx/.ts files under a directory, skipping node_modules/.next */
async function listSourceFiles(dir: string, rel = ""): Promise<string[]> {
  const results: string[] = [];
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  const skip = new Set(["node_modules", ".next", "dist", ".git"]);
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...(await listSourceFiles(full, relPath)));
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      results.push(relPath);
    }
  }
  return results;
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const xrayCompositionService = {

  async listScopes(organizationId: number): Promise<CompositionScope[]> {
    const forgedApps = await db.select({ id: apps.id, name: apps.name, slug: apps.slug, icon: apps.icon })
      .from(apps)
      .where(or(eq(apps.organizationId, organizationId), isNull(apps.organizationId)))
      .orderBy(apps.name);

    const scopes: CompositionScope[] = [
      { id: "oddjob", name: "Oddjob Platform", type: "platform" },
      ...forgedApps.map(a => ({
        id: a.slug,
        name: a.name,
        type: "forged_app" as const,
        icon: a.icon ?? undefined,
        appId: a.id,
      })),
    ];
    return scopes;
  },

  async getDiagnostics(organizationId: number) {
    const [
      [cycleCount],
      [missionCount],
      [datasetCount],
      [jobsWithDatasetConfig],
      [knowledgeTopicCount],
      [knowledgeEdgeCount],
      cycleLinkedRuns,
      cacheStatus,
    ] = await Promise.all([
      db.select({ n: count() }).from(operationalCycles)
        .where(and(eq(operationalCycles.organizationId, organizationId), isNull(operationalCycles.deletedAt))),
      db.select({ n: count() }).from(missions)
        .where(and(eq(missions.organizationId, organizationId), isNull(missions.deletedAt))),
      db.select({ n: count() }).from(datasets).where(eq(datasets.organizationId, organizationId)),
      db.select({ n: sql<number>`count(*) filter (where config::text like '%datasetId%')::int` }).from(jobs)
        .where(eq(jobs.organizationId, organizationId)),
      db.select({ n: count() }).from(knowledgeTopics).where(eq(knowledgeTopics.organizationId, organizationId)),
      db.select({ n: count() }).from(knowledgeEdges),
      db.select({ n: count() }).from(missionRuns)
        .where(and(
          eq(missionRuns.organizationId, organizationId),
          isNotNull(missionRuns.cycleId),
          isNull(missionRuns.deletedAt)
        )),
      (async () => {
        try {
          const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
          const keys = await redis.keys(`xray:composition:oddjob:${organizationId}*`);
          return { connected: true, keysFound: keys.length };
        } catch {
          return { connected: false, keysFound: 0 };
        }
      })(),
    ]);

    return {
      operationalCycles: cycleCount?.n ?? 0,
      missions: missionCount?.n ?? 0,
      datasets: datasetCount?.n ?? 0,
      jobsWithDatasetConfig: jobsWithDatasetConfig?.n ?? 0,
      knowledgeTopics: knowledgeTopicCount?.n ?? 0,
      knowledgeEdges: knowledgeEdgeCount?.n ?? 0,
      cycleLinkedRuns: cycleLinkedRuns[0]?.n ?? 0,
      cache: cacheStatus,
    };
  },

  async verifyScopeAccess(scope: string, organizationId: number): Promise<boolean> {
    if (scope === "oddjob") return true;
    const [app] = await db.select({ id: apps.id })
      .from(apps)
      .where(and(
        eq(apps.slug, scope),
        or(eq(apps.organizationId, organizationId), isNull(apps.organizationId))
      ))
      .limit(1);
    return !!app;
  },

  async buildGraph(
    scope: string,
    organizationId: number,
    options: { skipCache?: boolean; types?: CompositionNodeType[]; isSuperAdmin?: boolean } = {}
  ): Promise<CompositionGraph> {
    try {
      if (!options.skipCache) {
        const cached = await this._getCachedGraph(scope, organizationId, options.isSuperAdmin);
        if (cached) return cached;
      }

      const scopeMeta = await this._resolveScope(scope, organizationId, options.isSuperAdmin);
      let nodes: CompositionNode[] = [];
      let edges: CompositionEdge[] = [];

      if (scopeMeta.type === "platform") {
        const platform = await this._collectPlatformEntities(organizationId, options.types, options.isSuperAdmin);
        nodes = platform.nodes;
        edges = platform.edges;
      } else {
        await this._collectAppEntities(scopeMeta.id, scopeMeta.appId, organizationId, nodes, edges);
        await this._collectLinkedE2ETests(scopeMeta.id, nodes, edges);
      }

      await this._buildModuleRelationships(nodes, edges);
      const systemEdges = await this._fetchSystemGraph(nodes, organizationId, options.isSuperAdmin);
      edges.push(...systemEdges);

      const uniqueNodes = Array.from(new Map(nodes.map(n => [n.id, n])).values());
      const nodeIds = new Set(uniqueNodes.map(n => n.id));
      const uniqueEdges = Array.from(new Map(edges.map(e => [e.id, e])).values())
        .filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

      // Log per-relation-type edge counts to aid debugging
      const edgeCounts = uniqueEdges.reduce((acc, e) => {
        acc[e.relation] = (acc[e.relation] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      logger.info(`[XrayComposition] Built graph: scope=${scope} nodes=${uniqueNodes.length} edges=${uniqueEdges.length}`, edgeCounts);

      const graph: CompositionGraph = {
        scope: scopeMeta,
        nodes: uniqueNodes,
        edges: uniqueEdges,
        indexedAt: new Date().toISOString()
      };
      
      if (!options.skipCache) {
        await this._setCachedGraph(scope, organizationId, graph, options.isSuperAdmin);
      }
      return graph;
    } catch (err: any) {
      if (err.message === "Access denied for X-Ray composition scope") {
        throw err;
      }
      logger.error(`[XrayComposition] Failed to build graph for scope ${scope}: ${err.message}`, err);
      return { 
        scope: { id: scope, name: scope, type: "platform" }, 
        nodes: [], 
        edges: [], 
        indexedAt: new Date().toISOString(),
        error: err.message 
      };
    }
  },

  async _collectPlatformEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    const nodes: CompositionNode[] = [];
    const edges: CompositionEdge[] = [];

    // Isolate each collector so a single failure doesn't blank the entire graph
    const safe = async (name: string, fn: () => Promise<{ nodes: CompositionNode[]; edges: CompositionEdge[] }>) => {
      try {
        return await fn();
      } catch (err: any) {
        logger.error(`[XrayComposition] Collector "${name}" failed: ${err.message}`, err);
        return { nodes: [] as CompositionNode[], edges: [] as CompositionEdge[] };
      }
    };

    const results = await Promise.all([
      safe("jobs",           () => this._collectJobEntities(orgId, types, isSuperAdmin)),
      safe("pipelines",      () => this._collectPipelineEntities(orgId, types, isSuperAdmin)),
      safe("missions",       () => this._collectMissionEntities(orgId, types, isSuperAdmin)),
      safe("datasets",       () => this._collectDatasetEntities(orgId, types, isSuperAdmin)),
      safe("knowledge",      () => this._collectKnowledgeEntities(orgId, types, isSuperAdmin)),
      safe("cycles",         () => this._collectCycleEntities(orgId, types, isSuperAdmin)),
      safe("agents",         () => this._collectAgentEntities(orgId, types, isSuperAdmin)),
      safe("skills",         () => this._collectSkillEntities(orgId, types, isSuperAdmin)),
      safe("screens",        () => this._collectScreenEntities(types)),
      safe("api_endpoints",  () => this._collectApiEndpointEntities(types)),
      safe("components",     () => this._collectComponentEntities(types)),
      safe("modules",        () => this._collectModuleEntities(types)),
      safe("ontology_types", () => this._collectOntologyTypeEntities(orgId, types, isSuperAdmin)),
      safe("ontology_actions", () => this._collectOntologyActionEntities(orgId, types, isSuperAdmin)),
      safe("ontology_links", () => this._collectOntologyLinkTypeEntities(orgId, types, isSuperAdmin)),
    ]);

    for (const r of results) {
      nodes.push(...r.nodes);
      edges.push(...r.edges);
    }

    // Cross-referencing pass: build inter-type edges after all collectors complete
    const screenNodes = nodes.filter(n => n.type === "screen");
    const endpointNodes = nodes.filter(n => n.type === "api_endpoint");
    const componentNodes = nodes.filter(n => n.type === "ui_component");
    const moduleNodes = nodes.filter(n => n.type === "npm_module");

    const crossEdges = await this._buildCrossCollectorEdges(screenNodes, endpointNodes, componentNodes, moduleNodes);
    edges.push(...crossEdges);

    return { nodes, edges };
  },

  async _collectJobEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("job_definition")) return { nodes: [], edges: [] };
    const orgFilter = isSuperAdmin ? undefined : or(eq(jobs.organizationId, orgId), isNull(jobs.organizationId));
    const rows = await db.select().from(jobs).where(and(orgFilter, eq(jobs.isHidden, false))).limit(1000);

    const nodes: CompositionNode[] = rows.map(j => ({
      id: nodeId("job_definition", j.id), type: "job_definition", label: j.name,
      group: "Jobs", dbId: j.id,
      metadata: { jobType: j.type, outputDatasetId: j.outputDatasetId }
    }));
    // Skill edges are built by _collectSkillEntities to avoid duplication
    return { nodes, edges: [] };
  },

  async _collectPipelineEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("pipeline")) return { nodes: [], edges: [] };
    const orgFilter = isSuperAdmin ? undefined : or(eq(pipelines.organizationId, orgId), isNull(pipelines.organizationId));
    const rows = await db.select().from(pipelines).where(orgFilter).limit(1000);

    const nodes: CompositionNode[] = rows.map(p => ({
      id: nodeId("pipeline", p.id), type: "pipeline", label: p.name,
      description: p.description ?? "Automation Pipeline", group: "Pipelines", dbId: p.id,
      metadata: { trigger: p.triggerType, status: p.isActive ? "active" : "inactive" }
    }));
    
    const steps = await db.select().from(pipelineSteps).limit(2000);
    const edges: CompositionEdge[] = [];
    steps.forEach(s => {
      const pNode = nodes.find(n => n.dbId === s.pipelineId);
      if (pNode) {
        if (s.jobId) edges.push(edge(pNode.id, nodeId("job_definition", s.jobId), "TRIGGERS", `step ${s.order}`));
      }
    });
    return { nodes, edges };
  },

  async _collectMissionEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("mission")) return { nodes: [], edges: [] };
    const orgFilter = isSuperAdmin ? undefined : or(eq(missions.organizationId, orgId), isNull(missions.organizationId));
    const missionList = await db.select().from(missions).where(and(orgFilter, isNull(missions.deletedAt))).limit(1000);

    const nodes: CompositionNode[] = missionList.map(m => ({
      id: nodeId("mission", m.id), type: "mission", label: m.name,
      description: m.objective ?? "Active Mission", dbId: m.id, group: "Missions",
      metadata: { objective: m.objective, outcome: (m as any).outcomeSummary || "In Progress" }
    }));
    
    const edges: CompositionEdge[] = [];
    missionList.forEach(m => {
      if (m.parentId) edges.push(edge(nodeId("mission", m.parentId), nodeId("mission", m.id), "TRIGGERS", "sub-mission"));
    });

    if (missionList.length > 0) {
      const missionIds = missionList.map(m => m.id);
      const members = await db.select({
        missionId: missionMembers.missionId,
        entityId: missionMembers.entityId,
        entityType: missionMembers.entityType,
        role: missionMembers.role,
        jobType: jobs.type
      })
      .from(missionMembers)
      .leftJoin(jobs, and(eq(missionMembers.entityId, jobs.id), eq(missionMembers.entityType, 'job')))
      .where(inArray(missionMembers.missionId, missionIds));
      
      const runs = await db.select({
        missionId: missionRuns.missionId,
        currentPipelineId: missionRuns.currentPipelineId,
        pipelineSequence: missionRuns.pipelineSequence
      })
      .from(missionRuns)
      .where(and(inArray(missionRuns.missionId, missionIds), isNull(missionRuns.deletedAt)));

      const seen = new Set<string>();

      members.forEach(m => {
        if (m.entityType === 'pipeline') {
          edges.push(edge(nodeId("pipeline", m.entityId), nodeId("mission", m.missionId), "MEMBER_OF", m.role ?? "assigned"));
        } else {
          const type = m.jobType === 'supervisor' ? 'supervisor' : 'agent';
          edges.push(edge(nodeId(type, m.entityId), nodeId("mission", m.missionId), "MEMBER_OF", m.role ?? "assigned"));
        }
      });

      runs.forEach(run => {
        if (run.missionId) {
          const missionId = run.missionId;
          if (run.currentPipelineId) {
            const edgeId = `mission-${run.missionId}-to-pipeline-${run.currentPipelineId}`;
            if (!seen.has(edgeId)) {
              edges.push(edge(nodeId("mission", missionId), nodeId("pipeline", run.currentPipelineId), "TRIGGERS", "executes"));
              seen.add(edgeId);
            }
          }
          if (run.pipelineSequence && Array.isArray(run.pipelineSequence)) {
            run.pipelineSequence.forEach((pid: number) => {
              const edgeId = `mission-${missionId}-to-pipeline-${pid}`;
              if (!seen.has(edgeId)) {
                edges.push(edge(nodeId("mission", missionId), nodeId("pipeline", pid), "TRIGGERS", "planned"));
                seen.add(edgeId);
              }
            });
          }
        }
      });

      // --- Structural blueprint links (no run required) ---
      // Installed (draft) missions store the pipeline they will execute in
      // `workflowBlueprint.pipelineId` BEFORE any run exists. Surface that link so
      // freshly-installed cycle apps connect to their pipelines instead of showing
      // as isolated nodes. Reuses the same `seen` set + edge-id format as the
      // run-based edges above, so a mission that later runs won't get a duplicate.
      missionList.forEach(m => {
        const bp = (m as any).workflowBlueprint;
        if (!bp || typeof bp !== "object") return;
        const pids: number[] = [];
        if (bp.pipelineId != null) pids.push(Number(bp.pipelineId));
        if (Array.isArray(bp.pipelineSequence)) bp.pipelineSequence.forEach((pid: any) => pids.push(Number(pid)));
        pids.forEach(pid => {
          if (!Number.isFinite(pid)) return;
          const edgeId = `mission-${m.id}-to-pipeline-${pid}`;
          if (!seen.has(edgeId)) {
            edges.push(edge(nodeId("mission", m.id), nodeId("pipeline", pid), "TRIGGERS", "blueprint"));
            seen.add(edgeId);
          }
        });
      });

      // --- Cycle relationships: mission BELONGS_TO operational_cycle ---
      const cycleRuns = await db.select({
        missionId: missionRuns.missionId,
        cycleId: missionRuns.cycleId,
      })
      .from(missionRuns)
      .where(and(
        inArray(missionRuns.missionId, missionIds),
        isNotNull(missionRuns.cycleId),
        isNull(missionRuns.deletedAt)
      ))
      .orderBy(desc(missionRuns.createdAt));

      if (cycleRuns.length > 0) {
        const cycleIds = [...new Set(cycleRuns.map(r => r.cycleId).filter((id): id is number => !!id))];
        if (cycleIds.length === 0) return { nodes, edges };
        const cycleRows = await db.select({ id: operationalCycles.id, name: operationalCycles.name })
          .from(operationalCycles)
          .where(and(inArray(operationalCycles.id, cycleIds), isNull(operationalCycles.deletedAt)));
        const cycleNameMap = new Map(cycleRows.map(c => [c.id, c.name]));

        const cycleSeen = new Set<string>();
        cycleRuns.forEach(run => {
          if (!run.cycleId || !run.missionId) return;
          const edgeId = `mission-${run.missionId}-belongs-cycle-${run.cycleId}`;
          if (!cycleSeen.has(edgeId) && cycleNameMap.has(run.cycleId)) {
            edges.push(edge(nodeId("mission", run.missionId), nodeId("operational_cycle", run.cycleId), "BELONGS_TO", "part of cycle"));
            cycleSeen.add(edgeId);
            // Enrich mission node metadata with cycle context
            const mNode = nodes.find(n => n.dbId === run.missionId);
            if (mNode) {
              mNode.metadata = { ...mNode.metadata, cycleId: run.cycleId, cycleName: cycleNameMap.get(run.cycleId) };
            }
          }
        });
      }
    }

    return { nodes, edges };
  },

  async _collectDatasetEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("dataset")) return { nodes: [], edges: [] };
    const orgFilter = isSuperAdmin ? undefined : or(eq(datasets.organizationId, orgId), isNull(datasets.organizationId));
    const rows = await db.select().from(datasets).where(orgFilter).limit(500);

    const nodes: CompositionNode[] = rows.map(d => ({
      id: nodeId("dataset", d.id), type: "dataset", label: d.name,
      description: d.description ?? "Data Asset", group: "Data", dbId: d.id,
      metadata: { tags: d.tags ?? [] },
    }));

    // Build job→dataset WRITES_TO edges via the outputDatasetId FK column
    const edges: CompositionEdge[] = [];
    if (rows.length === 0) return { nodes, edges };

    const datasetIdSet = new Set(rows.map(d => d.id));
    const jobOrgFilter = isSuperAdmin ? undefined : or(eq(jobs.organizationId, orgId), isNull(jobs.organizationId));

    // Jobs write their output to a dataset via the outputDatasetId FK column
    const jobRows = await db.select({ id: jobs.id, outputDatasetId: jobs.outputDatasetId })
      .from(jobs)
      .where(and(jobOrgFilter, isNotNull(jobs.outputDatasetId)));

    jobRows.forEach(j => {
      if (j.outputDatasetId && datasetIdSet.has(j.outputDatasetId)) {
        edges.push(edge(nodeId("job_definition", j.id), nodeId("dataset", j.outputDatasetId), "WRITES_TO", "outputs to"));
      }
    });

    // Pipelines→Dataset: a pipeline WRITES_TO dataset if any of its steps' jobs do
    const pipelineOrgFilter = isSuperAdmin ? undefined : or(eq(pipelines.organizationId, orgId), isNull(pipelines.organizationId));
    const orgPipelines = await db.select({ id: pipelines.id }).from(pipelines).where(pipelineOrgFilter);
    const orgPipelineIds = orgPipelines.map(p => p.id);

    if (orgPipelineIds.length > 0) {
      const stepRows = await db.select({ pipelineId: pipelineSteps.pipelineId, jobId: pipelineSteps.jobId })
        .from(pipelineSteps)
        .where(inArray(pipelineSteps.pipelineId, orgPipelineIds));
      const jobOutputMap = new Map(jobRows.map(j => [j.id, j.outputDatasetId]));
      const seenPipelineDataset = new Set<string>();

      stepRows.forEach(step => {
        if (!step.jobId) return;
        const dsId = jobOutputMap.get(step.jobId);
        if (!dsId || !datasetIdSet.has(dsId)) return;
        const key = `pipeline-${step.pipelineId}-dataset-${dsId}`;
        if (!seenPipelineDataset.has(key)) {
          edges.push(edge(nodeId("pipeline", step.pipelineId), nodeId("dataset", dsId), "WRITES_TO", "outputs via step"));
          seenPipelineDataset.add(key);
        }
      });
    }

    return { nodes, edges };
  },

  async _collectKnowledgeEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("knowledge_cluster")) return { nodes: [], edges: [] };
    const orgFilter = isSuperAdmin ? undefined : or(eq(knowledgeTopics.organizationId, orgId), isNull(knowledgeTopics.organizationId));
    const rows = await db.select().from(knowledgeTopics).where(orgFilter).limit(500);

    const nodes: CompositionNode[] = rows.map(k => ({
      id: nodeId("knowledge_cluster", k.id), type: "knowledge_cluster", label: k.name,
      description: k.description ?? "Semantic Cluster", group: "Knowledge", dbId: k.id,
      metadata: {},
    }));

    // Job→Knowledge WRITES_TO via outputKnowledgeTopicId FK
    const directEdges: CompositionEdge[] = [];
    if (rows.length > 0) {
      const topicIdSet = new Set(rows.map(k => k.id));
      const jobOrgFilter = isSuperAdmin ? undefined : or(eq(jobs.organizationId, orgId), isNull(jobs.organizationId));
      const jobRows = await db.select({ id: jobs.id, outputKnowledgeTopicId: jobs.outputKnowledgeTopicId })
        .from(jobs)
        .where(and(jobOrgFilter, isNotNull(jobs.outputKnowledgeTopicId)));
      jobRows.forEach(j => {
        if (j.outputKnowledgeTopicId && topicIdSet.has(j.outputKnowledgeTopicId)) {
          directEdges.push(edge(nodeId("job_definition", j.id), nodeId("knowledge_cluster", j.outputKnowledgeTopicId), "WRITES_TO", "stores to"));
        }
      });
    }

    // Build mission→knowledge READS_FROM edges from knowledge_nodes fingerprints
    // This surfaces RAG retrieval relationships without requiring a separate indexing pass.
    const edges: CompositionEdge[] = [];
    if (rows.length > 0) {
      const topicIds = rows.map(k => k.id);
      const topicFingerprints = topicIds.map(id => `xray:knowledge:${id}`);
      const { sql: sqlFn } = await import("drizzle-orm");

      const kNodeRows = await db.select({ id: knowledgeNodes.id, fingerprint: knowledgeNodes.fingerprint })
        .from(knowledgeNodes)
        .where(inArray(knowledgeNodes.fingerprint, topicFingerprints));

      if (kNodeRows.length > 0) {
        const kNodeIds = kNodeRows.map(n => n.id);
        const fingerprintToTopicId = new Map(
          kNodeRows
            .filter((n): n is typeof n & { fingerprint: string } => n.fingerprint != null)
            .map(n => [n.id, parseInt(n.fingerprint.split(":").pop() ?? "0")])
        );

        // Fetch edges where these knowledge nodes are targets (mission READS_FROM knowledge)
        const kEdges = await db.select({
          sourceId: knowledgeEdges.sourceId,
          targetId: knowledgeEdges.targetId,
          relation: knowledgeEdges.relation,
        })
        .from(knowledgeEdges)
        .where(and(
          inArray(knowledgeEdges.targetId, kNodeIds),
          sqlFn`${knowledgeEdges.relation} = 'READS_FROM'`
        ));

        if (kEdges.length === 0) return { nodes, edges };

        const sourceIds = [...new Set(kEdges.map(e => e.sourceId))];
        // Fetch source mission nodes
        const sourceMissionFingerprints = await db.select({ id: knowledgeNodes.id, fingerprint: knowledgeNodes.fingerprint })
          .from(knowledgeNodes)
          .where(inArray(knowledgeNodes.id, sourceIds));

        const kNodeFingerprintMap = new Map(sourceMissionFingerprints.map(n => [n.id, n.fingerprint]));

        const seen = new Set<string>();
        kEdges.forEach(ke => {
          const srcFp = kNodeFingerprintMap.get(ke.sourceId);
          const tgtTopicId = fingerprintToTopicId.get(ke.targetId);
          if (!srcFp || !tgtTopicId) return;

          // Only build edges for mission sources
          if (!srcFp.startsWith("xray:mission:")) return;
          const missionId = parseInt(srcFp.split(":").pop() ?? "0");
          if (!missionId) return;

          const edgeId = `mission-${missionId}-reads-knowledge-${tgtTopicId}`;
          if (!seen.has(edgeId)) {
            edges.push(edge(nodeId("mission", missionId), nodeId("knowledge_cluster", tgtTopicId), "READS_FROM", "queries knowledge"));
            seen.add(edgeId);
          }
        });
      }
    }

    return { nodes, edges: [...directEdges, ...edges] };
  },

  async _collectSkillEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("skill")) return { nodes: [] as CompositionNode[], edges: [] as CompositionEdge[] };
    const orgFilter = isSuperAdmin ? undefined : or(eq(skills.organizationId, orgId), isNull(skills.organizationId));
    const skillRows = await db.select().from(skills).where(orgFilter).limit(500);

    const nodes: CompositionNode[] = skillRows.map(s => ({
      id: nodeId("skill", s.id), type: "skill" as CompositionNodeType, label: s.name,
      description: s.description ?? "Skill", group: "Skills", dbId: s.id,
      metadata: { language: s.language, isPublic: s.isPublic },
    }));

    const edges: CompositionEdge[] = [];
    if (skillRows.length === 0) return { nodes, edges };

    const skillIdSet = new Set(skillRows.map(s => s.id));
    const jobOrgFilter = isSuperAdmin ? undefined : or(eq(jobs.organizationId, orgId), isNull(jobs.organizationId));

    // Job→Skill via skillId FK (the job was created from / is linked to a skill)
    const jobRows = await db.select({ id: jobs.id, skillId: jobs.skillId, type: jobs.type })
      .from(jobs)
      .where(and(jobOrgFilter, isNotNull(jobs.skillId)));

    jobRows.forEach(j => {
      if (!j.skillId || !skillIdSet.has(j.skillId)) return;
      const nodeType = j.type === 'supervisor' ? 'supervisor' : 'agent';
      edges.push(edge(nodeId(nodeType, j.id), nodeId("skill", j.skillId), "HAS_SKILL", "implements"));
    });

    return { nodes, edges };
  },

  async _collectScreenEntities(types?: CompositionNodeType[]): Promise<{ nodes: CompositionNode[]; edges: CompositionEdge[] }> {
    if (types && !types.includes("screen")) return { nodes: [], edges: [] };

    const projectRoot = path.resolve(process.cwd());
    const nodes: CompositionNode[] = [];
    const edges: CompositionEdge[] = [];

    // Gather all routing files from server/domain/*/ui/components/routing/
    const serverDomainDir = path.join(projectRoot, "server", "domain");
    let domainDirs: string[] = [];
    try {
      const entries = await fs.readdir(serverDomainDir, { withFileTypes: true });
      domainDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      // server/domain/ doesn't exist or is inaccessible — skip
    }

    const routingFiles: string[] = [];

    // Scan each domain's ui/components/routing/ directory
    for (const domain of domainDirs) {
      const routingDir = path.join(serverDomainDir, domain, "ui", "components", "routing");
      const files = await listSourceFilesSafe(routingDir, projectRoot, {
        extensions: [".tsx", ".ts"],
      });
      routingFiles.push(...files);
    }

    // Scan client/src/modules/ for routing files
    const clientModulesDir = path.join(projectRoot, "client", "src", "modules");
    const clientFiles = await listSourceFilesSafe(clientModulesDir, projectRoot, {
      extensions: [".tsx", ".ts"],
    });
    routingFiles.push(...clientFiles);

    // Parse each routing file
    for (const filePath of routingFiles) {
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch (err: any) {
        logger.warn(`[XrayComposition] Could not read routing file: ${filePath}`, { error: err.message });
        continue;
      }

      const domain = extractDomainFromPath(filePath);
      const routes = parseRouteFile(content, filePath, domain);

      for (const route of routes) {
        nodes.push({
          id: `screen::${route.path}`,
          type: "screen",
          label: route.path,
          filePath: route.filePath,
          group: route.domain,
        });
      }
    }

    return { nodes, edges };
  },

  async _collectApiEndpointEntities(types?: CompositionNodeType[]): Promise<{ nodes: CompositionNode[]; edges: CompositionEdge[] }> {
    if (types && !types.includes("api_endpoint")) return { nodes: [], edges: [] };

    const projectRoot = path.resolve(process.cwd());
    const nodes: CompositionNode[] = [];
    const edges: CompositionEdge[] = [];

    // Read server/domain/ subdirs to find those with routes/ directories
    const serverDomainDir = path.join(projectRoot, "server", "domain");
    let domainDirs: string[] = [];
    try {
      const entries = await fs.readdir(serverDomainDir, { withFileTypes: true });
      domainDirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch {
      // server/domain/ doesn't exist or is inaccessible — skip
      return { nodes, edges };
    }

    // Known service-to-entity mappings for edge detection
    const SERVICE_ENTITY_MAP: Record<string, { type: CompositionNodeType; label: string }> = {
      mission: { type: "mission", label: "missions" },
      dataset: { type: "dataset", label: "datasets" },
      job: { type: "job_definition", label: "jobs" },
      knowledge: { type: "knowledge_cluster", label: "knowledge" },
    };

    // Scan each domain's routes/ directory
    for (const domain of domainDirs) {
      const routesDir = path.join(serverDomainDir, domain, "routes");
      const files = await listSourceFilesSafe(routesDir, projectRoot, {
        extensions: [".ts", ".js"],
      });

      for (const filePath of files) {
        let content: string;
        try {
          content = await fs.readFile(filePath, "utf-8");
        } catch (err: any) {
          logger.warn(`[XrayComposition] Could not read route file: ${filePath}`, { error: err.message });
          continue;
        }

        const endpoints = parseEndpointFile(content, filePath, domain);

        for (const ep of endpoints) {
          const endpointId = nodeId("api_endpoint", `${ep.method}-${ep.path}`);
          nodes.push({
            id: endpointId,
            type: "api_endpoint",
            label: `${ep.method} ${ep.path}`,
            filePath: ep.filePath,
            group: ep.domain,
          });

          // Detect service imports for READS_FROM / WRITES_TO edges
          for (const [serviceKey, entityInfo] of Object.entries(SERVICE_ENTITY_MAP)) {
            // Check if the file imports from a service matching this entity type
            const servicePattern = new RegExp(
              "(?:import|from)\\s+.*['\"].*" + serviceKey + ".*(?:service|Service).*['\"]",
              "i"
            );
            if (servicePattern.test(content)) {
              const targetNodeId = nodeId(entityInfo.type, entityInfo.label);
              if (ep.method === "GET") {
                edges.push(edge(endpointId, targetNodeId, "READS_FROM", `reads ${serviceKey}`));
              } else {
                // POST, PUT, PATCH, DELETE → WRITES_TO
                edges.push(edge(endpointId, targetNodeId, "WRITES_TO", `writes ${serviceKey}`));
              }
            }
          }
        }
      }
    }

    return { nodes, edges };
  },

  async _collectComponentEntities(types?: CompositionNodeType[]): Promise<{ nodes: CompositionNode[]; edges: CompositionEdge[] }> {
    if (types && !types.includes("ui_component")) return { nodes: [], edges: [] };

    const projectRoot = path.resolve(process.cwd());
    const nodes: CompositionNode[] = [];
    const edges: CompositionEdge[] = [];

    // Scan client/src/components/ subdirectories for .tsx and .ts files
    const componentsDir = path.join(projectRoot, "client", "src", "components");
    const files = await listSourceFilesSafe(componentsDir, projectRoot, {
      extensions: [".tsx", ".ts"],
    });

    // Map from component name to node for edge resolution
    const componentNodeMap = new Map<string, CompositionNode>();
    // Map from file path to parsed component (for edge building)
    const fileComponentMap = new Map<string, { node: CompositionNode; imports: string[] }>();

    for (const filePath of files) {
      let content: string;
      try {
        content = await fs.readFile(filePath, "utf-8");
      } catch (err: any) {
        logger.warn(`[XrayComposition] Could not read component file: ${filePath}`, { error: err.message });
        continue;
      }

      const parentDir = extractParentDir(filePath);
      const parsed = parseComponentFile(content, filePath, parentDir);

      // Skip barrel/utility files (parser returns null)
      if (!parsed) continue;

      const node: CompositionNode = {
        id: `ui_component::${parsed.name}`,
        type: "ui_component",
        label: parsed.name,
        filePath: parsed.filePath,
        group: parsed.parentDir,
      };

      nodes.push(node);
      componentNodeMap.set(parsed.name, node);
      fileComponentMap.set(filePath, { node, imports: parsed.imports });
    }

    // Build DEPENDS_ON edges between UI components by matching import specifiers
    for (const [, { node: sourceNode, imports }] of fileComponentMap) {
      for (const importSpec of imports) {
        // Try to resolve the import specifier to a known component node
        // Match by: filename-derived name or direct match against known component names
        const importSegments = importSpec.replace(/\\/g, "/").split("/");
        const lastSegment = importSegments[importSegments.length - 1];
        // Strip extension if present
        const importName = lastSegment?.replace(/\.\w+$/, "") ?? "";

        // Check if the imported name (PascalCase) matches a known component
        const capitalizedName = importName.charAt(0).toUpperCase() + importName.slice(1);

        // Direct match by component name
        if (componentNodeMap.has(importName) && importName !== sourceNode.label) {
          edges.push(edge(sourceNode.id, `ui_component::${importName}`, "DEPENDS_ON", "imports"));
        } else if (componentNodeMap.has(capitalizedName) && capitalizedName !== sourceNode.label) {
          edges.push(edge(sourceNode.id, `ui_component::${capitalizedName}`, "DEPENDS_ON", "imports"));
        } else {
          // Try to match by resolving the import path relative to the component dir
          // Only consider relative imports within the components directory
          if (importSpec.startsWith(".") || importSpec.startsWith("@/components")) {
            // For relative imports, resolve the target file path
            let resolvedPath: string;
            if (importSpec.startsWith("@/components")) {
              resolvedPath = path.join(componentsDir, importSpec.replace("@/components", "").replace(/^\//, ""));
            } else {
              resolvedPath = path.resolve(path.dirname(sourceNode.filePath!), importSpec);
            }
            // Normalize and check if any component's filePath matches (with or without extension)
            const normalizedResolved = resolvedPath.replace(/\\/g, "/");
            for (const [, targetNode] of componentNodeMap) {
              if (targetNode.id === sourceNode.id) continue;
              const normalizedTarget = (targetNode.filePath ?? "").replace(/\\/g, "/");
              // Match with or without extension
              if (
                normalizedTarget === normalizedResolved ||
                normalizedTarget === normalizedResolved + ".tsx" ||
                normalizedTarget === normalizedResolved + ".ts" ||
                normalizedTarget.replace(/\.\w+$/, "") === normalizedResolved ||
                normalizedTarget.endsWith("/" + lastSegment + ".tsx") ||
                normalizedTarget.endsWith("/" + lastSegment + ".ts") ||
                normalizedTarget.endsWith("/" + lastSegment + "/index.tsx") ||
                normalizedTarget.endsWith("/" + lastSegment + "/index.ts")
              ) {
                edges.push(edge(sourceNode.id, targetNode.id, "DEPENDS_ON", "imports"));
                break;
              }
            }
          }
        }
      }
    }

    return { nodes, edges };
  },

  async _collectCycleEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("operational_cycle") && !types.includes("program")) return { nodes: [], edges: [] };
    const orgFilter = isSuperAdmin ? undefined : or(eq(operationalCycles.organizationId, orgId), isNull(operationalCycles.organizationId));
    // Always use "operational_cycle" as node type — status is metadata, not identity
    const rows = await db.select().from(operationalCycles)
      .where(and(orgFilter, isNull(operationalCycles.deletedAt)))
      .limit(500);

    const nodes: CompositionNode[] = rows.map(c => ({
      id: nodeId("operational_cycle", c.id),
      type: "operational_cycle" as CompositionNodeType,
      label: c.name,
      description: c.objective ?? "Operational Period",
      group: "Strategy",
      dbId: c.id,
      metadata: { status: c.status, priority: c.priority, blueprintCount: c.blueprintCount },
    }));

    const edges: CompositionEdge[] = [];
    if (rows.length > 0) {
      const cycleIds = rows.map(c => c.id);
      const runs = await missionRunService.getRunsForCycles(cycleIds);

      const seen = new Set<string>();
      runs.forEach(run => {
        if (run.cycleId && run.missionId) {
          const edgeId = `cycle-${run.cycleId}-to-mission-${run.missionId}`;
          if (!seen.has(edgeId)) {
            edges.push(edge(nodeId("operational_cycle", run.cycleId), nodeId("mission", run.missionId), "TRIGGERS", "spawns"));
            seen.add(edgeId);
          }
        }
      });
    }

    return { nodes, edges };
  },

  async _collectAgentEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("agent") && !types.includes("supervisor")) return { nodes: [], edges: [] };
    const orgFilter = isSuperAdmin ? undefined : or(eq(jobs.organizationId, orgId), isNull(jobs.organizationId));
    const rows = await db.select().from(jobs).where(and(orgFilter, eq(jobs.isHidden, false))).limit(200);

    const nodes: CompositionNode[] = rows.map(j => ({
      id: nodeId(j.type === 'supervisor' ? "supervisor" : "agent", j.id), 
      type: (j.type === 'supervisor' ? "supervisor" : "agent") as CompositionNodeType, 
      label: j.name, group: "Agents", dbId: j.id,
      metadata: { jobType: j.type, tools: j.tool }
    }));

    const edges: CompositionEdge[] = [];
    const agentIds = rows.map(a => a.id);

    if (agentIds.length > 0) {
      const agentMissions = await db.select({ id: missions.id, agentId: missions.createdBy })
        .from(missions)
        .where(and(isNull(missions.deletedAt), or(eq(missions.organizationId, orgId), isNull(missions.organizationId))));

      agentMissions.forEach(m => {
        if (typeof m.agentId === 'string' && m.agentId.startsWith('agent-')) {
          const aId = parseInt(m.agentId.split('-')[1]);
          const target = rows.find(r => r.id === aId);
          if (target) {
            const type = target.type === 'supervisor' ? 'supervisor' : 'agent';
            edges.push(edge(nodeId(type, aId), nodeId("mission", m.id), "TRIGGERS", "launches"));
          }
        }
      });

      const agentPipelines = await db.select({ id: pipelines.id, agentId: pipelines.createdBy })
        .from(pipelines)
        .where(or(eq(pipelines.organizationId, orgId), isNull(pipelines.organizationId)));

      agentPipelines.forEach(p => {
        if (typeof p.agentId === 'string' && p.agentId.startsWith('agent-')) {
          const aId = parseInt(p.agentId.split('-')[1]);
          const target = rows.find(r => r.id === aId);
          if (target) {
            const type = target.type === 'supervisor' ? 'supervisor' : 'agent';
            edges.push(edge(nodeId(type, aId), nodeId("pipeline", p.id), "TRIGGERS", "oversees"));
          }
        }
      });

      rows.filter(r => r.type === 'supervisor').forEach(s => {
        const config = s.config as any;
        if (config?.allowedPipelines && Array.isArray(config.allowedPipelines)) {
          config.allowedPipelines.forEach((pid: number) => {
            edges.push(edge(nodeId("supervisor", s.id), nodeId("pipeline", pid), "TRIGGERS", "can execute"));
          });
        }
      });

      // Skill nodes and agent→skill edges are built by _collectSkillEntities to avoid duplication
    }

    return { nodes, edges };
  },

  async _collectModuleEntities(types?: CompositionNodeType[]): Promise<{ nodes: CompositionNode[]; edges: CompositionEdge[] }> {
    if (types && !types.includes("npm_module")) return { nodes: [], edges: [] };

    const projectRoot = path.resolve(process.cwd());
    const nodes: CompositionNode[] = [];
    const edges: CompositionEdge[] = [];

    // Discover domain modules from server/domain/ subdirectories
    const serverDomainDir = path.join(projectRoot, "server", "domain");
    const domainModules = await discoverDomainModules(serverDomainDir);

    for (const mod of domainModules) {
      nodes.push({
        id: `npm_module::${mod.name}`,
        type: "npm_module",
        label: mod.name,
        filePath: mod.dirPath,
        group: mod.group,
      });
    }

    // Discover workspace packages from root package.json
    const packageJsonPath = path.join(projectRoot, "package.json");
    const workspacePackages = await discoverWorkspacePackages(packageJsonPath);

    for (const pkg of workspacePackages) {
      nodes.push({
        id: `npm_module::${pkg.name}`,
        type: "npm_module",
        label: pkg.name,
        filePath: pkg.dirPath,
        group: pkg.group,
      });
    }

    // Build DEPENDS_ON edges between domain modules using cross-module import detection
    if (domainModules.length > 0) {
      const allModuleNames = domainModules.map(m => m.name);

      for (const mod of domainModules) {
        let referencedModules: string[];
        try {
          referencedModules = await detectCrossModuleImports(mod.dirPath, allModuleNames);
        } catch (err: any) {
          logger.warn(`[XrayComposition] Failed to detect cross-module imports for module "${mod.name}"`, { error: err.message });
          continue;
        }

        for (const refName of referencedModules) {
          edges.push(edge(
            `npm_module::${mod.name}`,
            `npm_module::${refName}`,
            "DEPENDS_ON",
            "imports"
          ));
        }
      }
    }

    return { nodes, edges };
  },

  async _buildCrossCollectorEdges(
    screens: CompositionNode[],
    endpoints: CompositionNode[],
    components: CompositionNode[],
    modules: CompositionNode[]
  ): Promise<CompositionEdge[]> {
    const edges: CompositionEdge[] = [];

    // Build a lookup of endpoint paths for CALLS_API matching
    // Endpoint labels have format "GET /api/missions", extract the path portion
    const endpointPathMap = new Map<string, CompositionNode>();
    for (const ep of endpoints) {
      // Label format: "METHOD /path" — extract just the path
      const spaceIdx = ep.label.indexOf(" ");
      if (spaceIdx > 0) {
        const epPath = ep.label.slice(spaceIdx + 1);
        endpointPathMap.set(epPath, ep);
      }
    }

    // Build a lookup of component names for RENDERS matching
    const componentNameMap = new Map<string, CompositionNode>();
    for (const comp of components) {
      componentNameMap.set(comp.label, comp);
    }

    // For each screen node, read its source file to discover CALLS_API and RENDERS edges
    for (const screen of screens) {
      if (!screen.filePath) continue;

      let content: string;
      try {
        content = await fs.readFile(screen.filePath, "utf-8");
      } catch {
        // File unreadable — skip gracefully
        continue;
      }

      // CALLS_API edges: match fetch/axios calls to known endpoint paths
      // Patterns: fetch("/api/..."), axios.get("/api/..."), axios.post("/api/..."), etc.
      const apiCallPattern = /(?:fetch|axios\.(?:get|post|put|delete|patch))\s*\(\s*["'`]([^"'`]+)["'`]/gi;
      let match: RegExpExecArray | null;
      const seenEndpoints = new Set<string>();

      while ((match = apiCallPattern.exec(content)) !== null) {
        const calledPath = match[1];
        // Look for an exact match in our endpoint path map
        if (endpointPathMap.has(calledPath) && !seenEndpoints.has(calledPath)) {
          const targetNode = endpointPathMap.get(calledPath)!;
          edges.push(edge(screen.id, targetNode.id, "CALLS_API", `calls ${calledPath}`));
          seenEndpoints.add(calledPath);
        }
      }

      // RENDERS edges: match import statements to known component names
      const importPattern = /import\s+(?:{([^}]+)}|(\w+))\s+from\s+["']([^"']+)["']/g;
      const seenComponents = new Set<string>();

      while ((match = importPattern.exec(content)) !== null) {
        const namedImports = match[1]; // e.g., "Button, Card"
        const defaultImport = match[2]; // e.g., "Dashboard"

        const importedNames: string[] = [];
        if (namedImports) {
          importedNames.push(...namedImports.split(",").map(n => n.trim().split(/\s+as\s+/).pop()!.trim()));
        }
        if (defaultImport) {
          importedNames.push(defaultImport);
        }

        for (const name of importedNames) {
          if (componentNameMap.has(name) && !seenComponents.has(name)) {
            const targetNode = componentNameMap.get(name)!;
            edges.push(edge(screen.id, targetNode.id, "RENDERS", `renders ${name}`));
            seenComponents.add(name);
          }
        }
      }
    }

    // PART_OF edges: api_endpoint → npm_module (endpoint filePath within module directory)
    for (const ep of endpoints) {
      if (!ep.filePath) continue;
      const normalizedEpPath = ep.filePath.replace(/\\/g, "/");

      for (const mod of modules) {
        if (!mod.filePath) continue;
        const normalizedModPath = mod.filePath.replace(/\\/g, "/");
        // Check if the endpoint's file resides within the module's directory
        if (normalizedEpPath.startsWith(normalizedModPath + "/") || normalizedEpPath.startsWith(normalizedModPath + "\\")) {
          edges.push(edge(ep.id, mod.id, "PART_OF", `part of ${mod.label}`));
          break; // An endpoint belongs to at most one module
        }
      }
    }

    return edges;
  },

  async _fetchSystemGraph(nodes: CompositionNode[], orgId: number, isSuperAdmin?: boolean): Promise<CompositionEdge[]> {
    const orgFilter = isSuperAdmin ? undefined : or(eq(knowledgeNodes.organizationId, orgId), isNull(knowledgeNodes.organizationId));

    const FINGERPRINT_TYPE: Record<string, string> = {
      job_definition: "job",
      agent: "job",
      supervisor: "job",
      knowledge_cluster: "knowledge",
      operational_cycle: "cycle",
      program: "cycle",   // program is an active cycle — same fingerprint namespace
      skill: "skill",
      mission: "mission",
      pipeline: "pipeline",
      dataset: "dataset",
      screen: "screen",
      api_endpoint: "api",
      ui_component: "component",
      npm_module: "npm",
    };

    const nodeToFingerprint = new Map<string, string>();
    nodes.forEach(n => {
      const [type, dbId] = n.id.split("::");
      const fType = FINGERPRINT_TYPE[type] ?? type;
      nodeToFingerprint.set(n.id, `xray:${fType}:${dbId}`);
    });

    const fingerprints = Array.from(nodeToFingerprint.values());
    if (!fingerprints.length) return [];

    const kNodes = await db.select({ id: knowledgeNodes.id, fingerprint: knowledgeNodes.fingerprint })
      .from(knowledgeNodes)
      .where(and(inArray(knowledgeNodes.fingerprint, fingerprints), orgFilter));
    
    if (!kNodes.length) return [];

    const kNodeIdToFingerprint = new Map(kNodes.map(kn => [kn.id, kn.fingerprint]));
    const fingerprintToNodeId = new Map(Array.from(nodeToFingerprint.entries()).map(([k, v]) => [v, k]));
    
    const kEdges = await db.select().from(knowledgeEdges)
      .where(and(inArray(knowledgeEdges.sourceId, kNodes.map(n => n.id)), inArray(knowledgeEdges.targetId, kNodes.map(n => n.id))));

    const edges: CompositionEdge[] = [];
    for (const ke of kEdges) {
      const srcF = kNodeIdToFingerprint.get(ke.sourceId);
      const tgtF = kNodeIdToFingerprint.get(ke.targetId);
      if (srcF && tgtF) {
        const srcN = fingerprintToNodeId.get(srcF);
        const tgtN = fingerprintToNodeId.get(tgtF);
        if (srcN && tgtN) {
          edges.push(edge(srcN, tgtN, ke.relation as any, ke.relation.toLowerCase().replace(/_/g, " ")));
        }
      }
    }
    return edges;
  },

  async _expandAppEcosystem(nodes: CompositionNode[], edges: CompositionEdge[], orgId: number) {
    if (!nodes.length) return;

    const FINGERPRINT_TYPE: Record<string, string> = {
      job_definition: "job",
      agent: "job",
      supervisor: "job",
      knowledge_cluster: "knowledge",
      operational_cycle: "cycle",
      program: "cycle",
      skill: "skill",
      mission: "mission",
      pipeline: "pipeline",
      dataset: "dataset",
      screen: "screen",
      api_endpoint: "api",
      ui_component: "component",
      npm_module: "npm",
    };

    const fingerprints = nodes.map(n => {
      const [type, dbId] = n.id.split("::");
      const fType = FINGERPRINT_TYPE[type] ?? type;
      return `xray:${fType}:${dbId}`;
    });

    if (!fingerprints.length) return;

    const kNodes = await db.select({ id: knowledgeNodes.id, fingerprint: knowledgeNodes.fingerprint })
      .from(knowledgeNodes)
      .where(and(
        inArray(knowledgeNodes.fingerprint, fingerprints),
        or(eq(knowledgeNodes.organizationId, orgId), isNull(knowledgeNodes.organizationId))
      ));

    if (!kNodes.length) return;
    const seedKIds = kNodes.map(k => k.id);

    const kEdges = await db.select().from(knowledgeEdges)
      .where(or(
        inArray(knowledgeEdges.sourceId, seedKIds),
        inArray(knowledgeEdges.targetId, seedKIds)
      ));

    if (!kEdges.length) return;

    const connectedKIds = Array.from(new Set(kEdges.flatMap(e => [e.sourceId, e.targetId])));
    const neighborKNodes = await db.select().from(knowledgeNodes)
      .where(inArray(knowledgeNodes.id, connectedKIds));

    const kIdToCompNode = new Map<number, CompositionNode>();
    
    kNodes.forEach(kn => {
      const existing = nodes.find(n => {
        const [t, d] = n.id.split("::");
        const fType = FINGERPRINT_TYPE[t] ?? t;
        return `xray:${fType}:${d}` === kn.fingerprint;
      });
      if (existing) kIdToCompNode.set(kn.id, existing);
    });

    neighborKNodes.forEach(kn => {
      if (!kIdToCompNode.has(kn.id)) {
        const fp = kn.fingerprint ?? "";
        let compType: CompositionNodeType = "knowledge_cluster";
        if (fp.startsWith("xray:mission:")) compType = "mission";
        else if (fp.startsWith("xray:pipeline:")) compType = "pipeline";
        else if (fp.startsWith("xray:job:")) compType = "job_definition";
        else if (fp.startsWith("xray:api:")) compType = "api_endpoint";
        else if (fp.startsWith("xray:screen:")) compType = "screen";
        else if (fp.startsWith("xray:dataset:")) compType = "dataset";
        else if (fp.startsWith("xray:npm:")) compType = "npm_module";

        const rawId = fp.split(":").pop() || String(kn.id);
        const compId = nodeId(compType, rawId);
        
        const newNode: CompositionNode = {
          id: compId,
          type: compType,
          label: kn.name || kn.label,
          description: (kn.data as any)?.description ?? `${kn.label} Node`,
          group: compType === "mission" ? "Missions" : compType === "pipeline" ? "Pipelines" : compType === "job_definition" ? "Jobs" : compType === "dataset" ? "Datasets" : "Components"
        };

        if (!nodes.some(n => n.id === compId)) {
          nodes.push(newNode);
        }
        kIdToCompNode.set(kn.id, newNode);
      }
    });

    kEdges.forEach(ke => {
      const srcNode = kIdToCompNode.get(ke.sourceId);
      const tgtNode = kIdToCompNode.get(ke.targetId);
      if (srcNode && tgtNode) {
        const eId = `${srcNode.id}→${tgtNode.id}:${ke.relation}`;
        if (!edges.some(e => e.id === eId)) {
          edges.push({
            id: eId,
            source: srcNode.id,
            target: tgtNode.id,
            relation: ke.relation as any,
            label: ke.relation.toLowerCase().replace(/_/g, " ")
          });
        }
      }
    });
  },

  async _buildModuleRelationships(nodes: CompositionNode[], edges: CompositionEdge[]) {
    const modules = nodes.filter(n => n.type === "npm_module");
    if (!modules.length) return;

    const nonModuleNodes = nodes.filter(n => n.type !== "npm_module");

    // 1. Map component file paths to domain modules (PART_OF)
    for (const node of nonModuleNodes) {
      if (!node.filePath) continue;
      const normalizedPath = node.filePath.replace(/\\/g, "/");

      for (const mod of modules) {
        if (!mod.filePath) continue;
        const normalizedModPath = mod.filePath.replace(/\\/g, "/");
        const modDir = path.dirname(normalizedModPath);

        if (normalizedPath.startsWith(modDir + "/") || normalizedPath.startsWith(normalizedModPath)) {
          const edgeId = `${node.id}→${mod.id}:PART_OF`;
          if (!edges.some(e => e.id === edgeId)) {
            edges.push(edge(node.id, mod.id, "PART_OF", `belongs to module ${mod.label}`));
          }
          break;
        }
      }
    }

    // 2. Scan imports for module dependencies (IMPORTS / DEPENDS_ON)
    for (const node of nodes) {
      if (!node.filePath) continue;
      try {
        const content = await fs.readFile(node.filePath, "utf-8");
        const importPattern = /import\s+.*?from\s+["']([^"']+)["']/g;
        let match: RegExpExecArray | null;

        while ((match = importPattern.exec(content)) !== null) {
          const importSpecifier = match[1];
          for (const mod of modules) {
            if (mod.id === node.id) continue;
            const modName = mod.label.toLowerCase();

            if (
              importSpecifier.includes(`/${modName}/`) || 
              importSpecifier.endsWith(`/${modName}`) ||
              importSpecifier.includes(`@domain/${modName}`) ||
              importSpecifier.includes(`@domain-ui/${modName}`)
            ) {
              const rel = node.type === "npm_module" ? "DEPENDS_ON" : "IMPORTS";
              const edgeId = `${node.id}→${mod.id}:${rel}`;
              if (!edges.some(e => e.id === edgeId)) {
                edges.push(edge(node.id, mod.id, rel as any, `${rel.toLowerCase()} ${mod.label}`));
              }
            }
          }
        }
      } catch { }
    }
  },

  async _collectOntologyTypeEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("ontology_object_type")) return { nodes: [], edges: [] };
    
    try {
      const { ontologyObjectTypes } = await import("@shared/schema/ontology/ontology.js");
      const { getAdapter } = await import("@domain/knowledge/core/ontology-adapters.js");
      const orgFilter = isSuperAdmin ? undefined : or(eq(ontologyObjectTypes.organizationId, orgId), isNull(ontologyObjectTypes.organizationId));
      const rows = await db.select().from(ontologyObjectTypes).where(and(orgFilter, eq(ontologyObjectTypes.isActive, true))).limit(200);

      const nodes: CompositionNode[] = rows.map(ot => {
        const adapter = ot.backing === "virtual" && ot.sourceAdapter ? getAdapter(ot.sourceAdapter) : undefined;
        const properties = adapter ? adapter.properties : ((ot.propertiesSchema as Record<string, string>) ?? {});
        const titleProperty = adapter ? adapter.titleProperty : ot.titleProperty;

        return {
          id: nodeId("ontology_object_type", ot.id), 
          type: "ontology_object_type", 
          label: ot.name,
          description: ot.description ?? `Business object type: ${ot.backing} (${ot.sourceAdapter || 'materialized'})`,
          group: "Ontology Types", 
          dbId: ot.id,
          metadata: { 
            backing: ot.backing, 
            sourceAdapter: ot.sourceAdapter,
            titleProperty,
            properties,
            propertyCount: Object.keys(properties).length,
            icon: ot.icon,
          }
        };
      });

      const edges: CompositionEdge[] = [];
      // Bridge Knowledge Entity virtual type to Knowledge Cluster if present
      const kgType = rows.find(r => r.sourceAdapter === "knowledge_graph" || r.name === "Knowledge Entity");
      if (kgType) {
        const [kgTopic] = await db.select({ id: knowledgeTopics.id }).from(knowledgeTopics).where(orgFilter).limit(1);
        if (kgTopic) {
          edges.push(edge(
            nodeId("ontology_object_type", kgType.id),
            nodeId("knowledge_cluster", kgTopic.id),
            "BRIDGES_KG",
            "bridges knowledge graph"
          ));
        }
      }

      return { nodes, edges };
    } catch (err: any) {
      logger.warn("[XrayComposition] Ontology type collection failed (table may not exist yet)", { error: err.message });
      return { nodes: [], edges: [] };
    }
  },

  async _collectOntologyActionEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("ontology_action")) return { nodes: [], edges: [] };
    
    try {
      const { ontologyActions, ontologyObjectTypes } = await import("@shared/schema/ontology/ontology.js");
      const orgFilter = isSuperAdmin ? undefined : or(eq(ontologyActions.organizationId, orgId), isNull(ontologyActions.organizationId));
      const rows = await db.select().from(ontologyActions).where(and(orgFilter, eq(ontologyActions.isActive, true))).limit(500);

      const nodes: CompositionNode[] = rows.map(oa => ({
        id: nodeId("ontology_action", oa.id), 
        type: "ontology_action", 
        label: oa.name,
        description: oa.description ?? `Governed action: ${oa.effect} (${oa.handlerKind})`,
        group: "Ontology Actions", 
        dbId: oa.id,
        metadata: { 
          effect: oa.effect, 
          handlerKind: oa.handlerKind,
          handlerRef: oa.handlerRef,
          requiresApproval: oa.requiresApproval,
          riskLevel: oa.riskLevel,
          objectTypeId: oa.objectTypeId,
          parametersSchema: oa.parametersSchema,
        }
      }));

      // Build edges from actions to their object types and underlying pipeline handlers
      const edges: CompositionEdge[] = [];
      const typeIds = new Set(rows.filter(r => r.objectTypeId).map(r => r.objectTypeId!));
      if (typeIds.size > 0) {
        const typeRows = await db.select({ id: ontologyObjectTypes.id, name: ontologyObjectTypes.name })
          .from(ontologyObjectTypes)
          .where(inArray(ontologyObjectTypes.id, Array.from(typeIds)));
        
        const typeMap = new Map(typeRows.map(t => [t.id, t.name]));
        
        for (const action of rows) {
          if (action.objectTypeId && typeMap.has(action.objectTypeId)) {
            edges.push(edge(
              nodeId("ontology_action", action.id),
              nodeId("ontology_object_type", action.objectTypeId),
              "ACTS_ON",
              `action on ${typeMap.get(action.objectTypeId)}`
            ));
          }

          // If action handler is a pipeline, link to pipeline node
          if (action.handlerKind === "pipeline" && action.handlerRef) {
            const pipelineId = parseInt(action.handlerRef);
            if (!isNaN(pipelineId)) {
              edges.push(edge(
                nodeId("ontology_action", action.id),
                nodeId("pipeline", pipelineId),
                "TRIGGERS",
                "executes pipeline"
              ));
            }
          }
        }
      }

      return { nodes, edges };
    } catch (err: any) {
      logger.warn("[XrayComposition] Ontology action collection failed (table may not exist yet)", { error: err.message });
      return { nodes: [], edges: [] };
    }
  },

  async _collectOntologyLinkTypeEntities(orgId: number, types?: CompositionNodeType[], isSuperAdmin?: boolean) {
    if (types && !types.includes("ontology_link_type")) return { nodes: [], edges: [] };
    
    try {
      const { ontologyLinkTypes, ontologyObjectTypes } = await import("@shared/schema/ontology/ontology.js");
      const orgFilter = isSuperAdmin ? undefined : or(eq(ontologyLinkTypes.organizationId, orgId), isNull(ontologyLinkTypes.organizationId));
      const rows = await db.select().from(ontologyLinkTypes).where(and(orgFilter, eq(ontologyLinkTypes.isActive, true))).limit(200);

      const nodes: CompositionNode[] = rows.map(olt => ({
        id: nodeId("ontology_link_type", olt.id), 
        type: "ontology_link_type", 
        label: `${olt.name} (${olt.inverseName})`,
        description: olt.description ?? `Relationship: ${olt.cardinality}, ${olt.backing}`,
        group: "Ontology Link Types", 
        dbId: olt.id,
        metadata: { 
          cardinality: olt.cardinality, 
          backing: olt.backing,
          sourceTypeId: olt.sourceTypeId,
          targetTypeId: olt.targetTypeId,
          sourceProperty: olt.sourceProperty,
          targetProperty: olt.targetProperty,
          targetTypeProperty: olt.targetTypeProperty,
          targetTypeMap: olt.targetTypeMap,
          path: olt.path,
        }
      }));

      // Build edges from link types to source and target (including polymorphic mappings)
      const edges: CompositionEdge[] = [];
      const allTypeRows = await db.select({ id: ontologyObjectTypes.id, name: ontologyObjectTypes.name })
        .from(ontologyObjectTypes)
        .where(orgFilter);
      
      const typeMap = new Map(allTypeRows.map(t => [t.id, t.name]));
      const typeNameToId = new Map(allTypeRows.map(t => [t.name, t.id]));
      
      for (const linkType of rows) {
        if (linkType.sourceTypeId && typeMap.has(linkType.sourceTypeId)) {
          edges.push(edge(
            nodeId("ontology_link_type", linkType.id),
            nodeId("ontology_object_type", linkType.sourceTypeId),
            "DEFINES_FORWARD",
            `from ${typeMap.get(linkType.sourceTypeId)}`
          ));
        }
        if (linkType.targetTypeId && typeMap.has(linkType.targetTypeId)) {
          edges.push(edge(
            nodeId("ontology_link_type", linkType.id),
            nodeId("ontology_object_type", linkType.targetTypeId),
            "DEFINES_REVERSE",
            `to ${typeMap.get(linkType.targetTypeId)}`
          ));
        } else if (linkType.targetTypeId == null && linkType.targetTypeMap && typeof linkType.targetTypeMap === "object") {
          // Polymorphic link: map each target type
          for (const [discVal, targetTypeName] of Object.entries(linkType.targetTypeMap as Record<string, string>)) {
            const targetId = typeNameToId.get(targetTypeName);
            if (targetId) {
              edges.push(edge(
                nodeId("ontology_link_type", linkType.id),
                nodeId("ontology_object_type", targetId),
                "TARGETS_OBJECT_TYPE",
                `polymorphic to ${targetTypeName} (${discVal})`
              ));
            }
          }
        }
      }

      return { nodes, edges };
    } catch (err: any) {
      logger.warn("[XrayComposition] Ontology link type collection failed (table may not exist yet)", { error: err.message });
      return { nodes: [], edges: [] };
    }
  },

  async _collectAppEntities(slug: string, appId: number | undefined, orgId: number, nodes: CompositionNode[], edges: CompositionEdge[]) {
    let app: any = null;
    try {
      const [appRow] = appId 
        ? await db.select().from(apps).where(eq(apps.id, appId)).limit(1)
        : await db.select().from(apps).where(eq(apps.slug, slug)).limit(1);
      app = appRow;
    } catch { }

    const appName = app ? app.name : slug.replace(/-/g, " ");
    const appSlug = app ? app.slug : slug;
    const blueprintSlug = app?.blueprintSlug ?? "";
    const nameSlug = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    
    const rawWords = [
      appSlug,
      nameSlug,
      blueprintSlug,
      ...appSlug.split("-"),
      ...nameSlug.split("-"),
      ...(blueprintSlug ? blueprintSlug.split("-") : [])
    ];
    
    const words = Array.from(new Set(rawWords)).filter(w => w && w.length >= 3 && !["app", "the", "for", "and", "master"].includes(w));

    // Root App Screen Node
    const appScreenId = nodeId("screen", `/${slug}`);
    if (!nodes.some(n => n.id === appScreenId)) {
      nodes.push({
        id: appScreenId,
        type: "screen",
        label: `${appName} (App & Blueprint Head)`,
        description: app?.description ?? `Primary interface head for ${appName}`,
        group: "Screens",
        filePath: `server/domain/apps/${slug}`,
        dbId: app?.id
      });
    }

    // 0. Extract Living Blueprint & App Config Entities
    if (app) {
      const devPlan: any = app.developmentPlan ?? {};
      const appConfig: any = app.config ?? {};

      // A. API Endpoints from Living Blueprint / Config
      const planEndpoints = [
        ...(Array.isArray(devPlan.apiRoutes) ? devPlan.apiRoutes : []),
        ...(Array.isArray(devPlan.endpoints) ? devPlan.endpoints : []),
        ...(Array.isArray(devPlan.routes) ? devPlan.routes : []),
        ...(Array.isArray(appConfig.apiEndpoints) ? appConfig.apiEndpoints : []),
        ...(Array.isArray(appConfig.routes) ? appConfig.routes : [])
      ];
      planEndpoints.forEach((ep: any) => {
        const route = typeof ep === "string" ? ep : (ep.path ?? ep.route ?? ep.url ?? `/api/${slug}`);
        const method = typeof ep === "object" ? (ep.method ?? "GET") : "GET";
        const epId = nodeId("api_endpoint", `${method}-${route}`);
        if (!nodes.some(n => n.id === epId)) {
          nodes.push({ id: epId, type: "api_endpoint", label: `${method} ${route}`, group: "API Endpoints" });
          edges.push(edge(appScreenId, epId, "CALLS_API", `calls ${route}`));
        }
      });

      // B. UI Components from Living Blueprint / Config
      const planComponents = [
        ...(Array.isArray(devPlan.components) ? devPlan.components : []),
        ...(Array.isArray(devPlan.uiComponents) ? devPlan.uiComponents : []),
        ...(Array.isArray(appConfig.components) ? appConfig.components : [])
      ];
      planComponents.forEach((c: any) => {
        const cName = typeof c === "string" ? c : (c.name ?? c.label ?? "UI Component");
        const compId = nodeId("ui_component", cName);
        if (!nodes.some(n => n.id === compId)) {
          nodes.push({ id: compId, type: "ui_component", label: cName, group: "Components" });
          edges.push(edge(appScreenId, compId, "RENDERS", `renders ${cName}`));
        }
      });

      // C. Domain Modules & Services from Living Blueprint / Config
      const planServices = [
        ...(Array.isArray(devPlan.modules) ? devPlan.modules : []),
        ...(Array.isArray(devPlan.services) ? devPlan.services : []),
        ...(Array.isArray(appConfig.modules) ? appConfig.modules : [])
      ];
      planServices.forEach((s: any) => {
        const sName = typeof s === "string" ? s : (s.name ?? s.label ?? "Service");
        const modId = nodeId("npm_module", sName);
        if (!nodes.some(n => n.id === modId)) {
          nodes.push({ id: modId, type: "npm_module", label: sName, group: "Modules" });
          edges.push(edge(appScreenId, modId, "PART_OF", `powered by ${sName}`));
        }
      });

      // D. Datasets & Database Tables from Living Blueprint / Config
      const planTables = [
        ...(Array.isArray(devPlan.databaseTables) ? devPlan.databaseTables : []),
        ...(Array.isArray(devPlan.datasets) ? devPlan.datasets : []),
        ...(Array.isArray(appConfig.datasets) ? appConfig.datasets : [])
      ];
      planTables.forEach((d: any) => {
        const dName = typeof d === "string" ? d : (d.name ?? d.tableName ?? "Dataset");
        const dsId = nodeId("dataset", dName);
        if (!nodes.some(n => n.id === dsId)) {
          nodes.push({ id: dsId, type: "dataset", label: dName, group: "Datasets" });
          edges.push(edge(appScreenId, dsId, "READS_FROM", `reads ${dName}`));
        }
      });
    }

    // 1. Gather code workspace files from candidate directories
    const candidateDirs = new Set<string>([
      path.join(FORGE_WORKSPACE, slug),
      path.join(process.cwd(), "server", "domain", slug),
      path.join(process.cwd(), "server", "domain", `${slug}-pipeline`),
      path.join(process.cwd(), "client", "src", "modules", slug)
    ]);

    for (const w of words) {
      candidateDirs.add(path.join(process.cwd(), "server", "domain", w));
      candidateDirs.add(path.join(process.cwd(), "client", "src", "modules", w));
    }

    for (const workspacePath of Array.from(candidateDirs)) {
      try {
        const allFiles = await listSourceFiles(workspacePath);
        if (allFiles.length > 0) {
          logger.info(`[XrayComposition] Discovered ${allFiles.length} source files for app scope [${slug}] in ${workspacePath}`);

          for (const f of allFiles) {
            const fullPath = path.join(workspacePath, f);
            const baseName = path.basename(f).replace(/\.(tsx?|jsx?)$/, "");

            if (f.endsWith(".route.ts") || f.endsWith(".route.js") || f.includes("/api/")) {
              const methods = await this._detectApiMethods(fullPath);
              const routeName = `/api/${slug}/${baseName.replace(/\.route$/, "")}`;
              for (const m of methods) {
                const epId = nodeId("api_endpoint", `${m}-${routeName}`);
                if (!nodes.some(n => n.id === epId)) {
                  nodes.push({ id: epId, type: "api_endpoint", label: `${m} ${routeName}`, filePath: fullPath, group: "API Endpoints" });
                  edges.push(edge(appScreenId, epId, "CALLS_API", `calls ${routeName}`));
                }
              }
            } else if (f.endsWith(".service.ts") || f.endsWith("compiler.ts") || f.endsWith("guardrail.ts") || f.includes("/core/")) {
              const modId = nodeId("npm_module", baseName);
              if (!nodes.some(n => n.id === modId)) {
                nodes.push({ id: modId, type: "npm_module", label: baseName, filePath: fullPath, group: "Modules" });
              }
            } else if (f.endsWith(".tsx") || f.endsWith(".jsx")) {
              const compId = nodeId("ui_component", baseName);
              if (!nodes.some(n => n.id === compId)) {
                nodes.push({ id: compId, type: "ui_component", label: baseName, filePath: fullPath, group: "Components" });
              }
            }
          }
        }
      } catch { }
    }

    // 2. Scan server/routes files for endpoints matching app keywords
    try {
      const routesDir = path.join(process.cwd(), "server", "routes");
      const routeFiles = await fs.readdir(routesDir);
      for (const rf of routeFiles) {
        if (rf.startsWith("_") || (!rf.endsWith(".ts") && !rf.endsWith(".js"))) continue;
        const fullPath = path.join(routesDir, rf);
        const routeBaseName = rf.replace(/\.(route\.)?ts$/, "").toLowerCase();

        const isMatch = words.some(w => routeBaseName.includes(w) || (w.length >= 4 && routeBaseName.includes(w.substring(0, 4))));
        if (isMatch) {
          const methods = await this._detectApiMethods(fullPath);
          const baseRoute = `/api/${routeBaseName}`;
          for (const m of methods) {
            const epId = nodeId("api_endpoint", `${m}-${baseRoute}`);
            if (!nodes.some(n => n.id === epId)) {
              nodes.push({
                id: epId,
                type: "api_endpoint",
                label: `${m} ${baseRoute}`,
                filePath: fullPath,
                group: "API Endpoints"
              });
              edges.push(edge(appScreenId, epId, "CALLS_API", `calls ${baseRoute}`));
            }
          }
        }
      }
    } catch { }

    // 2. Query database entities associated with this app/blueprint
    try {
      const targetAppId = app?.id ?? appId;

      // A. Operational Cycles
      const cycleRows = await db.select().from(operationalCycles).where(
        and(
          eq(operationalCycles.organizationId, orgId),
          or(
            eq(operationalCycles.name, appName),
            ...words.map(w => ilike(operationalCycles.name, `%${w}%`))
          ),
          isNull(operationalCycles.deletedAt)
        )
      ).limit(50);

      cycleRows.forEach(c => {
        if (!nodes.some(n => n.id === nodeId("operational_cycle", c.id))) {
          nodes.push({
            id: nodeId("operational_cycle", c.id),
            type: "operational_cycle",
            label: c.name,
            description: c.objective ?? "Operational Period",
            group: "Strategy",
            dbId: c.id,
            metadata: { status: c.status, priority: c.priority, blueprintCount: c.blueprintCount },
          });
        }
      });
      const cycleIds = cycleRows.map(c => c.id);

      // B. Jobs (Agents / Supervisors)
      const jobFilters: any[] = [
        sql`config->>'sourceCycleSlug' = ${appSlug}`,
        sql`config->>'sourceCycleSlug' = ${appName}`,
        sql`config->>'sourceCycleSlug' = ${nameSlug}`,
        sql`config->>'cycleApp' = ${appName}`,
        sql`config->>'cycleApp' = ${appSlug}`,
        sql`config->>'cycleApp' = ${nameSlug}`
      ];
      if (targetAppId) jobFilters.push(sql`config->>'appId' = ${String(targetAppId)}`);
      words.forEach(w => {
        jobFilters.push(ilike(jobs.name, `%${w}%`));
        jobFilters.push(ilike(jobs.description, `%${w}%`));
      });

      const jobRows = await db.select().from(jobs).where(
        and(
          eq(jobs.organizationId, orgId),
          eq(jobs.isHidden, false),
          or(...jobFilters)
        )
      ).limit(200);

      jobRows.forEach(j => {
        const jType = j.type === 'supervisor' ? "supervisor" : "agent";
        const jNodeId = nodeId(jType, j.id);
        if (!nodes.some(n => n.id === jNodeId)) {
          nodes.push({
            id: jNodeId, 
            type: jType as CompositionNodeType, 
            label: j.name,
            group: "Agents",
            dbId: j.id,
            metadata: { jobType: j.type, tools: j.tool }
          });
        }
      });
      const jobIds = jobRows.map(j => j.id);

      // C. Pipelines / Workflows
      const pipelineFilters: any[] = [
        sql`labels->>'cycleApp' = ${appName}`,
        sql`labels->>'cycleApp' = ${appSlug}`,
        sql`labels->>'cycleApp' = ${nameSlug}`,
        sql`labels->>'sourceCycleSlug' = ${appSlug}`,
        sql`labels->>'sourceCycleSlug' = ${appName}`,
        sql`labels->>'sourceCycleSlug' = ${nameSlug}`,
        like(pipelines.name, `${appName} — %`),
        like(pipelines.name, `${appName} - %`),
        like(pipelines.name, `${nameSlug} — %`),
        like(pipelines.name, `${nameSlug} - %`)
      ];
      if (targetAppId) pipelineFilters.push(sql`labels->>'appId' = ${String(targetAppId)}`);
      words.forEach(w => {
        pipelineFilters.push(ilike(pipelines.name, `%${w}%`));
        pipelineFilters.push(ilike(pipelines.description, `%${w}%`));
      });

      const pipelineRows = await db.select().from(pipelines).where(
        and(
          eq(pipelines.organizationId, orgId),
          or(...pipelineFilters)
        )
      ).limit(500);

      pipelineRows.forEach(p => {
        const pNodeId = nodeId("pipeline", p.id);
        if (!nodes.some(n => n.id === pNodeId)) {
          nodes.push({
            id: pNodeId,
            type: "pipeline",
            label: p.name,
            description: p.description ?? "Automation Pipeline",
            group: "Pipelines",
            dbId: p.id,
            metadata: { trigger: p.triggerType, status: p.isActive ? "active" : "inactive" }
          });
        }
      });
      const pipelineIds = pipelineRows.map(p => p.id);

      // D. Missions
      const missionFilters: any[] = [];
      words.forEach(w => {
        missionFilters.push(ilike(missions.name, `%${w}%`));
        missionFilters.push(ilike(missions.description, `%${w}%`));
        missionFilters.push(ilike(missions.objective, `%${w}%`));
      });

      const allMissionsForOrg = await db.select().from(missions).where(
        and(
          eq(missions.organizationId, orgId),
          isNull(missions.deletedAt),
          missionFilters.length > 0 ? or(...missionFilters) : undefined
        )
      ).limit(1000);

      allMissionsForOrg.forEach(m => {
        const mNodeId = nodeId("mission", m.id);
        if (!nodes.some(n => n.id === mNodeId)) {
          nodes.push({
            id: mNodeId,
            type: "mission",
            label: m.name,
            description: m.objective ?? "Active Mission",
            dbId: m.id,
            group: "Missions",
            metadata: { objective: m.objective, outcome: (m as any).outcomeSummary || "In Progress" }
          });
        }
      });
      const missionIds = allMissionsForOrg.map(m => m.id);

      // E. Datasets
      const datasetFilters: any[] = [
        sql`${appName} = ANY(tags)`,
        sql`${appSlug} = ANY(tags)`,
        sql`${nameSlug} = ANY(tags)`
      ];
      words.forEach(w => {
        datasetFilters.push(ilike(datasets.name, `%${w}%`));
        datasetFilters.push(ilike(datasets.description, `%${w}%`));
      });

      const datasetRows = await db.select().from(datasets).where(
        and(
          eq(datasets.organizationId, orgId),
          or(...datasetFilters)
        )
      ).limit(200);

      datasetRows.forEach(d => {
        const dNodeId = nodeId("dataset", d.id);
        if (!nodes.some(n => n.id === dNodeId)) {
          nodes.push({
            id: dNodeId,
            type: "dataset",
            label: d.name,
            description: d.description ?? "Data Asset",
            group: "Data",
            dbId: d.id,
            metadata: { tags: d.tags ?? [] },
          });
        }
      });
      const datasetIds = datasetRows.map(d => d.id);

      // F. Knowledge Clusters (Topics)
      const jobTopicIds = jobRows.map(j => j.outputKnowledgeTopicId).filter((id): id is number => id != null);
      const topicFilters: any[] = [];
      if (missionIds.length > 0) {
        topicFilters.push(inArray(knowledgeTopics.missionId, missionIds));
      }
      if (jobTopicIds.length > 0) {
        topicFilters.push(inArray(knowledgeTopics.id, jobTopicIds));
      }
      
      let knowledgeTopicIds: number[] = [];
      if (topicFilters.length > 0) {
        const knowledgeRows = await db.select().from(knowledgeTopics).where(
          and(
            eq(knowledgeTopics.organizationId, orgId),
            or(...topicFilters)
          )
        ).limit(100);
        
        knowledgeRows.forEach(k => {
          nodes.push({
            id: nodeId("knowledge_cluster", k.id),
            type: "knowledge_cluster",
            label: k.name,
            description: k.description ?? "Semantic Cluster",
            group: "Knowledge",
            dbId: k.id,
            metadata: {},
          });
        });
        knowledgeTopicIds = knowledgeRows.map(k => k.id);
      }

      // --- Edges between DB entities ---

      // 1. Pipeline -> Job (Agent / Supervisor)
      if (pipelineIds.length > 0) {
        const steps = await db.select().from(pipelineSteps).where(inArray(pipelineSteps.pipelineId, pipelineIds)).limit(1000);
        steps.forEach(s => {
          if (s.jobId) {
            const jobNodeIdAgent = nodeId("agent", s.jobId);
            const jobNodeIdSupervisor = nodeId("supervisor", s.jobId);
            const hasJob = nodes.some(n => n.id === jobNodeIdAgent || n.id === jobNodeIdSupervisor);
            if (hasJob) {
              const type = nodes.some(n => n.id === jobNodeIdSupervisor) ? "supervisor" : "agent";
              edges.push(edge(nodeId("pipeline", s.pipelineId), nodeId(type, s.jobId), "TRIGGERS", `step ${s.order}`));
            }
          }
        });
      }

      // 2. Mission -> Pipeline
      if (missionIds.length > 0) {
        const runs = await db.select({
          missionId: missionRuns.missionId,
          currentPipelineId: missionRuns.currentPipelineId,
          pipelineSequence: missionRuns.pipelineSequence
        })
        .from(missionRuns)
        .where(and(inArray(missionRuns.missionId, missionIds), isNull(missionRuns.deletedAt))).limit(500);
        
        const nodeSet = new Set(nodes.map(n => n.id));
        const seen = new Set<string>();
        runs.forEach(run => {
          if (run.missionId && run.currentPipelineId) {
            const pNodeExists = nodeSet.has(nodeId("pipeline", run.currentPipelineId!));
            if (pNodeExists) {
              const edgeId = `mission-${run.missionId}-to-pipeline-${run.currentPipelineId}`;
              if (!seen.has(edgeId)) {
                edges.push(edge(nodeId("mission", run.missionId!), nodeId("pipeline", run.currentPipelineId!), "TRIGGERS", "executes"));
                seen.add(edgeId);
              }
            }
          }
        });

        // Add blueprint links structurally
        allMissionsForOrg.forEach(m => {
          const wp = m.workflowBlueprint as any;
          if (wp && typeof wp === "object") {
            const pids: number[] = [];
            if (wp.pipelineId != null) pids.push(Number(wp.pipelineId));
            if (Array.isArray(wp.pipelineSequence)) wp.pipelineSequence.forEach((pid: any) => pids.push(Number(pid)));
            pids.forEach(pid => {
              const pNodeExists = nodeSet.has(nodeId("pipeline", pid));
              if (pNodeExists) {
                const edgeId = `mission-${m.id}-to-pipeline-${pid}`;
                if (!seen.has(edgeId)) {
                  edges.push(edge(nodeId("mission", m.id), nodeId("pipeline", pid), "TRIGGERS", "blueprint"));
                  seen.add(edgeId);
                }
              }
            });
          }
        });
      }

      // 3. Mission -> Cycle
      const cycleSeen = new Set<string>();
      if (cycleIds.length > 0 && missionIds.length > 0) {
        const cycleRuns = await db.select({
          missionId: missionRuns.missionId,
          cycleId: missionRuns.cycleId,
        })
        .from(missionRuns)
        .where(and(
          inArray(missionRuns.missionId, missionIds),
          inArray(missionRuns.cycleId, cycleIds),
          isNull(missionRuns.deletedAt)
        )).limit(500);
        
        cycleRuns.forEach(run => {
          if (run.cycleId && run.missionId) {
            const edgeId = `mission-${run.missionId}-belongs-cycle-${run.cycleId}`;
            if (!cycleSeen.has(edgeId)) {
              edges.push(edge(nodeId("mission", run.missionId), nodeId("operational_cycle", run.cycleId), "BELONGS_TO", "part of cycle"));
              cycleSeen.add(edgeId);
            }
          }
        });

        // Link all app missions to the cycle(s) structurally if not already linked by runs
        allMissionsForOrg.forEach(m => {
          cycleIds.forEach(cid => {
            const edgeId = `mission-${m.id}-belongs-cycle-${cid}`;
            if (!cycleSeen.has(edgeId)) {
              edges.push(edge(nodeId("mission", m.id), nodeId("operational_cycle", cid), "BELONGS_TO", "part of cycle"));
              cycleSeen.add(edgeId);
            }
          });
        });
      }

      // 4. Agent -> Mission
      if (missionIds.length > 0 && jobIds.length > 0) {
        const agentMissions = await db.select({ id: missions.id, agentId: missions.createdBy })
          .from(missions)
          .where(and(inArray(missions.id, missionIds), isNull(missions.deletedAt))).limit(500);
        agentMissions.forEach(m => {
          if (typeof m.agentId === 'string' && m.agentId.startsWith('agent-')) {
            const aId = parseInt(m.agentId.split('-')[1]);
            const targetJob = nodes.find(n => n.dbId === aId && (n.type === "agent" || n.type === "supervisor"));
            if (targetJob) {
              edges.push(edge(targetJob.id, nodeId("mission", m.id), "TRIGGERS", "launches"));
            }
          }
        });
      }

      // 5. Job -> Dataset (WRITES_TO)
      if (datasetIds.length > 0 && jobIds.length > 0) {
        const jobWrites = await db.select({ id: jobs.id, outputDatasetId: jobs.outputDatasetId, type: jobs.type })
          .from(jobs)
          .where(and(inArray(jobs.id, jobIds), isNotNull(jobs.outputDatasetId))).limit(500);
        jobWrites.forEach(j => {
          if (j.outputDatasetId && datasetIds.includes(j.outputDatasetId)) {
            const type = j.type === 'supervisor' ? 'supervisor' : 'agent';
            edges.push(edge(nodeId(type, j.id), nodeId("dataset", j.outputDatasetId), "WRITES_TO", "outputs to"));
          }
        });
      }

      // 6. Job -> Skill (HAS_SKILL)
      if (jobIds.length > 0) {
        const jobSkills = await db.select({ id: jobs.id, skillId: jobs.skillId, type: jobs.type })
          .from(jobs)
          .where(and(inArray(jobs.id, jobIds), isNotNull(jobs.skillId))).limit(500);
        const skillIds = jobSkills.map(j => j.skillId).filter(Boolean) as number[];
        if (skillIds.length > 0) {
          const skillRows = await db.select().from(skills).where(inArray(skills.id, skillIds)).limit(100);
          skillRows.forEach(s => {
            if (!nodes.some(n => n.id === nodeId("skill", s.id))) {
              nodes.push({
                id: nodeId("skill", s.id),
                type: "skill",
                label: s.name,
                description: s.description ?? "Skill",
                group: "Skills",
                dbId: s.id,
                metadata: { language: s.language, isPublic: s.isPublic },
              });
            }
          });
          jobSkills.forEach(j => {
            if (j.skillId) {
              const type = j.type === 'supervisor' ? 'supervisor' : 'agent';
              edges.push(edge(nodeId(type, j.id), nodeId("skill", j.skillId), "HAS_SKILL", "implements"));
            }
          });
        }
      }

      // 7. Job -> Knowledge Cluster (WRITES_TO)
      if (knowledgeTopicIds.length > 0 && jobIds.length > 0) {
        const jobWrites = await db.select({ id: jobs.id, outputKnowledgeTopicId: jobs.outputKnowledgeTopicId, type: jobs.type })
          .from(jobs)
          .where(and(inArray(jobs.id, jobIds), isNotNull(jobs.outputKnowledgeTopicId))).limit(500);
        jobWrites.forEach(j => {
          if (j.outputKnowledgeTopicId && knowledgeTopicIds.includes(j.outputKnowledgeTopicId)) {
            const type = j.type === 'supervisor' ? 'supervisor' : 'agent';
            edges.push(edge(nodeId(type, j.id), nodeId("knowledge_cluster", j.outputKnowledgeTopicId), "WRITES_TO", "stores to"));
          }
        });
      }

      // 8. Knowledge Graph Ecosystem Expansion (1-hop traversal)
      await this._expandAppEcosystem(nodes, edges, orgId);

    } catch (dbErr: any) {
      logger.error(`[XrayComposition] Database entity collect failed for slug ${slug}: ${dbErr.message}`, dbErr);
    }
  },

  /**
   * Adds reviewable frontend behaviors and E2E evidence to an app graph.
   * Specs opt in with `@xray-scope <app-slug>` and individual tests expose a
   * stable contract using `@behavior <behavior-id>`.
   */
  async _collectLinkedE2ETests(scope: string, nodes: CompositionNode[], edges: CompositionEdge[]) {
    const testsRoot = path.join(process.cwd(), "tests", "e2e");
    const appHeadId = nodeId("screen", `/${scope}`);
    let files: string[] = [];
    try {
      files = (await fs.readdir(testsRoot)).filter(file => file.endsWith(".spec.ts"));
    } catch {
      return;
    }

    for (const file of files) {
      const fullPath = path.join(testsRoot, file);
      let parsed;
      try {
        parsed = parseXrayE2ESpec(path.relative(process.cwd(), fullPath), await fs.readFile(fullPath, "utf-8"));
      } catch {
        continue;
      }
      if (!parsed || (parsed.scope !== scope && !parsed.scopeAliases.includes(scope))) continue;

      for (const test of parsed.tests) {
        const behaviorNodeId = nodeId("ui_behavior", test.behaviorId);
        const testNodeId = nodeId("e2e_test", test.id);
        if (!nodes.some(node => node.id === behaviorNodeId)) {
          nodes.push({
            id: behaviorNodeId,
            type: "ui_behavior",
            label: test.behaviorId,
            description: test.functionalDescription,
            group: "Verified Behaviors",
            metadata: {
              evidenceStatus: test.assertions.length > 0 ? "verified" : "observed",
              functionalDescription: test.functionalDescription,
              steps: test.steps,
              routes: test.routes,
              assertions: test.assertions,
              specificationPath: parsed.specificationPath,
            },
          });
        }
        if (!nodes.some(node => node.id === testNodeId)) {
          nodes.push({
            id: testNodeId,
            type: "e2e_test",
            label: test.title,
            description: "Playwright end-to-end verification",
            filePath: test.filePath,
            group: "E2E Tests",
            metadata: {
              behaviorId: test.behaviorId,
              startLine: test.startLine,
              routes: test.routes,
              assertions: test.assertions,
              functionalDescription: test.functionalDescription,
              steps: test.steps,
              evidenceStatus: "verified",
              specificationPath: parsed.specificationPath,
            },
          });
        }
        edges.push(edge(appHeadId, behaviorNodeId, "COVERS", "defines interface behavior"));
        edges.push(edge(behaviorNodeId, testNodeId, "VERIFIED_BY", "verified by Playwright"));
      }
    }
  },

  /**
   * Scans pages/api/ in a forged app workspace and produces api_endpoint CompositionNodes.
   * Handles Next.js dynamic route segments: [id] → :id, [...slug] → :slug*, [[...slug]] → :slug*?
   * Detects exported HTTP methods via named exports (App Router) or req.method switches (Pages Router).
   */
  async _collectAppApiEndpoints(workspacePath: string, allFiles: string[]): Promise<CompositionNode[]> {
    const nodes: CompositionNode[] = [];
    const apiFiles = allFiles.filter(f => f.startsWith("pages/api/") && !f.includes("/_"));

    for (const f of apiFiles) {
      // Derive route path from file path
      const routeSegment = f
        .replace(/^pages\/api\//, "")
        .replace(/\.(tsx?|jsx?)$/, "")
        .replace(/\/index$/, "");

      const apiRoute = "/api/" + this._convertDynamicSegments(routeSegment);

      // Detect exported HTTP methods from the file
      const filePath = path.join(workspacePath, f);
      const methods = await this._detectApiMethods(filePath);

      for (const method of methods) {
        const endpointId = nodeId("api_endpoint", `${method}-${apiRoute}`);
        nodes.push({
          id: endpointId,
          type: "api_endpoint",
          label: `${method} ${apiRoute}`,
          filePath,
          group: "API Endpoints",
        });
      }
    }

    return nodes;
  },

  /**
   * Converts Next.js dynamic route segments in a path to Express-style params.
   * [id] → :id, [...slug] → :slug*, [[...slug]] → :slug*?
   */
  _convertDynamicSegments(routePath: string): string {
    return routePath
      .split("/")
      .map(segment => {
        // Optional catch-all: [[...param]]
        const optionalCatchAll = segment.match(/^\[\[\.\.\.(\w+)\]\]$/);
        if (optionalCatchAll) return `:${optionalCatchAll[1]}*?`;

        // Catch-all: [...param]
        const catchAll = segment.match(/^\[\.\.\.(\w+)\]$/);
        if (catchAll) return `:${catchAll[1]}*`;

        // Single dynamic: [param]
        const dynamic = segment.match(/^\[(\w+)\]$/);
        if (dynamic) return `:${dynamic[1]}`;

        return segment;
      })
      .join("/");
  },

  /**
   * Detects HTTP methods exported from a Next.js API route file.
   * Checks for:
   * - Named exports: export function GET, export async function POST, export const PUT, etc. (App Router style)
   * - req.method switch/if pattern: req.method === "POST" (Pages Router style)
   * Falls back to ["GET"] if method detection is inconclusive.
   */
  async _detectApiMethods(filePath: string): Promise<string[]> {
    const VALID_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      return ["GET"];
    }

    const methods = new Set<string>();

    // App Router style: named exports like `export function GET`, `export async function POST`, `export const DELETE`
    const namedExportPattern = /export\s+(?:async\s+)?(?:function|const)\s+(GET|POST|PUT|DELETE|PATCH)\b/g;
    let match: RegExpExecArray | null;
    while ((match = namedExportPattern.exec(content)) !== null) {
      methods.add(match[1]);
    }

    if (methods.size > 0) return Array.from(methods);

    // Pages Router style: req.method checks like `req.method === "POST"` or `case "PUT":`
    const reqMethodPattern = /req\.method\s*===?\s*["'](GET|POST|PUT|DELETE|PATCH)["']/g;
    while ((match = reqMethodPattern.exec(content)) !== null) {
      methods.add(match[1]);
    }

    // Also detect switch/case style: case "GET":
    const casePattern = /case\s+["'](GET|POST|PUT|DELETE|PATCH)["']\s*:/g;
    while ((match = casePattern.exec(content)) !== null) {
      methods.add(match[1]);
    }

    if (methods.size > 0) return Array.from(methods);

    // Fallback to GET if detection is inconclusive
    return ["GET"];
  },

  async _resolveScope(scope: string, orgId: number, isSuperAdmin?: boolean): Promise<CompositionScope> {
    if (scope === "oddjob") return { id: "oddjob", name: "Oddjob Platform", type: "platform" };
    const appAccessFilter = isSuperAdmin
      ? eq(apps.slug, scope)
      : and(eq(apps.slug, scope), or(eq(apps.organizationId, orgId), isNull(apps.organizationId)));
    const [app] = await db.select().from(apps).where(appAccessFilter).limit(1);
    if (app) return { id: app.slug, name: app.name, type: "forged_app", appId: app.id };
    const [existingApp] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, scope)).limit(1);
    if (existingApp) throw new Error("Access denied for X-Ray composition scope");
    return { id: scope, name: scope, type: "forged_app" };
  },

  /**
   * Returns the cache key for a scope. Super admins get a separate global key
   * so their wider view doesn't pollute org-scoped caches.
   */
  _cacheKey(scope: string, organizationId: number, isSuperAdmin?: boolean): string {
    return isSuperAdmin && scope === "oddjob"
      ? `xray:composition:${scope}:global`
      : `xray:composition:${scope}:org:${organizationId}`;
  },

  async _getCachedGraph(scope: string, organizationId: number, isSuperAdmin?: boolean): Promise<CompositionGraph | null> {
    try {
      const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
      const cached = await redis.get(this._cacheKey(scope, organizationId, isSuperAdmin));
      return cached ? JSON.parse(cached) : null;
    } catch { return null; }
  },

  async _setCachedGraph(scope: string, organizationId: number, graph: CompositionGraph, isSuperAdmin?: boolean): Promise<void> {
    try {
      const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
      await redis.set(this._cacheKey(scope, organizationId, isSuperAdmin), JSON.stringify(graph), "EX", 3600);
    } catch { }
  },

  /** Force-clears the cache for a scope so the next request rebuilds from DB. */
  async invalidateCache(scope: string, organizationId: number, isSuperAdmin?: boolean): Promise<void> {
    try {
      const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
      await redis.del(this._cacheKey(scope, organizationId, isSuperAdmin));
    } catch { }
  },
  
  toMermaid(graph: CompositionGraph): string {
    const sanitize = (id: string) => id.replace(/[^a-zA-Z0-9_]/g, "_");
    const isAppScope = graph.scope.type !== "platform";

    // Group nodes by architectural layer
    const screens = graph.nodes.filter(n => n.type === "screen");
    const apis = graph.nodes.filter(n => n.type === "api_endpoint");
    const components = graph.nodes.filter(n => n.type === "ui_component");
    const jobs = graph.nodes.filter(n => n.type === "job_definition" || n.type === "agent" || n.type === "supervisor");
    const pipelines = graph.nodes.filter(n => n.type === "pipeline");
    const missions = graph.nodes.filter(n => n.type === "mission");
    const datasets = graph.nodes.filter(n => n.type === "dataset");
    const knowledgeClusters = graph.nodes.filter(n => n.type === "knowledge_cluster");
    const skills = graph.nodes.filter(n => n.type === "skill");
    const cycles = graph.nodes.filter(n => n.type === "operational_cycle" || n.type === "program");
    const modules = graph.nodes.filter(n => n.type === "npm_module");
    const ontologyTypes = graph.nodes.filter(n => n.type === "ontology_object_type");
    const ontologyActions = graph.nodes.filter(n => n.type === "ontology_action");
    const ontologyLinks = graph.nodes.filter(n => n.type === "ontology_link_type");

    let mermaid = isAppScope ? "flowchart TD\n" : "flowchart LR\n";
    const headId = `ROOT_HEAD_${sanitize(graph.scope.id)}`;

    // Top-Level App / Blueprint Head Node
    if (isAppScope) {
      const headLabel = `${graph.scope.name} (App & Blueprint Head)`;
      mermaid += "  subgraph Root_Head [Top-Level App / Blueprint Head]\n";
      mermaid += `    ${headId}[["${headLabel}"]]\n`;
      mermaid += "  end\n\n";
    }

    // 1. Layer Subgraphs
    if (screens.length || components.length) {
      mermaid += "  subgraph UI_Layer [User Interface Layer]\n";
      screens.forEach(n => {
        mermaid += `    ${sanitize(n.id)}(["${n.label}"])\n`;
      });
      components.forEach(n => {
        mermaid += `    ${sanitize(n.id)}["${n.label}"]\n`;
      });
      mermaid += "  end\n\n";
    }

    if (apis.length) {
      mermaid += "  subgraph API_Layer [API & Routing Layer]\n";
      apis.forEach(n => {
        mermaid += `    ${sanitize(n.id)}{{"${n.label}"}}\n`;
      });
      mermaid += "  end\n\n";
    }

    if (missions.length || pipelines.length || jobs.length) {
      mermaid += "  subgraph Orchestration_Layer [Missions & Agents Layer]\n";
      missions.forEach(n => {
        mermaid += `    ${sanitize(n.id)}[["Mission: ${n.label}"]]\n`;
      });
      pipelines.forEach(n => {
        mermaid += `    ${sanitize(n.id)}[["Pipeline: ${n.label}"]]\n`;
      });
      jobs.forEach(n => {
        mermaid += `    ${sanitize(n.id)}[["Agent: ${n.label}"]]\n`;
      });
      mermaid += "  end\n\n";
    }

    if (datasets.length) {
      mermaid += "  subgraph Data_Layer [Data & Storage Layer]\n";
      datasets.forEach(n => {
        mermaid += `    ${sanitize(n.id)}[("${n.label}")]\n`;
      });
      mermaid += "  end\n\n";
    }

    if (ontologyTypes.length || ontologyActions.length || ontologyLinks.length) {
      mermaid += "  subgraph Business_Ontology [Business Ontology & Governed Actions]\n";
      ontologyTypes.forEach(n => {
        mermaid += `    ${sanitize(n.id)}[/"Ontology Type: ${n.label}"/\\]\n`;
      });
      ontologyActions.forEach(n => {
        mermaid += `    ${sanitize(n.id)}{{"Action: ${n.label}"}}\n`;
      });
      ontologyLinks.forEach(n => {
        mermaid += `    ${sanitize(n.id)}[["Link: ${n.label}"]]\n`;
      });
      mermaid += "  end\n\n";
    }

    if (knowledgeClusters.length || skills.length) {
      mermaid += "  subgraph Ontology_Layer [Ontology & Semantic Knowledge Layer]\n";
      knowledgeClusters.forEach(n => {
        mermaid += `    ${sanitize(n.id)}[("Knowledge: ${n.label}")]\n`;
      });
      skills.forEach(n => {
        mermaid += `    ${sanitize(n.id)}[["Skill: ${n.label}"]]\n`;
      });
      mermaid += "  end\n\n";
    }

    if (cycles.length) {
      mermaid += "  subgraph Strategy_Layer [Strategy & Blueprint Cycles]\n";
      cycles.forEach(n => {
        mermaid += `    ${sanitize(n.id)}{{"Blueprint Cycle: ${n.label}"}}\n`;
      });
      mermaid += "  end\n\n";
    }

    if (modules.length) {
      mermaid += "  subgraph Module_Layer [Domain Modules]\n";
      modules.forEach(n => {
        mermaid += `    ${sanitize(n.id)}["${n.label}"]\n`;
      });
      mermaid += "  end\n\n";
    }

    // 2. Connect Top-Level Head Node to primary entry points
    if (isAppScope) {
      const primaryEntryNodes = screens.length ? screens : missions.length ? missions : components;
      primaryEntryNodes.slice(0, 3).forEach(entry => {
        mermaid += `  ${headId} ==>|manages| ${sanitize(entry.id)}\n`;
      });
    }

    // 3. Relationship Edges
    const nodeIds = new Set(graph.nodes.map(n => n.id));
    graph.edges.forEach(e => {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return;
      const src = sanitize(e.source);
      const tgt = sanitize(e.target);
      if (src && tgt) {
        if ((e.relation as string) === "triggers" || (e.relation as string) === "invokes" || e.relation === "TRIGGERS") {
          mermaid += `  ${src} ==>|${e.label}| ${tgt}\n`;
        } else if ((e.relation as string) === "queries" || (e.relation as string) === "reads" || e.relation === "READS_FROM") {
          mermaid += `  ${src} -.->|${e.label}| ${tgt}\n`;
        } else {
          mermaid += `  ${src} -->|${e.label}| ${tgt}\n`;
        }
      }
    });

    return mermaid;
  }
};
