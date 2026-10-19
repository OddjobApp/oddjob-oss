/**
 * Ingestion Orchestrator Service
 *
 * The central coordination service for the autonomous research ingestion
 * lifecycle. Orchestrates all phases: input classification, strategy
 * generation, collection, extraction, dataset population, synthesis,
 * and progress streaming. Manages pipeline execution records and stores
 * full IngestionContextSnapshot for post-mortem analysis.
 *
 * @module ingestion/ingestion-orchestrator
 * @see Requirements 1.5, 2.1, 6.1, 7.1, 7.5
 */

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { type OrgContext } from "@server/utils/auth-context.js";
import {
  pipelineExecutions,
  type PipelineExecution,
} from "@shared/schema/pipelines/pipeline-execution.js";
import { pipelines } from "@shared/schema/pipelines/pipeline-core.js";
import { eq, and, desc } from "drizzle-orm";

import type {
  ClassifiedInput,
  GatheringStrategy,
  IngestionOrchestrationResult,
  IngestionRunStatus,
  IngestionRunSummary,
  IngestionStage,
  ResearchSubjectInput,
} from "./types.js";
import type { IngestionContextSnapshot } from "./context-snapshot.types.js";
import type { CollectorResult } from "./collectors/collector.interface.js";

import { inputClassifierService } from "./input-classifier.service.js";
import { strategyPlannerService } from "./strategy-planner.service.js";
import { collectionExecutorService } from "./collection-executor.service.js";
import { deduplicationService } from "./deduplication.service.js";
import { knowledgeIngestionService } from "./knowledge-ingestion.service.js";
import { datasetIngestionService } from "./dataset-ingestion.service.js";
import { synthesisService } from "./synthesis.service.js";
import { progressEmitterService } from "./progress-emitter.service.js";
import { appProvisioningService } from "./app-provisioning.service.js";

const logger = createLogger("IngestionOrchestrator");

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Name of the system pipeline used for autonomous research executions */
const ORCHESTRATOR_PIPELINE_NAME = "Autonomous Research Ingestion";

// ─── Service ───────────────────────────────────────────────────────────────────

