/**
 * Xray Relationship Indexing Service
 *
 * Maintains a live, accurate composition graph by writing relationship edges
 * to knowledge_edges whenever entities are created, updated, or executed.
 *
 * Indexing responsibilities:
 *  1. Job/Pipeline → Dataset WRITES_TO edges  (via outputDatasetId FK — batch sweep)
 *  2. Mission → Pipeline TRIGGERS edges  (from pipeline_executions.missionId)
 *  3. App → Mission OWNED_BY edge  (from apps.oddjobMissionId)
 *  4. Cycle → Mission TRIGGERS edges  (from missionRuns.cycleId)
 *  5. Mission → Cycle BELONGS_TO edges  (reverse of above)
 *  6. Mission → Pipeline/Job MEMBER_OF edge (from missionMembers)
 *  7. Knowledge → Mission READS_FROM edges  (logged by RAG service)
 *  8. Swarm Task → Mission TRIGGERS edges  (multi-agent coordination)
 *  9. Prompt Version → Mission/Job/App USED_BY edges  (evolution engine)
 *  10. Transference Rule → Knowledge Graph nodes  (transference engine visibility)
 *  11. RSS/Cron Jobs → Mission/Pipeline TRIGGERS edges  (scheduled execution detection)
 *  12. Workspace composition cache  (Redis, org-scoped, invalidated by forge + file-watcher)
 *  13. Nightly full re-index sweep  (reconciles everything)
 *
 * All edge writes are upserts — safe to run repeatedly without duplication.
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("XrayIndexing");

// ─── Composition cache helpers ────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 3600; // 1 hour

function cacheKey(scope: string, organizationId: number): string {
  return `xray:composition:${scope}:org:${organizationId}`;
}

async function getRedis() {
  const { redis } = await import("@domain/core/infrastructure/redis/redis-client.js");
  return redis;
}

// ─── Edge upsert helper ───────────────────────────────────────────────────────

/**
 * Upsert a single directed edge in knowledge_edges.
 * Uses the unique (sourceId, targetId, relation) constraint — safe to call repeatedly.
 */
async function upsertEdge(
  db: any,
  knowledgeEdges: any,
  sourceId: number,
  targetId: number,
  relation: string,
  weight = 5
) {
  await db.insert(knowledgeEdges)
    .values({ sourceId, targetId, relation, weight })
    .onConflictDoUpdate({
      target: [knowledgeEdges.sourceId, knowledgeEdges.targetId, knowledgeEdges.relation],
      set: { weight },
    })
    .catch((err: any) => {
      logger.warn("[XrayIndex] Edge upsert failed", { sourceId, targetId, relation, err: err.message });
    });
}

// ─── Node fingerprint lookup (creates if missing with in-memory caching) ───────

const nodeFingerprintCache = new Map<string, number>();

function evictCacheIfNeeded(): void {
  if (nodeFingerprintCache.size > 10000) {
    nodeFingerprintCache.clear();
  }
}

/**
 * Ensure a knowledge_node exists for an entity and return its id.
 * Fingerprint format: xray:{entityType}:{entityId}
 */
async function ensureNode(
  db: any,
  knowledgeNodes: any,
  fingerprint: string,
  label: string,
  name: string,
  organizationId: number | null,
  data: Record<string, unknown> = {}
): Promise<number> {
  const cachedId = nodeFingerprintCache.get(fingerprint);
  if (cachedId !== undefined) return cachedId;

  const { eq } = await import("drizzle-orm");

  const [existing] = await db.select({ id: knowledgeNodes.id })
    .from(knowledgeNodes)
    .where(eq(knowledgeNodes.fingerprint, fingerprint))
    .limit(1);

  if (existing) {
    evictCacheIfNeeded();
    nodeFingerprintCache.set(fingerprint, existing.id);
    return existing.id;
  }

  const [created] = await db.insert(knowledgeNodes)
    .values({ label, name, fingerprint, organizationId, data, verificationStatus: "verified" })
    .returning({ id: knowledgeNodes.id });

  if (created?.id) {
    evictCacheIfNeeded();
    nodeFingerprintCache.set(fingerprint, created.id);
    return created.id;
  }

  throw new Error(`Failed to insert or resolve node for fingerprint: ${fingerprint}`);
}

// ─── 1. Job config → Dataset READ edges ──────────────────────────────────────

/**
 * Extract dataset IDs referenced in a job's config (reads, not just the FK write).
 * Handles: config.datasetIds (array), config.datasetId (scalar).
 */
function extractDatasetIdsFromConfig(config: unknown): number[] {
  if (!config || typeof config !== "object") return [];
  const c = config as Record<string, unknown>;
  const ids = new Set<number>();
  if (Array.isArray(c.datasetIds)) {
    for (const id of c.datasetIds) { if (typeof id === "number") ids.add(id); }
  }
  if (typeof c.datasetId === "number") ids.add(c.datasetId);
  return Array.from(ids);
}

export async function indexJobDatasetEdges(jobId: number, organizationId: number | null): Promise<void> {
  try {
    const { db } = await import("@server/database_service.js");
    const { jobs, datasets, knowledgeNodes, knowledgeEdges } = await import("@shared/schema/index.js");
    const { eq, and, inArray } = await import("drizzle-orm");

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return;

    const readDatasetIds = extractDatasetIdsFromConfig(job.config);
    if (!readDatasetIds.length) return;

    // Verify the datasets exist
    const existingDatasets = await db.select({ id: datasets.id, name: datasets.name })
      .from(datasets)
      .where(inArray(datasets.id, readDatasetIds));
    if (!existingDatasets.length) return;

    // Ensure node exists for this job
    const jobNodeId = await ensureNode(
      db, knowledgeNodes,
      `xray:job:${jobId}`, "job_definition", job.name,
      organizationId ?? job.organizationId,
      { jobType: job.type }
    );

    for (const ds of existingDatasets) {
      const dsNodeId = await ensureNode(
        db, knowledgeNodes,
        `xray:dataset:${ds.id}`, "dataset", ds.name,
        organizationId ?? job.organizationId
      );
      await upsertEdge(db, knowledgeEdges, jobNodeId, dsNodeId, "READS_FROM");
    }

    logger.debug(`[XrayIndex] Job ${jobId} → ${existingDatasets.length} dataset READ edges indexed`);
  } catch (err: any) {
    logger.warn("[XrayIndex] indexJobDatasetEdges failed", { jobId, err: err.message });
  }
}

// ─── 2. Mission → Pipeline TRIGGERS edges ────────────────────────────────────

/**
 * Query pipeline_executions to find which missions have triggered which pipelines
 * and record TRIGGERS edges. Operates on a rolling 90-day window.
 */
export async function indexMissionPipelineEdges(organizationId: number): Promise<number> {
  try {
    const { db } = await import("@server/database_service.js");
    const { pipelineExecutions, pipelines, missions, knowledgeNodes, knowledgeEdges } =
      await import("@shared/schema/index.js");
    const { eq, and, isNull, isNotNull, gte, sql } = await import("drizzle-orm");

    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Get distinct (missionId, pipelineId) pairs from execution history
    const execPairs = await db
      .selectDistinct({
        missionId: pipelineExecutions.missionId,
        pipelineId: pipelineExecutions.pipelineId,
      })
      .from(pipelineExecutions)
      .where(and(
        isNotNull(pipelineExecutions.missionId),
        gte(pipelineExecutions.startedAt, since)
      ))
      .limit(500);

    // Also include structural blueprint links: installed (draft) missions store the
    // pipeline they will run in `workflowBlueprint.pipelineId` before any execution
    // history exists. Without this, freshly-installed cycle apps never get edges.
    const bpMissions = await db.select({ id: missions.id, wf: missions.workflowBlueprint })
      .from(missions)
      .where(and(eq(missions.organizationId, organizationId), isNull(missions.deletedAt)))
      .limit(2000);

    const bpPairs: Array<{ missionId: number; pipelineId: number }> = [];
    for (const m of bpMissions) {
      const wf = m.wf as any;
      if (!wf || typeof wf !== "object") continue;
      const pids: number[] = [];
      if (wf.pipelineId != null) pids.push(Number(wf.pipelineId));
      if (Array.isArray(wf.pipelineSequence)) wf.pipelineSequence.forEach((p: any) => pids.push(Number(p)));
      for (const pid of pids) {
        if (Number.isFinite(pid)) bpPairs.push({ missionId: m.id, pipelineId: pid });
      }
    }

    // Merge + dedup both sources on (missionId, pipelineId)
    const seenPair = new Set<string>();
    const pairs = [...execPairs, ...bpPairs].filter(p => {
      if (p.missionId == null) return false;
      const key = `${p.missionId}:${p.pipelineId}`;
      if (seenPair.has(key)) return false;
      seenPair.add(key);
      return true;
    });

    if (!pairs.length) return 0;

    // Batch-fetch mission and pipeline names
    const missionIds = [...new Set(pairs.map(p => p.missionId!))];
    const pipelineIds = [...new Set(pairs.map(p => p.pipelineId))];

    const { inArray } = await import("drizzle-orm");
    const missionRows = await db.select({ id: missions.id, name: missions.name, organizationId: missions.organizationId })
      .from(missions).where(and(inArray(missions.id, missionIds), eq(missions.organizationId, organizationId)));
    const pipelineRows = await db.select({ id: pipelines.id, name: pipelines.name })
      .from(pipelines).where(inArray(pipelines.id, pipelineIds));

    const missionMap = new Map(missionRows.map(m => [m.id, m]));
    const pipelineMap = new Map(pipelineRows.map(p => [p.id, p]));

    let edgesWritten = 0;
    for (const { missionId, pipelineId } of pairs) {
      const mission = missionMap.get(missionId!);
      const pipeline = pipelineMap.get(pipelineId);
      if (!mission || !pipeline) continue;

      const missionNodeId = await ensureNode(db, knowledgeNodes, `xray:mission:${mission.id}`,
        "mission", mission.name, mission.organizationId ?? null);
      const pipelineNodeId = await ensureNode(db, knowledgeNodes, `xray:pipeline:${pipeline.id}`,
        "pipeline", pipeline.name, organizationId);

      await upsertEdge(db, knowledgeEdges, missionNodeId, pipelineNodeId, "TRIGGERS");
      edgesWritten++;
    }

    logger.info(`[XrayIndex] Mission→Pipeline: ${edgesWritten} TRIGGERS edges indexed for org ${organizationId}`);
    return edgesWritten;
  } catch (err: any) {
    logger.warn("[XrayIndex] indexMissionPipelineEdges failed", { organizationId, err: err.message });
    return 0;
  }
}

// ─── 3. Pipeline → Dataset READ edges ────────────────────────────────────────

export async function indexPipelineDatasetEdges(pipelineId: number, organizationId: number | null): Promise<void> {
  try {
    const { db } = await import("@server/database_service.js");
    const { pipelineSteps, jobs, pipelines, datasets, knowledgeNodes, knowledgeEdges } =
      await import("@shared/schema/index.js");
    const { eq, and, inArray } = await import("drizzle-orm");

    const [pipeline] = await db.select().from(pipelines).where(eq(pipelines.id, pipelineId)).limit(1);
    if (!pipeline) return;

    // Get all steps → jobs for this pipeline
    const steps = await db.select({ jobId: pipelineSteps.jobId })
      .from(pipelineSteps)
      .where(and(eq(pipelineSteps.pipelineId, pipelineId)));

    const jobIds = steps.map(s => s.jobId).filter(Boolean) as number[];
    if (!jobIds.length) return;

    const jobRows = await db.select({ id: jobs.id, config: jobs.config, name: jobs.name })
      .from(jobs).where(inArray(jobs.id, jobIds));

    // Collect all dataset IDs referenced by all steps
    const datasetIds = new Set<number>();
    for (const job of jobRows) {
      for (const id of extractDatasetIdsFromConfig(job.config)) datasetIds.add(id);
    }
    if (!datasetIds.size) return;

    const existingDatasets = await db.select({ id: datasets.id, name: datasets.name })
      .from(datasets).where(inArray(datasets.id, Array.from(datasetIds)));
    if (!existingDatasets.length) return;

    const pipelineNodeId = await ensureNode(db, knowledgeNodes,
      `xray:pipeline:${pipelineId}`, "pipeline", pipeline.name, organizationId ?? pipeline.organizationId);

    for (const ds of existingDatasets) {
      const dsNodeId = await ensureNode(db, knowledgeNodes,
        `xray:dataset:${ds.id}`, "dataset", ds.name, organizationId ?? pipeline.organizationId);
      await upsertEdge(db, knowledgeEdges, pipelineNodeId, dsNodeId, "READS_FROM");
    }

    logger.debug(`[XrayIndex] Pipeline ${pipelineId} → ${existingDatasets.length} dataset READ edges indexed`);
  } catch (err: any) {
    logger.warn("[XrayIndex] indexPipelineDatasetEdges failed", { pipelineId, err: err.message });
  }
}

// ─── 4. App → Mission OWNED_BY edge ─────────────────────────────────────────