export const ingestionOrchestratorService = {
  /**
   * Classify and validate user input as either a topic or URL.
   * Delegates to the inputClassifierService.
   */
  async classifyInput(input: string): Promise<ClassifiedInput> {
    logger.info("Classifying input", { input: input.slice(0, 100) });
    return inputClassifierService.classifyInput(input);
  },

  /**
   * Generate a gathering strategy for the classified input.
   * Delegates to the strategyPlannerService.
   */
  async generateStrategy(
    classifiedInput: ClassifiedInput,
    orgContext: OrgContext,
    options: ResearchSubjectInput,
  ): Promise<GatheringStrategy> {
    logger.info("Generating strategy", {
      type: classifiedInput.type,
      subject: classifiedInput.normalizedValue,
    });
    return strategyPlannerService.generateStrategy(
      classifiedInput,
      orgContext,
      options,
    );
  },

  /**
   * Execute the full orchestration pipeline.
   *
   * Creates a pipeline execution record with status "planning", then coordinates
   * the sequential phases: planning → collecting → extracting → synthesizing → completed.
   * Stores the full IngestionContextSnapshot in the pipeline execution contextSnapshot field.
   * On fatal errors, emits an "ingestion.failed" event with partial results summary.
   */
  async execute(
    strategy: GatheringStrategy,
    orgContext: OrgContext,
  ): Promise<IngestionOrchestrationResult> {
    const startTime = Date.now();

    logger.info("Starting orchestration execution", {
      strategyId: strategy.id,
      subject: strategy.researchSubject.normalizedValue,
      collectors: strategy.collectors.length,
    });

    // Ensure a system pipeline exists for autonomous research
    const pipelineId = await ensureOrchestratorPipeline(orgContext);

    // Create pipeline execution record with initial "planning" status
    const [execution] = await db
      .insert(pipelineExecutions)
      .values({
        pipelineId,
        status: "running",
        organizationId: orgContext.organizationId,
        createdBy: orgContext.userId,
        startedAt: new Date(),
        runUuid: crypto.randomUUID(),
        contextSnapshot: buildInitialContextSnapshot(strategy),
      })
      .returning();

    const pipelineExecutionId = execution.id;

    logger.info("Pipeline execution created", {
      pipelineExecutionId,
      strategyId: strategy.id,
    });

    // Emit planning event
    progressEmitterService.emitPlanning(pipelineExecutionId, strategy);

    // Initialize context snapshot for incremental updates
    const contextSnapshot: IngestionContextSnapshot = {
      orchestrationType: "autonomous_research",
      researchSubject: strategy.researchSubject,
      strategy,
      collectorResults: [],
      metrics: {
        sourcesCollected: 0,
        sourcesFailed: 0,
        entitiesCreated: 0,
        relationshipsCreated: 0,
        datasetItemsStored: 0,
        datasetId: null,
        documentTemplateId: null,
        tokenBudgetUsed: 0,
      },
      appProvisioningLog: [],
    };

    try {
      // ─── Phase 1: Collecting ─────────────────────────────────────────
      await updateExecutionStatus(pipelineExecutionId, "running", contextSnapshot);

      const collectionResult = await collectionExecutorService.execute(
        strategy,
        {
          onProgress: (payload) => {
            progressEmitterService.emitCollecting(pipelineExecutionId, payload);
          },
        },
      );

      contextSnapshot.collectorResults = collectionResult.results;
      contextSnapshot.metrics.sourcesCollected = collectionResult.results.filter(
        (r) => r.status === "completed",
      ).length;
      contextSnapshot.metrics.sourcesFailed = collectionResult.results.filter(
        (r) => r.status === "failed" || r.status === "timeout",
      ).length;

      // Check if all collectors failed
      if (collectionResult.allContent.length === 0) {
        throw new Error(
          "All source collectors failed — no content was collected",
        );
      }

      // Deduplicate collected content
      const deduplicatedContent = await deduplicationService.deduplicate(
        collectionResult.allContent,
      );

      // ─── Phase 2: Extracting ─────────────────────────────────────────
      await updateExecutionStatus(pipelineExecutionId, "running", contextSnapshot);

      // Ensure Memory Library module is active for KG browsing (Req 10.2)
      const extractingProvision = await appProvisioningService.ensureAppsRunning(
        "extracting",
        orgContext,
      );
      contextSnapshot.appProvisioningLog.push(...extractingProvision.log);
      if (!extractingProvision.allSuccessful) {
        logger.warn("App provisioning warning at extracting stage", {
          pipelineExecutionId,
          log: extractingProvision.log,
        });
      }

      const kgResult = await knowledgeIngestionService.ingest(
        deduplicatedContent,
        strategy.researchSubject,
        pipelineExecutionId,
        orgContext,
        {
          onProgress: (payload) => {
            progressEmitterService.emitExtracting(pipelineExecutionId, payload);
          },
        },
      );

      contextSnapshot.metrics.entitiesCreated = kgResult.entitiesCreated;
      contextSnapshot.metrics.relationshipsCreated = kgResult.relationshipsCreated;

      // Build a mapping from collected content to KG node IDs for dataset linking
      const knowledgeNodeIds = buildNodeIdMap(
        deduplicatedContent,
        collectionResult.results,
        kgResult.nodeIds,
      );

      // Dataset population
      const datasetResult = await datasetIngestionService.ingest(
        deduplicatedContent,
        strategy.researchSubject,
        pipelineExecutionId,
        knowledgeNodeIds,
        orgContext,
      );

      contextSnapshot.metrics.datasetItemsStored = datasetResult.itemsCreated;
      contextSnapshot.metrics.datasetId = datasetResult.datasetId;

      // Emit final extracting progress with dataset items
      progressEmitterService.emitExtracting(pipelineExecutionId, {
        stage: "extracting",
        entitiesCreated: kgResult.entitiesCreated,
        relationshipsCreated: kgResult.relationshipsCreated,
        datasetItemsStored: datasetResult.itemsCreated,
      });

      // ─── Phase 3: Synthesizing ──────────────────────────────────────
      await updateExecutionStatus(pipelineExecutionId, "running", contextSnapshot);

      // Ensure Draft Sandbox module is active for Synthesis Report viewing (Req 10.3)
      const synthesizingProvision = await appProvisioningService.ensureAppsRunning(
        "synthesizing",
        orgContext,
      );
      contextSnapshot.appProvisioningLog.push(...synthesizingProvision.log);
      if (!synthesizingProvision.allSuccessful) {
        logger.warn("App provisioning warning at synthesizing stage", {
          pipelineExecutionId,
          log: synthesizingProvision.log,
        });
      }

      progressEmitterService.emitSynthesizing(pipelineExecutionId, 0);

      const synthesisResult = await synthesisService.synthesize({
        content: deduplicatedContent,
        researchSubject: strategy.researchSubject,
        datasetName: datasetResult.datasetName,
        entitiesCreated: kgResult.entitiesCreated,
        relationshipsCreated: kgResult.relationshipsCreated,
        orgContext,
      });

      contextSnapshot.metrics.documentTemplateId = synthesisResult.documentTemplateId;

      progressEmitterService.emitSynthesizing(pipelineExecutionId, 100);

      // ─── Phase 4: Completed ──────────────────────────────────────────
      const durationMs = Date.now() - startTime;

      await updateExecutionStatus(pipelineExecutionId, "completed", contextSnapshot, {
        completedAt: new Date(),
      });

      const completionSummary = {
        sourcesCollected: contextSnapshot.metrics.sourcesCollected,
        sourcesFailed: contextSnapshot.metrics.sourcesFailed,
        entitiesCreated: contextSnapshot.metrics.entitiesCreated,
        relationshipsCreated: contextSnapshot.metrics.relationshipsCreated,
        datasetItemsStored: contextSnapshot.metrics.datasetItemsStored,
        datasetId: contextSnapshot.metrics.datasetId!,
        documentTemplateId: contextSnapshot.metrics.documentTemplateId!,
        durationMs,
      };

      progressEmitterService.emitCompleted(pipelineExecutionId, completionSummary);

      logger.info("Orchestration completed successfully", {
        pipelineExecutionId,
        strategyId: strategy.id,
        ...completionSummary,
      });

      return {
        pipelineExecutionId,
        strategyId: strategy.id,
        status: "completed",
      };
    } catch (error: unknown) {
      // ─── Fatal Error Handling ────────────────────────────────────────
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error("Orchestration failed", {
        pipelineExecutionId,
        strategyId: strategy.id,
        error: errorMessage,
      });

      // Update execution record to failed
      await updateExecutionStatus(pipelineExecutionId, "failed", contextSnapshot, {
        completedAt: new Date(),
        error: errorMessage,
      });

      // Emit failed event with partial results
      progressEmitterService.emitFailed(pipelineExecutionId, errorMessage, {
        sourcesCollected: contextSnapshot.metrics.sourcesCollected,
        sourcesFailed: contextSnapshot.metrics.sourcesFailed,
        entitiesCreated: contextSnapshot.metrics.entitiesCreated,
        relationshipsCreated: contextSnapshot.metrics.relationshipsCreated,
        datasetItemsStored: contextSnapshot.metrics.datasetItemsStored,
        datasetId: contextSnapshot.metrics.datasetId ?? undefined,
        documentTemplateId: contextSnapshot.metrics.documentTemplateId ?? undefined,
      });

      return {
        pipelineExecutionId,
        strategyId: strategy.id,
        status: "failed",
      };
    }
  },

  /**
   * Get the current status of an orchestration run.
   * Reads the pipeline execution record and returns a full IngestionRunStatus.
   */
  async getStatus(
    pipelineExecutionId: number,
    orgContext: OrgContext,
  ): Promise<IngestionRunStatus> {
    const execution = await getExecutionRecord(pipelineExecutionId, orgContext);

    const snapshot = execution.contextSnapshot as IngestionContextSnapshot | null;

    if (!snapshot || snapshot.orchestrationType !== "autonomous_research") {
      const error = new Error(
        `Pipeline execution ${pipelineExecutionId} is not an autonomous research run`,
      );
      (error as any).status = 404;
      throw error;
    }

    const stage = mapExecutionStatusToStage(execution.status, snapshot);

    return {
      pipelineExecutionId: execution.id,
      stage,
      researchSubject: snapshot.researchSubject,
      strategy: snapshot.strategy,
      metrics: {
        sourcesCollected: snapshot.metrics.sourcesCollected,
        sourcesFailed: snapshot.metrics.sourcesFailed,
        entitiesCreated: snapshot.metrics.entitiesCreated,
        relationshipsCreated: snapshot.metrics.relationshipsCreated,
        datasetItemsStored: snapshot.metrics.datasetItemsStored,
        datasetId: snapshot.metrics.datasetId,
        documentTemplateId: snapshot.metrics.documentTemplateId,
        tokenBudgetUsed: snapshot.metrics.tokenBudgetUsed,
        durationMs: execution.completedAt
          ? new Date(execution.completedAt).getTime() -
            new Date(execution.startedAt).getTime()
          : Date.now() - new Date(execution.startedAt).getTime(),
      },
      startedAt: execution.startedAt.toISOString(),
      completedAt: execution.completedAt?.toISOString() ?? null,
      error: execution.error ?? undefined,
    };
  },

  /**
   * List past autonomous research runs for the organization.
   * Queries pipeline executions with orchestrationType "autonomous_research".
   */
  async listRuns(
    orgContext: OrgContext,
    limit: number = 20,
  ): Promise<IngestionRunSummary[]> {
    const pipelineId = await findOrchestratorPipelineId(orgContext);

    if (!pipelineId) {
      return [];
    }

    const executions = await db
      .select()
      .from(pipelineExecutions)
      .where(
        and(
          eq(pipelineExecutions.pipelineId, pipelineId),
          ...(orgContext.organizationId
            ? [eq(pipelineExecutions.organizationId, orgContext.organizationId)]
            : []),
        ),
      )
      .orderBy(desc(pipelineExecutions.startedAt))
      .limit(limit);

    return executions
      .filter((exec) => {
        const snapshot = exec.contextSnapshot as IngestionContextSnapshot | null;
        return snapshot?.orchestrationType === "autonomous_research";
      })
      .map((exec) => {
        const snapshot = exec.contextSnapshot as IngestionContextSnapshot;
        return {
          pipelineExecutionId: exec.id,
          subject: snapshot.researchSubject.value,
          subjectType: snapshot.researchSubject.type,
          status: mapExecutionStatusToStage(exec.status, snapshot),
          date: exec.startedAt.toISOString(),
          metrics: {
            sourcesCollected: snapshot.metrics.sourcesCollected,
            entitiesCreated: snapshot.metrics.entitiesCreated,
            datasetItemsStored: snapshot.metrics.datasetItemsStored,
          },
        };
      });
  },

  /**
   * Delete a run record. Preserves KG entities and dataset items.
   * Delegates to the run-lifecycle service pattern.
   */
  async deleteRun(
    pipelineExecutionId: number,
    orgContext: OrgContext,
  ): Promise<void> {
    const { runLifecycleService } = await import("./run-lifecycle.service.js");
    return runLifecycleService.deleteRun(pipelineExecutionId, orgContext);
  },

  /**
   * Re-run a previous orchestration with optional parameter overrides.
   *
   * Reads the original strategy from the pipeline execution record, generates
   * a new strategy with the provided overrides, and executes it.
   */
  async rerun(
    pipelineExecutionId: number,
    overrides: Partial<ResearchSubjectInput>,
    orgContext: OrgContext,
  ): Promise<IngestionOrchestrationResult> {
    logger.info("Re-running orchestration", {
      pipelineExecutionId,
      overrides,
    });

    // Get the original execution and its strategy
    const execution = await getExecutionRecord(pipelineExecutionId, orgContext);
    const snapshot = execution.contextSnapshot as IngestionContextSnapshot | null;

    if (!snapshot || snapshot.orchestrationType !== "autonomous_research") {
      const error = new Error(
        `Pipeline execution ${pipelineExecutionId} is not an autonomous research run`,
      );
      (error as any).status = 404;
      throw error;
    }

    // Build new options from original strategy + overrides
    const originalSubject = snapshot.researchSubject;
    const options: ResearchSubjectInput = {
      value: originalSubject.value,
      maxSources: overrides.maxSources ?? snapshot.strategy.maxSources,
      tokenBudget: overrides.tokenBudget ?? snapshot.strategy.tokenBudget,
      enabledCollectors: overrides.enabledCollectors,
    };

    // Generate a new strategy with the combined parameters
    const newStrategy = await strategyPlannerService.generateStrategy(
      originalSubject,
      orgContext,
      options,
    );

    // Execute with the new strategy
    return this.execute(newStrategy, orgContext);
  },
};