export async function indexAppMissionEdge(appId: number): Promise<void> {
  try {
    const { db } = await import("@server/database_service.js");
    const { apps, missions, knowledgeNodes, knowledgeEdges } = await import("@shared/schema/index.js");
    const { eq } = await import("drizzle-orm");

    const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
    if (!app?.oddjobMissionId) return;

    const [mission] = await db.select().from(missions).where(eq(missions.id, app.oddjobMissionId)).limit(1);
    if (!mission) return;

    const appNodeId = await ensureNode(db, knowledgeNodes,
      `xray:app:${appId}`, "app", app.name, app.organizationId ?? app.developerOrgId ?? null);
    const missionNodeId = await ensureNode(db, knowledgeNodes,
      `xray:mission:${mission.id}`, "mission", mission.name, mission.organizationId ?? null);

    await upsertEdge(db, knowledgeEdges, appNodeId, missionNodeId, "OWNED_BY");
    logger.debug(`[XrayIndex] App ${appId} → Mission ${mission.id} OWNED_BY edge indexed`);
  } catch (err: any) {
    logger.warn("[XrayIndex] indexAppMissionEdge failed", { appId, err: err.message });
  }
}

export async function indexAppMissionEdges(organizationId: number): Promise<number> {
  try {
    const { db } = await import("@server/database_service.js");
    const { apps } = await import("@shared/schema/index.js");
    const { eq, and, isNull, or, ne } = await import("drizzle-orm");

    const appRows = await db.select({ id: apps.id })
      .from(apps)
      .where(and(
        or(eq(apps.organizationId, organizationId), isNull(apps.organizationId)),
        ne(apps.status, 'archived')
      ));

    let count = 0;
    for (const app of appRows) {
      await indexAppMissionEdge(app.id);
      count++;
    }
    return count;
  } catch (err: any) {
    logger.warn("[XrayIndex] indexAppMissionEdges failed", { organizationId, err: err.message });
    return 0;
  }
}

// ─── 4b. Dataset relationship edges ──────────────────────────────────────────

/**
 * Indexes Job→Dataset and Pipeline→Dataset READS_FROM edges by scanning job
 * configs for datasetId/datasetIds references. Complements the per-job indexers
 * by running a bulk sweep for all jobs in an org.
 */
export async function indexDatasetEdges(organizationId: number): Promise<number> {
  try {
    const { db } = await import("@server/database_service.js");
    const { jobs, datasets, pipelineSteps, pipelines, knowledgeNodes, knowledgeEdges } =
      await import("@shared/schema/index.js");
    const { eq, and, or, isNull, isNotNull, inArray } = await import("drizzle-orm");

    const orgFilter = or(eq(jobs.organizationId, organizationId), isNull(jobs.organizationId));

    // Jobs write to datasets via outputDatasetId FK (not config JSON)
    const jobRows = await db.select({
      id: (jobs as any).id,
      name: (jobs as any).name,
      outputDatasetId: (jobs as any).outputDatasetId
    })
    .from(jobs)
    .where(and(orgFilter, isNotNull((jobs as any).outputDatasetId)));

    if (!jobRows.length) return 0;

    const dsIds = [...new Set(jobRows.map(j => j.outputDatasetId).filter(Boolean))] as number[];
    const dsRows = await db.select({ id: datasets.id, name: datasets.name })
      .from(datasets).where(inArray(datasets.id, dsIds));
    const dsMap = new Map(dsRows.map(d => [d.id, d.name]));

    let edgesWritten = 0;

    for (const job of jobRows) {
      if (!job.outputDatasetId) continue;
      const dsName = dsMap.get(job.outputDatasetId);
      if (!dsName) continue;
      const jobNodeId = await ensureNode(db, knowledgeNodes, `xray:job:${job.id}`, "job_definition", job.name, organizationId);
      const dsNodeId = await ensureNode(db, knowledgeNodes, `xray:dataset:${job.outputDatasetId}`, "dataset", dsName, organizationId);
      await upsertEdge(db, knowledgeEdges, jobNodeId, dsNodeId, "WRITES_TO");
      edgesWritten++;
    }

    // Pipeline→Dataset: pipeline WRITES_TO dataset if any step job does
    const pipelineRows = await db.select({ id: pipelines.id, name: pipelines.name })
      .from(pipelines).where(or(eq(pipelines.organizationId, organizationId), isNull(pipelines.organizationId)));
    const pipelineMap = new Map(pipelineRows.map(p => [p.id, p.name]));
    const jobOutputMap = new Map(jobRows.map(j => [j.id, j.outputDatasetId]));

    const stepRows = pipelineRows.length > 0
      ? await db.select({ pipelineId: pipelineSteps.pipelineId, jobId: pipelineSteps.jobId })
          .from(pipelineSteps)
          .where(inArray(pipelineSteps.pipelineId, pipelineRows.map(p => p.id)))
      : [];
    const seenPipeline = new Set<string>();

    for (const step of stepRows) {
      if (!step.jobId) continue;
      const dsId = jobOutputMap.get(step.jobId);
      if (!dsId) continue;
      const key = `${step.pipelineId}:${dsId}`;
      if (seenPipeline.has(key)) continue;
      seenPipeline.add(key);
      const pName = pipelineMap.get(step.pipelineId);
      const dsName = dsMap.get(dsId);
      if (!pName || !dsName) continue;
      const pNodeId = await ensureNode(db, knowledgeNodes, `xray:pipeline:${step.pipelineId}`, "pipeline", pName, organizationId);
      const dsNodeId = await ensureNode(db, knowledgeNodes, `xray:dataset:${dsId}`, "dataset", dsName, organizationId);
      await upsertEdge(db, knowledgeEdges, pNodeId, dsNodeId, "WRITES_TO");
      edgesWritten++;
    }

    logger.info(`[XrayIndex] Dataset: ${edgesWritten} WRITES_TO edges indexed for org ${organizationId}`);
    return edgesWritten;
  } catch (err: any) {
    logger.warn("[XrayIndex] indexDatasetEdges failed", { organizationId, err: err.message });
    return 0;
  }
}

// ─── 5. RSS/Cron Jobs → Mission/Pipeline TRIGGERS edges ─────────────────────

/**
 * Indexes scheduled execution relationships from cron jobs and RSS ingestion tasks.
 * Detects background processes that trigger missions or pipelines, addressing the
 * "Missing Ingestion Engine" gap in operational guides.
 */
export async function indexScheduledExecutionEdges(organizationId: number): Promise<number> {
  try {
    const { db } = await import("@server/database_service.js");
    const { jobs, missions, pipelines, knowledgeNodes, knowledgeEdges } =
      await import("@shared/schema/index.js");
    const { eq, and, or, isNull, like, inArray } = await import("drizzle-orm");

    const orgFilter = or(eq(jobs.organizationId, organizationId), isNull(jobs.organizationId));

    // Find jobs that are cron-type or RSS-related based on type or config
    const scheduledJobs = await db.select({
      id: jobs.id,
      name: jobs.name,
      type: jobs.type,
      config: jobs.config,
      organizationId: jobs.organizationId,
    })
    .from(jobs)
    .where(and(
      orgFilter,
      or(
        like((jobs as any).type, "%cron%"),
        like((jobs as any).type, "%rss%"),
        like((jobs as any).type, "%scheduled%"),
        like((jobs as any).type, "%ingest%")
      )
    ))
    .limit(200);

    if (!scheduledJobs.length) return 0;

    let edgesWritten = 0;

    for (const job of scheduledJobs) {
      const jobNodeId = await ensureNode(
        db, knowledgeNodes,
        `xray:job:${job.id}`, "job_definition", job.name,
        job.organizationId ?? organizationId,
        { jobType: job.type, isScheduled: true }
      );

      // Check if job config references missions or pipelines
      const config = job.config as Record<string, unknown> || {};
      const missionIds = Array.isArray(config.missionIds) ? config.missionIds as number[] : 
                        typeof config.missionId === "number" ? [config.missionId] : [];
      const pipelineIds = Array.isArray(config.pipelineIds) ? config.pipelineIds as number[] :
                         typeof config.pipelineId === "number" ? [config.pipelineId] : [];

      // Create TRIGGERS edges to missions
      if (missionIds.length > 0) {
        const missionRows = await db.select({ id: missions.id, name: missions.name })
          .from(missions)
          .where(inArray(missions.id, missionIds));

        for (const mission of missionRows) {
          const missionNodeId = await ensureNode(
            db, knowledgeNodes,
            `xray:mission:${mission.id}`, "mission", mission.name,
            organizationId
          );
          await upsertEdge(db, knowledgeEdges, jobNodeId, missionNodeId, "TRIGGERS");
          edgesWritten++;
        }
      }

      // Create TRIGGERS edges to pipelines
      if (pipelineIds.length > 0) {
        const pipelineRows = await db.select({ id: pipelines.id, name: pipelines.name })
          .from(pipelines)
          .where(inArray(pipelines.id, pipelineIds));

        for (const pipeline of pipelineRows) {
          const pipelineNodeId = await ensureNode(
            db, knowledgeNodes,
            `xray:pipeline:${pipeline.id}`, "pipeline", pipeline.name,
            organizationId
          );
          await upsertEdge(db, knowledgeEdges, jobNodeId, pipelineNodeId, "TRIGGERS");
          edgesWritten++;
        }
      }
    }

    logger.info(`[XrayIndex] Scheduled execution: ${edgesWritten} TRIGGERS edges indexed for org ${organizationId}`);
    return edgesWritten;
  } catch (err: any) {
    logger.warn("[XrayIndex] indexScheduledExecutionEdges failed", { organizationId, err: err.message });
    return 0;
  }
}

// ─── 6. Cycle → Mission TRIGGERS edges + Mission → Cycle BELONGS_TO edges ─────

export async function indexCycleMissionEdges(organizationId: number): Promise<number> {
  try {
    const { db } = await import("@server/database_service.js");
    const { operationalCycles, missionRuns, missions, knowledgeNodes, knowledgeEdges } =
      await import("@shared/schema/index.js");
    const { eq, and, isNull, inArray } = await import("drizzle-orm");

    const cycles = await db.select({ id: operationalCycles.id, name: operationalCycles.name })
      .from(operationalCycles)
      .where(and(eq(operationalCycles.organizationId, organizationId), isNull(operationalCycles.deletedAt)));
    if (!cycles.length) return 0;

    const cycleIds = cycles.map(c => c.id);

    // Batch-fetch all runs across all cycles in one query (replaces N+1 per cycle)
    const runs = await db.select({ missionId: missionRuns.missionId, cycleId: missionRuns.cycleId })
      .from(missionRuns)
      .where(and(inArray(missionRuns.cycleId, cycleIds), isNull(missionRuns.deletedAt)))
      .limit(2000);

    const missionIds = [...new Set(runs.map(r => r.missionId).filter(Boolean))] as number[];
    if (!missionIds.length) return 0;

    const missionRows = await db.select({ id: missions.id, name: missions.name })
      .from(missions)
      .where(inArray(missions.id, missionIds));
    const missionMap = new Map(missionRows.map(m => [m.id, m.name]));
    const cycleMap = new Map(cycles.map(c => [c.id, c.name]));

    let edgesWritten = 0;
    const seen = new Set<string>();

    for (const run of runs) {
      if (!run.cycleId || !run.missionId) continue;
      const missionName = missionMap.get(run.missionId);
      const cycleName = cycleMap.get(run.cycleId);
      if (!missionName || !cycleName) continue;

      const cycleNodeId = await ensureNode(db, knowledgeNodes, `xray:cycle:${run.cycleId}`, "operational_cycle", cycleName, organizationId);
      const missionNodeId = await ensureNode(db, knowledgeNodes, `xray:mission:${run.missionId}`, "mission", missionName, organizationId);

      const triggersKey = `${run.cycleId}→${run.missionId}:TRIGGERS`;
      if (!seen.has(triggersKey)) {
        await upsertEdge(db, knowledgeEdges, cycleNodeId, missionNodeId, "TRIGGERS");
        seen.add(triggersKey);
        edgesWritten++;
      }
    }

    logger.info(`[XrayIndex] Cycle→Mission: ${edgesWritten} TRIGGERS edges indexed for org ${organizationId}`);
    return edgesWritten;
  } catch (err: any) {
    logger.warn("[XrayIndex] indexCycleMissionEdges failed", { organizationId, err: err.message });
    return 0;
  }
}

/**
 * Index Mission → Cycle BELONGS_TO edges (reverse of TRIGGERS).
 * Enables graph traversal from a mission node back to its parent cycle.
 */