// ─── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Ensure a system pipeline record exists for autonomous research orchestration.
 * Creates it if it doesn't exist, returns the pipeline ID.
 */
async function ensureOrchestratorPipeline(orgContext: OrgContext): Promise<number> {
  const existing = await db.query.pipelines.findFirst({
    where: and(
      eq(pipelines.name, ORCHESTRATOR_PIPELINE_NAME),
      ...(orgContext.organizationId
        ? [eq(pipelines.organizationId, orgContext.organizationId)]
        : []),
    ),
  });

  if (existing) {
    return existing.id;
  }

  const [newPipeline] = await db
    .insert(pipelines)
    .values({
      name: ORCHESTRATOR_PIPELINE_NAME,
      description: "System pipeline for autonomous research ingestion orchestration",
      triggerType: "manual",
      organizationId: orgContext.organizationId,
      createdBy: orgContext.userId,
      createdAt: new Date(),
      isActive: true,
    })
    .returning();

  logger.info("Created orchestrator system pipeline", {
    pipelineId: newPipeline.id,
    organizationId: orgContext.organizationId,
  });

  return newPipeline.id;
}

/**
 * Find the orchestrator pipeline ID without creating it.
 * Returns null if no pipeline exists.
 */
async function findOrchestratorPipelineId(
  orgContext: OrgContext,
): Promise<number | null> {
  const existing = await db.query.pipelines.findFirst({
    where: and(
      eq(pipelines.name, ORCHESTRATOR_PIPELINE_NAME),
      ...(orgContext.organizationId
        ? [eq(pipelines.organizationId, orgContext.organizationId)]
        : []),
    ),
  });

  return existing?.id ?? null;
}