export async function indexMissionCycleEdges(organizationId: number): Promise<number> {
  try {
    const { db } = await import("@server/database_service.js");
    const { operationalCycles, missionRuns, missions, knowledgeNodes, knowledgeEdges } =
      await import("@shared/schema/index.js");
    const { eq, and, isNull, isNotNull, inArray } = await import("drizzle-orm");

    const cycles = await db.select({ id: operationalCycles.id, name: operationalCycles.name })
      .from(operationalCycles)
      .where(and(eq(operationalCycles.organizationId, organizationId), isNull(operationalCycles.deletedAt)));
    if (!cycles.length) return 0;

    const cycleIds = cycles.map(c => c.id);
    const runs = await db.select({ missionId: missionRuns.missionId, cycleId: missionRuns.cycleId })
      .from(missionRuns)
      .where(and(inArray(missionRuns.cycleId, cycleIds), isNotNull(missionRuns.missionId), isNull(missionRuns.deletedAt)))
      .limit(2000);

    const missionIds = [...new Set(runs.map(r => r.missionId).filter(Boolean))] as number[];
    if (!missionIds.length) return 0;

    const missionRows = await db.select({ id: missions.id, name: missions.name })
      .from(missions).where(inArray(missions.id, missionIds));
    const missionMap = new Map(missionRows.map(m => [m.id, m.name]));
    const cycleMap = new Map(cycles.map(c => [c.id, c.name]));

    let edgesWritten = 0;
    const seen = new Set<string>();

    for (const run of runs) {
      if (!run.cycleId || !run.missionId) continue;
      const missionName = missionMap.get(run.missionId);
      const cycleName = cycleMap.get(run.cycleId);
      if (!missionName || !cycleName) continue;

      const key = `${run.missionId}→${run.cycleId}:BELONGS_TO`;
      if (seen.has(key)) continue;
      seen.add(key);

      const missionNodeId = await ensureNode(db, knowledgeNodes, `xray:mission:${run.missionId}`, "mission", missionName, organizationId);
      const cycleNodeId = await ensureNode(db, knowledgeNodes, `xray:cycle:${run.cycleId}`, "operational_cycle", cycleName, organizationId);
      await upsertEdge(db, knowledgeEdges, missionNodeId, cycleNodeId, "BELONGS_TO");
      edgesWritten++;
    }

    logger.info(`[XrayIndex] Mission→Cycle: ${edgesWritten} BELONGS_TO edges indexed for org ${organizationId}`);
    return edgesWritten;
  } catch (err: any) {
    logger.warn("[XrayIndex] indexMissionCycleEdges failed", { organizationId, err: err.message });
    return 0;
  }
}

// ─── 6. Mission → Pipeline/Job edges ────────────────────────────────────────

export async function indexMissionMemberEdges(organizationId: number): Promise<number> {
  try {
    const { db } = await import("@server/database_service.js");
    const { missionMembers, missions, pipelines, jobs, knowledgeNodes, knowledgeEdges } = 
      await import("@shared/schema/index.js");
    const { eq, and, isNull, inArray } = await import("drizzle-orm");

    const missionRows = await db.select().from(missions).where(and(eq(missions.organizationId, organizationId), isNull(missions.deletedAt)));
    if (!missionRows.length) return 0;

    let edgesWritten = 0;
    for (const mission of missionRows) {
      const missionNodeId = await ensureNode(db, knowledgeNodes, `xray:mission:${mission.id}`, "mission", mission.name, organizationId);
      
      const members = await db.select().from(missionMembers).where(eq(missionMembers.missionId, mission.id));
      for (const member of members) {
        if (member.entityType === "pipeline") {
          const [p] = await db.select().from(pipelines).where(eq(pipelines.id, member.entityId)).limit(1);
          if (p) {
            const pNodeId = await ensureNode(db, knowledgeNodes, `xray:pipeline:${p.id}`, "pipeline", p.name, organizationId);
            await upsertEdge(db, knowledgeEdges, missionNodeId, pNodeId, "PART_OF");
            edgesWritten++;
          }
        } else if (member.entityType === "job") {
          const [j] = await db.select().from(jobs).where(eq(jobs.id, member.entityId)).limit(1);
          if (j) {
            const jNodeId = await ensureNode(db, knowledgeNodes, `xray:job:${j.id}`, "job_definition", j.name, organizationId);
            await upsertEdge(db, knowledgeEdges, missionNodeId, jNodeId, "PART_OF");
            edgesWritten++;
          }
        }
      }
    }
    return edgesWritten;
  } catch (err: any) {
    logger.warn("[XrayIndex] indexMissionMemberEdges failed", { organizationId, err: err.message });
    return 0;
  }
}

// ─── 5. Workspace composition cache ──────────────────────────────────────────

export async function invalidateCompositionCache(
  scope: string, 
  organizationId?: number,
  nodeId?: string
): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.del(`xray:composition:${scope}`);
    if (scope === "oddjob") {
      await redis.del(`xray:composition:${scope}:global`);
    }
    if (nodeId) {
      await redis.del(`xray:node:${nodeId}`);
      await redis.del(`xray:composition:${scope}:node:${nodeId}`);
    }
    if (organizationId != null) {
      await redis.del(cacheKey(scope, organizationId));
    } else if (scope !== "oddjob") {
      const { db } = await import("@server/database_service.js");
      const { apps } = await import("@shared/schema/index.js");
      const { eq } = await import("drizzle-orm");
      const appRows = await db.select({ organizationId: apps.organizationId }).from(apps).where(eq(apps.slug, scope));
      await Promise.all(
        appRows
          .map(app => app.organizationId)
          .filter((orgId): orgId is number => orgId != null)
          .map(orgId => redis.del(cacheKey(scope, orgId)))
      );
    }
    logger.debug(`[XrayIndex] Composition cache invalidated: ${scope}${nodeId ? ` (node: ${nodeId})` : ''}`);
  } catch (err: any) {
    logger.warn("[XrayIndex] Cache invalidation failed", { scope, err: err.message });
  }
}