/**
 * Get a pipeline execution record, verifying org access.
 */
async function getExecutionRecord(
  pipelineExecutionId: number,
  orgContext: OrgContext,
): Promise<PipelineExecution> {
  const [execution] = await db
    .select()
    .from(pipelineExecutions)
    .where(
      and(
        eq(pipelineExecutions.id, pipelineExecutionId),
        ...(orgContext.organizationId
          ? [eq(pipelineExecutions.organizationId, orgContext.organizationId)]
          : []),
      ),
    )
    .limit(1);

  if (!execution) {
    const error = new Error(
      `Pipeline execution ${pipelineExecutionId} not found or not accessible`,
    );
    (error as any).status = 404;
    throw error;
  }

  return execution;
}

/**
 * Update a pipeline execution record's status and contextSnapshot.
 */
async function updateExecutionStatus(
  pipelineExecutionId: number,
  status: string,
  contextSnapshot: IngestionContextSnapshot,
  extra?: { completedAt?: Date; error?: string },
): Promise<void> {
  await db
    .update(pipelineExecutions)
    .set({
      status,
      contextSnapshot,
      ...(extra?.completedAt ? { completedAt: extra.completedAt } : {}),
      ...(extra?.error ? { error: extra.error } : {}),
    })
    .where(eq(pipelineExecutions.id, pipelineExecutionId));
}