export async function warmCompositionCache(scope: string, organizationId: number): Promise<void> {
  try {
    const { xrayCompositionService } = await import("./xray-composition.service.js");
    const graph = await xrayCompositionService.buildGraph(scope, organizationId, { skipCache: true });
    const redis = await getRedis();
    const serialized = JSON.stringify(graph);
    await redis.set(cacheKey(scope, organizationId), serialized, "EX", CACHE_TTL_SECONDS);
    logger.info(`[XrayIndex] Composition cache warmed: ${scope} (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
  } catch (err: any) {
    logger.warn("[XrayIndex] Cache warm failed", { scope, err: err.message });
  }
}

// ─── 6. Knowledge → Mission READS_FROM edges (from RAG retrieval) ────────────

interface RagEdgeItem {
  missionId: number;
  topicId: number;
  organizationId: number | null;
}

const RAG_EDGE_BUFFER_MAX = 50;
const RAG_EDGE_FLUSH_INTERVAL_MS = 5000;
let ragEdgeBuffer: RagEdgeItem[] = [];
let ragFlushTimer: NodeJS.Timeout | null = null;

async function flushRagEdgeBuffer(): Promise<void> {
  if (ragEdgeBuffer.length === 0) return;
  const itemsToProcess = ragEdgeBuffer.splice(0, ragEdgeBuffer.length);
  
  try {
    const { db } = await import("@server/database_service.js");
    const { missions, knowledgeTopics, knowledgeNodes, knowledgeEdges } = await import("@shared/schema/index.js");
    const { eq } = await import("drizzle-orm");

    for (const item of itemsToProcess) {
      try {
        const [mission] = await db.select({ name: missions.name })
          .from(missions).where(eq(missions.id, item.missionId)).limit(1);
        const [topic] = await db.select({ name: knowledgeTopics.name })
          .from(knowledgeTopics).where(eq(knowledgeTopics.id, item.topicId)).limit(1);
        if (!mission || !topic) continue;

        const missionNodeId = await ensureNode(db, knowledgeNodes,
          `xray:mission:${item.missionId}`, "mission", mission.name, item.organizationId);
        const topicNodeId = await ensureNode(db, knowledgeNodes,
          `xray:knowledge:${item.topicId}`, "knowledge_cluster", topic.name, item.organizationId);

        await upsertEdge(db, knowledgeEdges, missionNodeId, topicNodeId, "READS_FROM");
      } catch {
        // Silently skip individual failed items
      }
    }
  } catch {
    // Silently ignore telemetry write failures
  }
}

/**
 * Called by graphRagService after each retrieval to record which mission
 * queried which knowledge topics into a buffer flushed periodically.
 */
export async function indexRagRetrievalEdge(
  missionId: number,
  topicId: number,
  organizationId: number | null
): Promise<void> {
  ragEdgeBuffer.push({ missionId, topicId, organizationId });

  if (ragEdgeBuffer.length >= RAG_EDGE_BUFFER_MAX) {
    void flushRagEdgeBuffer();
  } else if (!ragFlushTimer) {
    ragFlushTimer = setTimeout(() => {
      ragFlushTimer = null;
      void flushRagEdgeBuffer();
    }, RAG_EDGE_FLUSH_INTERVAL_MS);
  }
}

// ─── 7. Swarm Task → Mission TRIGGERS edges ─────────────────────────────────

/**
 * Index swarm tasks to their parent missions for multi-agent coordination visibility.
 */
export async function indexSwarmTaskEdges(organizationId: number): Promise<number> {
  try {
    const { db } = await import("@server/database_service.js");
    const { swarmTasks, missions, knowledgeNodes, knowledgeEdges } = await import("@shared/schema/index.js");
    const { eq, and, sql } = await import("drizzle-orm");

    const tasks = await db.select({ id: swarmTasks.id, missionId: swarmTasks.missionId, description: swarmTasks.description })
      .from(swarmTasks)
      .where(eq(swarmTasks.missionId, sql`ANY (
        SELECT id FROM ${missions} WHERE organization_id = ${organizationId}
      )`));

    let edgesCreated = 0;
    for (const task of tasks) {
      const [mission] = await db.select({ name: missions.name })
        .from(missions).where(eq(missions.id, task.missionId)).limit(1);
      if (!mission) continue;

      const taskNodeId = await ensureNode(db, knowledgeNodes,
        `xray:swarm_task:${task.id}`, "swarm_task", task.description || `Swarm Task ${task.id}`, organizationId);
      const missionNodeId = await ensureNode(db, knowledgeNodes,
        `xray:mission:${task.missionId}`, "mission", mission.name, organizationId);

      await upsertEdge(db, knowledgeEdges, taskNodeId, missionNodeId, "TRIGGERS");
      edgesCreated++;
    }

    logger.info(`[XrayIndex] Indexed ${edgesCreated} swarm task edges for org ${organizationId}`);
    return edgesCreated;
  } catch (err: any) {
    logger.warn("[XrayIndex] Swarm task indexing failed", { err: err.message });
    return 0;
  }
}

// ─── 8. Prompt Version → Mission/Job/App USED_BY edges ───────────────────────

/**
 * Index prompt versions to their usage context (missions, jobs, apps).
 */
export async function indexPromptVersionEdges(organizationId: number): Promise<number> {
  try {
    const { db } = await import("@server/database_service.js");
    const { promptVersions, missions, jobs, apps, knowledgeNodes, knowledgeEdges } = await import("@shared/schema/index.js");
    const { eq, and } = await import("drizzle-orm");

    const versions = await db.select({
      id: promptVersions.id,
      versionId: promptVersions.versionId,
      missionId: (promptVersions as any).missionId,
      appId: (promptVersions as any).appId,
      jobId: (promptVersions as any).jobId,
      promptType: promptVersions.promptType,
    })
      .from(promptVersions)
      .where(eq(promptVersions.organizationId, organizationId));

    let edgesCreated = 0;
    for (const version of versions) {
      const versionNodeId = await ensureNode(db, knowledgeNodes,
        `xray:prompt_version:${version.id}`, "prompt_version", `${version.promptType}:${version.versionId}`, organizationId);

      // Link to mission if present
      if (version.missionId) {
        const [mission] = await db.select({ name: missions.name })
          .from(missions).where(eq(missions.id, version.missionId)).limit(1);
        if (mission) {
          const missionNodeId = await ensureNode(db, knowledgeNodes,
            `xray:mission:${version.missionId}`, "mission", mission.name, organizationId);
          await upsertEdge(db, knowledgeEdges, versionNodeId, missionNodeId, "USED_BY");
          edgesCreated++;
        }
      }

      // Link to job if present
      if (version.jobId) {
        const [job] = await db.select({ name: jobs.name })
          .from(jobs).where(eq(jobs.id, version.jobId)).limit(1);
        if (job) {
          const jobNodeId = await ensureNode(db, knowledgeNodes,
            `xray:job:${version.jobId}`, "job", job.name, organizationId);
          await upsertEdge(db, knowledgeEdges, versionNodeId, jobNodeId, "USED_BY");
          edgesCreated++;
        }
      }

      // Link to app if present
      if (version.appId) {
        const [app] = await db.select({ name: apps.name })
          .from(apps).where(eq(apps.id, version.appId)).limit(1);
        if (app) {
          const appNodeId = await ensureNode(db, knowledgeNodes,
            `xray:app:${version.appId}`, "app", app.name, organizationId);
          await upsertEdge(db, knowledgeEdges, versionNodeId, appNodeId, "USED_BY");
          edgesCreated++;
        }
      }
    }

    logger.info(`[XrayIndex] Indexed ${edgesCreated} prompt version edges for org ${organizationId}`);
    return edgesCreated;
  } catch (err: any) {
    logger.warn("[XrayIndex] Prompt version indexing failed", { err: err.message });
    return 0;
  }
}

// ─── 9. Transference Rule → Knowledge Graph OPTIMIZES edges ─────────────────

/**
 * Index transference rules as optimization nodes linked to knowledge graph.
 * Since transference rules don't have direct FKs, we create nodes for visibility.
 */
export async function indexTransferenceRuleEdges(organizationId: number): Promise<number> {
  try {
    const { db } = await import("@server/database_service.js");
    const { transferenceRules, knowledgeNodes, knowledgeEdges } = await import("@shared/schema/index.js");

    const rules = await db.select({
      id: transferenceRules.id,
      promptHash: transferenceRules.promptHash,
      mode: transferenceRules.mode,
      tier: transferenceRules.tier,
    })
      .from(transferenceRules);

    let nodesCreated = 0;
    for (const rule of rules) {
      await ensureNode(db, knowledgeNodes,
        `xray:transference_rule:${rule.id}`, "transference_rule",
        `Rule ${rule.promptHash.substring(0, 8)} (${rule.mode}, tier ${rule.tier})`, organizationId, {
          mode: rule.mode,
          tier: rule.tier,
        });
      nodesCreated++;
    }

    logger.info(`[XrayIndex] Indexed ${nodesCreated} transference rule nodes for org ${organizationId}`);
    return nodesCreated;
  } catch (err: any) {
    logger.warn("[XrayIndex] Transference rule indexing failed", { err: err.message });
    return 0;
  }
}

// ─── 9b. Entity node sweep ────────────────────────────────────────────────────

/**
 * Ensure a node exists for every core entity, whether or not it has an edge.
 *
 * Every other indexer in this file is edge-driven: it creates nodes only as a
 * side effect of writing a relationship. The consequence is that an entity which
 * participates in none of the indexed edge types is invisible to X-Ray entirely
 * — not "shown with no connections", absent.
 *
 * That is not a hypothetical. `indexDatasetEdges` returns early unless some job
 * carries an `output_dataset_id`, and no job in any environment does, so datasets
 * and job definitions have never produced a single node despite both tables being
 * populated. The graph reads as though the platform has only missions, pipelines
 * and cycles in it, because those are the only things the edge sweeps touch.
 *
 * This sweep makes the node set an inventory and lets the edge sweeps stay what
 * they are — relationship writers layered on top. Fingerprints and labels match
 * the ones the edge indexers already use, so a node this creates and a node an
 * edge sweep later needs are the same row rather than a duplicate.
 */
export async function indexEntityNodes(organizationId: number): Promise<number> {
  const { db } = await import("@server/database_service.js");
  const { missions, jobs, pipelines, datasets, apps, operationalCycles, knowledgeNodes } =
    await import("@shared/schema/index.js");
  const { eq, and, or, isNull } = await import("drizzle-orm");

  // Some tables carry a null organization_id for platform-level rows; those are
  // visible to every org and are indexed under the org being swept, matching how
  // the edge indexers already scope them.
  const orgOrNull = (col: any) => or(eq(col, organizationId), isNull(col));

  let created = 0;
  const sweep = async (
    label: string,
    prefix: string,
    rows: Array<{ id: number | string; name: string | null }>,
    data: (row: any) => Record<string, unknown> = () => ({}),
  ) => {
    for (const row of rows) {
      try {
        await ensureNode(
          db,
          knowledgeNodes,
          `xray:${prefix}:${row.id}`,
          label,
          row.name || `${label} ${row.id}`,
          organizationId,
          data(row),
        );
        created++;
      } catch (err: any) {
        logger.warn(`[XrayIndex] Entity node failed for ${prefix}:${row.id}`, { err: err.message });
      }
    }
  };

  await sweep(
    "mission",
    "mission",
    await db.select({ id: missions.id, name: missions.name, status: missions.status })
      .from(missions).where(and(eq(missions.organizationId, organizationId), isNull(missions.deletedAt))),
    (r) => ({ status: r.status }),
  );

  await sweep(
    "job_definition",
    "job",
    await db.select({ id: jobs.id, name: jobs.name, type: jobs.type })
      .from(jobs).where(orgOrNull(jobs.organizationId)),
    (r) => ({ type: r.type }),
  );

  await sweep(
    "pipeline",
    "pipeline",
    await db.select({ id: pipelines.id, name: pipelines.name })
      .from(pipelines).where(orgOrNull(pipelines.organizationId)),
  );

  await sweep(
    "dataset",
    "dataset",
    await db.select({ id: datasets.id, name: datasets.name })
      .from(datasets).where(eq(datasets.organizationId, organizationId)),
  );

  await sweep(
    "app",
    "app",
    await db.select({ id: apps.id, name: apps.name, status: apps.status })
      .from(apps).where(eq(apps.organizationId, organizationId)),
    (r) => ({ status: r.status }),
  );

  await sweep(
    "operational_cycle",
    "cycle",
    await db.select({ id: operationalCycles.id, name: operationalCycles.name, status: operationalCycles.status })
      .from(operationalCycles)
      .where(and(eq(operationalCycles.organizationId, organizationId), isNull(operationalCycles.deletedAt))),
    (r) => ({ status: r.status }),
  );

  logger.info(`[XrayIndex] Entity node sweep: ${created} nodes ensured for org ${organizationId}`);
  return created;
}

// ─── 10. Nightly full re-index sweep ──────────────────────────────────────────

export async function fullReindex(organizationId: number): Promise<{
  datasetEdges: string;
  entityNodes: number;
  missionPipelineEdges: number;
  appEdges: number;
  cycleEdges: number;
  missionMemberEdges: number;
  swarmTaskEdges: number;
  promptVersionEdges: number;
  transferenceRuleNodes: number;
  scheduledExecutionEdges: number;
  cachesWarmed: number;
}> {
  logger.info(`[XrayIndex] Starting full re-index for org ${organizationId}`);
  const start = Date.now();

  const { db } = await import("@server/database_service.js");
  const { jobs, pipelines, apps } = await import("@shared/schema/index.js");
  const { eq, and, or, isNull } = await import("drizzle-orm");
  const orgFilter = (col: any) => or(eq(col, organizationId), isNull(col));

  let appEdges = 0;

  /*
    Entity nodes first, edges second.

    The order matters for cost, not correctness: ensureNode caches by fingerprint,
    so once the sweep has created a mission's node the edge indexers resolve it
    from memory instead of re-querying. It also means a failure in an edge sweep
    can no longer make an entity vanish from the graph — the node is already there.
  */
  const entityNodeRes = await Promise.allSettled([indexEntityNodes(organizationId)]);
  if (entityNodeRes[0].status === "rejected") {
    logger.error("[XrayIndex] Entity node sweep failed", {
      organizationId,
      err: String(entityNodeRes[0].reason?.message ?? entityNodeRes[0].reason),
    });
  }

  // Run independent entity relationship sweeps concurrently
  const sweepNames = [
    "indexDatasetEdges",
    "indexMissionPipelineEdges",
    "indexCycleMissionEdges",
    "indexMissionCycleEdges",
    "indexMissionMemberEdges",
    "indexSwarmTaskEdges",
    "indexPromptVersionEdges",
    "indexTransferenceRuleEdges",
    "indexScheduledExecutionEdges",
  ];
  const settled = await Promise.allSettled([
    indexDatasetEdges(organizationId),
    indexMissionPipelineEdges(organizationId),
    indexCycleMissionEdges(organizationId),
    indexMissionCycleEdges(organizationId),
    indexMissionMemberEdges(organizationId),
    indexSwarmTaskEdges(organizationId),
    indexPromptVersionEdges(organizationId),
    indexTransferenceRuleEdges(organizationId),
    indexScheduledExecutionEdges(organizationId)
  ]);

  /*
    Report rejections instead of folding them into the zero below.

    Each indexer already catches internally and returns 0, so a rejection here is
    rare — but between that and this allSettled, a broken sweep and an empty one
    were reported identically as `0`. That is how the dataset sweep went unnoticed:
    it has returned 0 for every org since it was written, and nothing distinguished
    that from "there was nothing to index".
  */
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      logger.error(`[XrayIndex] Sweep ${sweepNames[i]} rejected`, {
        organizationId,
        err: String(r.reason?.message ?? r.reason),
      });
    }
  });

  const [
    _dsRes,
    missionPipelineRes,
    cycleRes,
    _missionCycleRes,
    missionMemberRes,
    swarmTaskRes,
    promptVersionRes,
    transferenceRuleRes
  ] = settled;

  // App → Mission edges
  const allApps = await db.select({ id: apps.id })
    .from(apps).where(orgFilter(apps.organizationId));
  for (const app of allApps) {
    await indexAppMissionEdge(app.id);
    appEdges++;
  }

  const missionPipelineEdges = missionPipelineRes.status === "fulfilled" ? missionPipelineRes.value : 0;
  const cycleEdges = cycleRes.status === "fulfilled" ? cycleRes.value : 0;
  const missionMemberEdges = missionMemberRes.status === "fulfilled" ? missionMemberRes.value : 0;
  const swarmTaskEdges = swarmTaskRes.status === "fulfilled" ? swarmTaskRes.value : 0;
  const promptVersionEdges = promptVersionRes.status === "fulfilled" ? promptVersionRes.value : 0;
  const transferenceRuleNodes = transferenceRuleRes.status === "fulfilled" ? transferenceRuleRes.value : 0;
  const scheduledExecutionEdges = settled[8].status === "fulfilled" ? settled[8].value : 0;

  // Prune stale edges (nodes that no longer exist), scoped to org
  await pruneStaleEdges(organizationId);

  // 12. Invalidate and rebuild composition caches for all forged apps + oddjob scope
  const redis = await getRedis();
  let cachesWarmed = 0;
  const forgedApps = await db.select({ slug: apps.slug }).from(apps)
    .where(and(orgFilter(apps.organizationId)));
  for (const app of forgedApps) {
    await redis.del(cacheKey(app.slug, organizationId));
    await warmCompositionCache(app.slug, organizationId);
    cachesWarmed++;
  }
  // Invalidate the org-specific oddjob key; superadmin global cache is built on demand.
  await redis.del(cacheKey("oddjob", organizationId));
  await redis.del("xray:composition:oddjob:global");
  await warmCompositionCache("oddjob", organizationId);
  cachesWarmed++;

  const entityNodes = entityNodeRes[0].status === "fulfilled" ? entityNodeRes[0].value : 0;

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(`[XrayIndex] Full re-index complete in ${duration}s`, {
    entityNodes, missionPipelineEdges, appEdges, cycleEdges, missionMemberEdges, swarmTaskEdges, promptVersionEdges, transferenceRuleNodes, scheduledExecutionEdges, cachesWarmed
  });

  return { datasetEdges: "batch", entityNodes, missionPipelineEdges, appEdges, cycleEdges, missionMemberEdges, swarmTaskEdges, promptVersionEdges, transferenceRuleNodes, scheduledExecutionEdges, cachesWarmed };
}

// ─── Prune stale edges ────────────────────────────────────────────────────────

async function pruneStaleEdges(organizationId: number): Promise<void> {
  try {
    const { db } = await import("@server/database_service.js");
    const { knowledgeEdges, knowledgeNodes } = await import("@shared/schema/index.js");
    const { sql } = await import("drizzle-orm");

    // Delete edges where source or target no longer exists, scoped to this org's nodes
    await db.execute(sql`
      DELETE FROM ${knowledgeEdges}
      WHERE id IN (
        SELECT e.id FROM ${knowledgeEdges} e
        LEFT JOIN ${knowledgeNodes} src ON src.id = e.source_id
        LEFT JOIN ${knowledgeNodes} tgt ON tgt.id = e.target_id
        WHERE (src.id IS NULL OR tgt.id IS NULL)
          AND (
            EXISTS (SELECT 1 FROM ${knowledgeNodes} n WHERE n.id = e.source_id AND n.organization_id = ${organizationId})
            OR EXISTS (SELECT 1 FROM ${knowledgeNodes} n WHERE n.id = e.target_id AND n.organization_id = ${organizationId})
          )
      )
    `);

    logger.debug(`[XrayIndex] Stale edge pruning complete for org ${organizationId}`);
  } catch (err: any) {
    logger.warn("[XrayIndex] Prune stale edges failed", { err: err.message });
  }
}

export const xrayIndexingService = {
  indexJobDatasetEdges,
  indexMissionPipelineEdges,
  indexPipelineDatasetEdges,
  indexAppMissionEdge,
  indexAppMissionEdges,
  indexDatasetEdges,
  indexCycleMissionEdges,
  indexMissionCycleEdges,
  indexMissionMemberEdges,
  invalidateCompositionCache,
  warmCompositionCache,
  indexRagRetrievalEdge,
  indexSwarmTaskEdges,
  indexPromptVersionEdges,
  indexTransferenceRuleEdges,
  indexEntityNodes,
  fullReindex
};