/**
 * Build the initial context snapshot stored when the pipeline execution is created.
 */
function buildInitialContextSnapshot(
  strategy: GatheringStrategy,
): IngestionContextSnapshot {
  return {
    orchestrationType: "autonomous_research",
    researchSubject: strategy.researchSubject,
    strategy,
    collectorResults: [],
    metrics: {
      sourcesCollected: 0,
      sourcesFailed: 0,
      entitiesCreated: 0,
      relationshipsCreated: 0,
      datasetItemsStored: 0,
      datasetId: null,
      documentTemplateId: null,
      tokenBudgetUsed: 0,
    },
    appProvisioningLog: [],
  };
}

/**
 * Map the pipeline execution status string to an IngestionStage.
 * Uses the contextSnapshot metrics to infer the current stage for "running" executions.
 */
function mapExecutionStatusToStage(
  executionStatus: string,
  snapshot: IngestionContextSnapshot,
): IngestionStage {
  if (executionStatus === "completed") return "completed";
  if (executionStatus === "failed") return "failed";

  // For running executions, infer the current stage from metrics
  if (snapshot.metrics.documentTemplateId !== null) return "completed";
  if (snapshot.metrics.entitiesCreated > 0 || snapshot.metrics.datasetItemsStored > 0) {
    return "synthesizing";
  }
  if (snapshot.collectorResults.length > 0) return "extracting";
  if (snapshot.strategy.collectors.length > 0) return "collecting";
  return "planning";
}

/**
 * Build a map of collected content to KG node IDs.
 * Maps `{collectorId}:{url}` → nodeId for dataset item linking.
 */
function buildNodeIdMap(
  content: import("./collectors/collector.interface.js").CollectedContent[],
  collectorResults: CollectorResult[],
  nodeIds: number[],
): Map<string, number> {
  const nodeMap = new Map<string, number>();

  // Assign node IDs to content items in order
  // The knowledge ingestion service processes items in order and returns nodeIds in the same order
  let nodeIdx = 0;
  for (const item of content) {
    if (nodeIdx < nodeIds.length) {
      const collectorId = (item.metadata?.collectorId as string) ?? "";
      const key = `${collectorId}:${item.url}`;
      nodeMap.set(key, nodeIds[nodeIdx]);
      nodeIdx++;
    }
  }

  return nodeMap;
}
