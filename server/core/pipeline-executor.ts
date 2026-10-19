/**
 * Pipeline Execution Service
 * 
 * Orchestrates pipeline execution with variable substitution across steps
 */

import { db } from "@server/database_service.js";

import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import type { AIProviderMetadata, AIApiCallConfig, ApiConfig, CurlConfig, JiraMetadata, RagAsset, Pipeline, PipelineStep, RepeaterConfig, TransformerConfig, OpenAPIJobConfig, Job, RetryConfig } from "@shared/schema/index.js";
import { assertOrgId, getSystemOrgContext } from "@server/utils/auth-context.js";
import type { WorkflowReleaseManifest } from "@shared/workflow-release.js";
import {
  resolveJobConfig,
  resolveVariables,
  extractJobOutput,
  type VariableContext,
  VariableResolverError
} from "./variable-resolver.js";
import { pipelineService } from "@domain/pipeline/core/pipeline.service.js";
import { jobService } from "@domain/jobs/job.service.js";
import {
  pipelines,
  pipelineSteps,
  pipelineExecutions,
  pipelineStepExecutions,
  missionRuns,
  missions,
  ragAssets,
  apiSpecs,
  credentials,
  orgSpecAccess,
  aiUsageLogs
} from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { augmentPromptWithRag } from "../domain/knowledge/core/rag-utils.service.js";
import { buildHybridContextFromAssets } from "../domain/knowledge/core/rag-langchain.service.js";
import { uploadFileToGemini, supportsGeminiFileAttachments, type GeminiFileUploadResult } from "../domain/ai/core/gemini-files.service.js";
import { resolveRagContentSources, storeJobOutputAsKnowledge, getJobOutputStorageConfig } from "@server/knowledge/knowledge-store.js";
import { validateUrl } from "../domain/auth/core/security.service.js";
import { stateTracker } from "../integrations/state-tracker-redis.js";
import { evaluateDecisionNode, type DecisionNodeConfig } from "./decision-node.js";
import { checkCycleBreaker, checkStagnationLock, checkDoomsdayClock, calculatePayloadHash } from "./loopbane-protocols.js";
import { processExplicitKnowledgeGraphRules, processSemanticEnrichment } from "../domain/knowledge/core/extraction/knowledge-graph-integration.js";
import type { KnowledgeGraphConfig } from "@shared/schema/index.js";
import { executePipelineStep, resolveAndExecuteJob, type StepExecutionResult } from "./pipeline-step-runner.js";
import { executeStepViaQueue } from "../integrations/job-queue.js";
import { createRootTrace, generateTraceparent, createChildSpan } from "../domain/core/infrastructure/trace-context.service.js";
import { shouldSample } from "../domain/core/infrastructure/tracing/trace-sampler.service.js";
import { errorDiagnosisEngine } from "@domain/diagnostics/index.js";
import { queueExtractionJob } from "../domain/knowledge/knowledge-queue.js";
import { contextInjectionService } from "@domain/agents/core/context-injection/index.js";
import { knowledgeDocumentExtractions } from "@shared/schema/index.js";

import { checkOrgFeatureEnabled, safeJsonParse } from "../domain/pipeline/core/utils.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PipelineExecutor");
import { hookRegistry } from "../domain/pipeline/hooks/execution-hooks.js";
import { infrastructureProtocol } from "./infrastructure-protocol.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { driftDetectionService } from "@domain/pipeline/core/drift-detection.service.js";

// Initialize side-effect hooks
// Moved to server/index.ts for earlier initialization

/**
 * Pipeline Execution Service
 */
export interface PipelineExecutionResult {
  success: boolean;
  executionId: number;
  error?: string;
  stepResults?: Array<{
    stepId: number;
    jobId: number | null;
    stepOrder: number;
    outputName: string | null;
    output: string;
    status: string;
    error?: string;
    executedAt?: string | Date;
    completedAt?: string | Date;
    knowledgeDocumentId?: number;
  }>;
}

export class PipelineExecutor {
  private runningExecutions: Set<number> = new Set();
  private abortedExecutions: Set<number> = new Set();
  private pausedExecutions: Set<number> = new Set();

  /**
   * Signal an execution to stop at the next step boundary.
   */
  abortExecution(executionId: number) {
    this.abortedExecutions.add(executionId);
    console.log(`[Pipeline Executor] Abort signal received for execution ${executionId}`);
  }

  /**
   * Signal an execution to pause at the next step boundary.
   */
  pauseExecution(executionId: number) {
    this.pausedExecutions.add(executionId);
    console.log(`[Pipeline Executor] Pause signal received for execution ${executionId}`);
  }

  /**
   * Resume a paused execution.
   */
  resumeExecution(executionId: number) {
    this.pausedExecutions.delete(executionId);
    console.log(`[Pipeline Executor] Resume signal received for execution ${executionId}`);
  }

  /**
   * Load the executable graph for a run: ordered steps plus the jobs they bind.
   *
   * With `workflowReleaseId` the graph comes from the release MANIFEST — the
   * rows snapshotted at publish time — so editing the draft pipeline between
   * publish and run (or between pause and resume) can never change what the
   * released run executes. Without it, the live pipeline_steps/jobs rows are
   * read, exactly as before.
   */
  private async loadExecutionGraph(
    pipelineId: number,
    pipeline: Pipeline,
    workflowReleaseId?: number | null,
  ): Promise<{ steps: PipelineStep[]; stepMap: Map<number, PipelineStep>; jobMap: Map<number, Job>; pipeline: Pipeline; manifest?: WorkflowReleaseManifest }> {
    if (workflowReleaseId) {
      // Lazy to avoid a module cycle: the lifecycle service already imports the
      // executor for startRun.
      const { workflowLifecycleService } = await import("../domain/pipeline/core/workflow-lifecycle.service.js");
      const found = await workflowLifecycleService.getReleaseManifest(workflowReleaseId);
      if (!found) throw new Error(`Workflow release ${workflowReleaseId} not found`);
      const manifest = found.manifest;
      // A release pinned to a different pipeline must never run here.
      if (manifest.pipeline.id !== pipelineId) {
        throw new Error(
          `Workflow release ${workflowReleaseId} is pinned to pipeline ${manifest.pipeline.id}, not ${pipelineId}`
        );
      }

      const steps = manifest.steps as unknown as PipelineStep[];
      if (steps.length === 0) throw new Error(`Pipeline has no steps`);

      const stepMap = new Map<number, PipelineStep>();
      for (const step of steps) stepMap.set(step.id, step);

      const jobMap = new Map<number, Job>();
      for (const job of Object.values(manifest.jobs)) {
        const j = job as unknown as Job;
        jobMap.set(j.id, j);
      }

      // The release's governance rides along: the snapshot's settings, not the
      // draft's current ones.
      const releasePipeline = {
        ...pipeline,
        governorSettings: manifest.pipeline.governorSettings,
        governorPolicyId: manifest.pipeline.governorPolicyId,
        monthlyBudgetUsd: manifest.pipeline.monthlyBudgetUsd,
        enableKnowledgeGraph: manifest.pipeline.enableKnowledgeGraph,
        knowledgeGraphConfig: manifest.pipeline.knowledgeGraphConfig,
      } as Pipeline;

      return { steps, stepMap, jobMap, pipeline: releasePipeline, manifest };
    }

    const steps = await pipelineService.listSteps(pipelineId);
    if (steps.length === 0) throw new Error(`Pipeline has no steps`);

    const stepMap = new Map<number, PipelineStep>();
    const jobIds = new Set<number>();
    for (const step of steps) {
      stepMap.set(step.id, step);
      if (step.jobId) jobIds.add(step.jobId);
      if (step.fallbackJobId) jobIds.add(step.fallbackJobId); // Phase 2: prefetch fallback jobs too
    }

    // Pre-fetch all jobs
    const orgContext = getSystemOrgContext(pipeline.organizationId);
    const jobList = await jobService.getByIds(Array.from(jobIds), orgContext);
    const jobMap = new Map<number, Job>();
    for (const job of jobList) {
      jobMap.set(job.id, job);
    }

    return { steps, stepMap, jobMap, pipeline };
  }

  async executePipeline(
    pipelineId: number,
    userId: string,
    startStepId?: number | null,
    ttl?: number | null,
    initialVariables?: Record<string, any>,
    parentExecutionId?: number,
    initialState?: Record<number, string>, // Map of stepOrder -> output
    missionId?: number,
    missionRunId?: number,
    workflowRef?: { workflowReleaseId?: number; workflowDeploymentId?: number }
  ): Promise<PipelineExecutionResult> {
    try {
      // PRE-FLIGHT INFRASTRUCTURE CHECK
      const infraHealth = await infrastructureProtocol.performPreFlightCheck();
      if (!infraHealth.healthy) {
        return {
          success: false,
          executionId: -1,
          error: `Infrastructure Pre-flight Failure: ${infraHealth.issues.join(", ")}`
        };
      }

      // Determine trace source and initialize root trace
      const traceSource = (missionId || missionRunId) ? 'manual' : 'api';
      const rootTrace = createRootTrace(shouldSample(traceSource));

      // Resolve Shadow Mode from Mission Run
      let isShadowMode = false;
      if (missionRunId) {
        try {
          const { missionRunService } = await import("../domain/mission/core/mission-run.service.js");
          const run = await missionRunService.getById(missionRunId);
          if (run?.isShadow) {
            isShadowMode = true;
            console.log(`[Pipeline Executor] Detected Shadow Mode for Mission Run ${missionRunId}`);
          }
        } catch (err) {
          console.warn(`[Pipeline Executor] Failed to resolve shadow status for run ${missionRunId}:`, err);
        }
      }

      let pipeline = await pipelineService.getSystem(pipelineId);
      if (!pipeline) throw new Error(`Pipeline not found`);

      const pipelineExecution = await pipelineService.createExecution({
        pipelineId,
        status: "running",
        createdBy: userId,
        startStepId: startStepId || undefined,
        ttl: ttl || undefined,
        traceId: rootTrace.traceId,
        samplingRate: rootTrace.traceFlags === '01' ? "1.00" : "0.00",
        traceSource: traceSource,
        parentExecutionId: parentExecutionId,
        missionId: missionId ?? undefined,
        missionRunId: missionRunId ?? undefined,
        isShadow: isShadowMode,
        organizationId: pipeline.organizationId,
        workflowReleaseId: workflowRef?.workflowReleaseId,
        workflowDeploymentId: workflowRef?.workflowDeploymentId,
      }) as any;

      const graph = await this.loadExecutionGraph(pipelineId, pipeline, workflowRef?.workflowReleaseId);
      const steps = graph.steps;
      const stepMap = graph.stepMap;
      const jobMap = graph.jobMap;
      pipeline = graph.pipeline;

      // NEW: Link Mission Run ID immediately if provided
      if (missionRunId) {
        try {
          const { missionRunService } = await import("../domain/mission/core/mission-run.service.js");
          await missionRunService.update(missionRunId, { pipelineExecutionId: pipelineExecution.id });
          console.log(`[Pipeline Executor] Immediately linked mission run ${missionRunId} to execution ${pipelineExecution.id}`);
        } catch (err) {
          console.warn(`[Pipeline Executor] Failed to link mission run ${missionRunId} immediately:`, err);
        }
      }

      // Initialize variable context
      const context: VariableContext & { 
        data?: Record<string, any>; 
        traceContext?: any; 
        executionId?: number; 
        missionId?: number; 
        pipelineExecutionId?: number;
        missionRunId?: number;
        isShadow?: boolean;
        userId?: string;
        /** Set on release-pinned runs: which form releases the manifest froze. */
        workflowRelease?: { id: number; formReleases: Record<string, { releaseNumber: number; formRevision: number; name: string }> };
        history: Record<number, any>; // StepOrder -> Output
      } = {
        userId,
        named: initialVariables || {},
        positional: initialState || {}, // Seed positional outputs from Time Travel
        data: initialVariables || {}, // Allow access via {{data.foo}} as well
        traceContext: rootTrace,      // Inject Trace Context
        executionId: pipelineExecution.id,
        pipelineExecutionId: pipelineExecution.id,
        missionId: missionId ?? undefined,
        orgId: pipeline.organizationId ?? undefined,
        missionRunId: missionRunId ?? undefined,
        isShadow: isShadowMode,
        workflowRelease: graph.manifest && workflowRef?.workflowReleaseId
          ? { id: workflowRef.workflowReleaseId, formReleases: graph.manifest.formReleases ?? {} }
          : undefined,
        history: { ...initialState },
      };


      const stepResults: Array<{
        stepId: number;
        jobId: number | null;
        stepOrder: number;
        outputName: string | null;
        output: string;
        status: string;
        error?: string;
        executedAt?: Date;
        completedAt?: Date;
        knowledgeDocumentId?: number;
      }> = [];

      // Track visited steps to prevent infinite loops
      const visitedSteps = new Set<number>();
      const traversalPath: Array<{ stepId: number; stepOrder: number; timestamp: Date }> = [];

      // Get start step
      let currentStep: PipelineStep | null = null;
      if (startStepId) {
        currentStep = stepMap.get(startStepId) || null;
        if (!currentStep) {
          throw new Error(`Step ${startStepId} not found in pipeline`);
        }
        console.log(`[Pipeline Executor] Starting execution from step ${startStepId} (order ${currentStep.order})`);
      } else {
        // Start with step with lowest order
        currentStep = steps.reduce((min: PipelineStep, step: PipelineStep) =>
          step.order < min.order ? step : min
        );
        if (currentStep) {
          console.log(`[Pipeline Executor] Starting execution from first step (order ${currentStep.order}, stepId ${currentStep.id})`);
        }
      }

      // Delegate execution to shared loop processor
      return await this._processExecutionLoop(
        pipeline,
        pipelineExecution,
        steps,
        stepMap,
        context,
        currentStep,
        stepResults,
        visitedSteps,
        traversalPath,
        userId,
        jobMap
      );

    } catch (error) {
      console.error(`[Pipeline Executor] Critical synchronous error in executePipeline:`, error);
      // @ts-ignore - access variable if it was defined in the try block
      const fallbackId = typeof pipelineExecution !== 'undefined' ? pipelineExecution.id : -1;
      return {
        success: false,
        executionId: fallbackId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async resumePipelineExecution(
    executionId: number,
    fromStepId?: number | null,
    resumeData?: Record<string, any>
  ): Promise<PipelineExecutionResult> {
    try {
      const pipelineExecution = await pipelineService.getExecutionSystem(executionId) as any;
      if (!pipelineExecution) {
        throw new Error(`Pipeline execution ${executionId} not found`);
      }

      if (pipelineExecution.status !== "running" && pipelineExecution.status !== "waiting_async") {
        // Allow resuming if we can reset to running, but warn
        if (pipelineExecution.status === "failed" || pipelineExecution.status === "completed") {
          // For now, strict check, but waiting_async is allowed
          // throw new Error(`Pipeline execution ${executionId} is ${pipelineExecution.status}`);
        }
      }

      if (pipelineExecution.status !== "running") {
        await pipelineService.updateExecution(executionId, { status: "running" });
      }

      let pipeline = await pipelineService.getSystem(pipelineExecution.pipelineId);
      if (!pipeline) throw new Error(`Pipeline not found`);

      // A run pinned to a workflow release resumes against the release manifest —
      // manifest steps keep their original `id`, so completed step executions
      // still correlate by pipelineStepId against stepMap below.
      const graph = await this.loadExecutionGraph(
        pipelineExecution.pipelineId,
        pipeline,
        pipelineExecution.workflowReleaseId,
      );
      const steps = graph.steps;
      const stepMap = graph.stepMap;
      const jobMap = graph.jobMap;
      pipeline = graph.pipeline;

      const completedStepExecutions = await db
        .select()
        .from(pipelineStepExecutions)
        .where(eq(pipelineStepExecutions.pipelineExecutionId, executionId))
        .orderBy(pipelineStepExecutions.stepOrder);

      const context: VariableContext & { 
        data?: Record<string, any>; 
        traceContext?: any; 
        history: Record<number, any>;
        orgId?: number;
        missionId?: number;
        userId?: string;
        /** Set on release-pinned runs: which form releases the manifest froze. */
        workflowRelease?: { id: number; formReleases: Record<string, { releaseNumber: number; formRevision: number; name: string }> };
      } = {
        userId: pipelineExecution.createdBy ?? undefined,
        named: {},
        positional: {},
        data: resumeData || {},
        history: {},
        orgId: pipeline.organizationId ?? undefined,
        missionId: pipelineExecution.missionId ?? undefined,
        workflowRelease: graph.manifest && pipelineExecution.workflowReleaseId
          ? { id: pipelineExecution.workflowReleaseId, formReleases: graph.manifest.formReleases ?? {} }
          : undefined,
        // Resume logic: Needs to reconstruct trace context from DB if possible
        // For now, we'll generate a new trace if missing or leave undefined (partial traceability on resume)
        // Ideally we fetch the trace_id from pipelineExecution
        traceContext: pipelineExecution.traceId ? {
          traceId: pipelineExecution.traceId,
          spanId: pipelineExecution.traceId.substring(0, 16), // Fallback/Hack if we don't know last span
          traceFlags: '01'
        } : createRootTrace(true)
      };


      for (const stepExec of completedStepExecutions) {
        if (stepExec.status === "success" && stepExec.output) {
          const step = stepMap.get(stepExec.pipelineStepId);
          if (step) {
            context.positional[step.order] = stepExec.output;
            context.history[step.order] = safeJsonParse(stepExec.output);
            if (step.outputName) context.named[step.outputName] = stepExec.output;
          }
        }
      }

      const stepResults: Array<{
        stepId: number;
        jobId: number | null;
        stepOrder: number;
        outputName: string | null;
        output: string;
        status: string;
        error?: string;
        executedAt?: Date;
        completedAt?: Date;
        knowledgeDocumentId?: number;
      }> = completedStepExecutions.map(exec => ({
        stepId: exec.pipelineStepId,
        jobId: exec.jobId,
        stepOrder: exec.stepOrder,
        outputName: exec.outputName,
        output: exec.output || "",
        status: exec.status,
        error: (exec as any).error || undefined,
        executedAt: exec.executedAt || undefined,
        completedAt: exec.completedAt || undefined
      } as any));

      const visitedSteps = new Set<number>();
      for (const stepExec of completedStepExecutions) visitedSteps.add(stepExec.pipelineStepId);

      const traversalPath: Array<{ stepId: number; stepOrder: number; timestamp: Date }> = completedStepExecutions.map(exec => ({
        stepId: exec.pipelineStepId,
        stepOrder: exec.stepOrder,
        timestamp: exec.executedAt || new Date()
      }));

      let currentStep: PipelineStep | null = null;
      if (fromStepId) {
        currentStep = stepMap.get(fromStepId) || null;
        if (!currentStep) throw new Error(`Step ${fromStepId} not found`);
        console.log(`[Pipeline Executor] Resuming execution from step ${fromStepId}`);
      } else {
        if (completedStepExecutions.length > 0) {
          const lastCompleted = completedStepExecutions[completedStepExecutions.length - 1];
          const lastStep = stepMap.get(lastCompleted.pipelineStepId);
          if (lastStep) {
            const nextByOrder = steps.find((s: PipelineStep) => s.order === lastStep.order + 1);
            if (nextByOrder) {
              currentStep = nextByOrder;
              console.log(`[Pipeline Executor] Resuming after step ${lastStep.id}`);
            } else {
              // Nothing left to run: this resume finishes the execution. A human
              // approving a pipeline's final HIL step lands exactly here.
              await pipelineService.updateExecution(executionId, { status: "completed", completedAt: new Date() });
              pipelineExecution.status = "completed";
              await (this as any).firePipelineCompleteHooks(pipeline, pipelineExecution, stepResults, pipelineExecution.createdBy || undefined);
              return { success: true, executionId, stepResults };
            }
          }
        } else {
          currentStep = steps.reduce((min: PipelineStep, s: PipelineStep) => s.order < min.order ? s : min);
          if (currentStep) {
            console.log(`[Pipeline Executor] Resuming from start`);
          }
        }
      }

      if (!currentStep) throw new Error("Could not determine resume step");

      return await this._processExecutionLoop(
        pipeline,
        pipelineExecution,
        steps,
        stepMap,
        context,
        currentStep,
        stepResults,
        visitedSteps,
        traversalPath,
        pipelineExecution.createdBy || undefined,
        jobMap
      );

    } catch (error) {
      return {
        success: false,
        executionId: -1,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Diagnostic "Keep-Alive" trigger.
   * Checks if a pipeline is 'running' but has zero step executions.
   * If so, it manually triggers the first step to jump-start the engine.
   */
  async keepAlive(executionId: number): Promise<{ success: boolean; status: string; error?: string }> {
    try {
      const execution = await pipelineService.getExecutionSystem(executionId);
      if (!execution) return { success: false, status: 'not_found', error: `Execution ${executionId} not found` };
      
      if (execution.status !== 'running') {
        return { success: false, status: execution.status, error: `Execution is in ${execution.status} state, not running.` };
      }

      const steps = await db.select().from(pipelineStepExecutions).where(eq(pipelineStepExecutions.pipelineExecutionId, executionId));
      if (steps.length > 0) {
        return { success: true, status: 'active', error: `Execution has ${steps.length} steps, already active.` };
      }

      logger.warn(`[PipelineExecutor] Keep-Alive triggered for stagnant execution ${executionId}. Jump-starting...`);

      // Re-trigger the pipeline from the beginning (or from startStepId)
      // We use resumePipelineExecution with no steps completed to force a fresh start of the loop
      this.resumePipelineExecution(executionId).catch((err: any) => {
        logger.error(`[PipelineExecutor] Failed to jump-start execution ${executionId}: ${err.message}`);
      });

      return { success: true, status: 'jump_started' };
    } catch (err: any) {
      return { success: false, status: 'error', error: err.message };
    }
  }

  /**
   * Phase 1: decide whether a step should run given its `runOnCondition` and the
   * outcome of the previously executed step (previous-executed-step semantics).
   * - "on_success" (default): run only when the previous step did NOT fail.
   * - "on_failure": run only when the previous step failed (recovery/cleanup steps).
   * - "always": always run.
   * A missing/blank value defaults to "on_success".
   */
  static shouldRunByCondition(runOnCondition: string | null | undefined, lastStepFailed: boolean): boolean {
    const cond = (runOnCondition || "on_success").trim();
    if (cond === "always") return true;
    if (cond === "on_failure") return lastStepFailed;
    return !lastStepFailed; // on_success (default)
  }

  /**
   * Phase 2: run a failed step's configured fallback job. Persists the fallback as
   * its own `pipelineStepExecutions` row linked to the failed step via
   * `parentStepExecutionId`. Returns true if the fallback job succeeded (the
   * failure is considered recovered), false otherwise.
   */
  private async _runFallbackJob(
    failedStep: PipelineStep,
    failedResult: StepExecutionResult,
    failedStepExecution: any,
    pipelineExecution: any,
    pipeline: any,
    context: VariableContext & { data?: Record<string, any> },
    stepResults: Array<any>,
    jobMap?: Map<number, Job>,
    userId?: string,
  ): Promise<boolean> {
    const fallbackJobId = failedStep.fallbackJobId!;

    // Resolve the fallback job (prefer the in-memory jobMap, fall back to a lookup).
    let fallbackJob: Job | undefined;
    try {
      fallbackJob = jobMap?.get(fallbackJobId) || await jobService.getById(fallbackJobId, getSystemOrgContext(pipeline.organizationId));
    } catch (err: any) {
      logger.error(`[PipelineExecutor] Fallback job ${fallbackJobId} lookup failed for step ${failedStep.id}: ${err.message}`);
    }
    if (!fallbackJob) {
      logger.error(`[PipelineExecutor] Fallback job ${fallbackJobId} not found for step ${failedStep.id} — treating as unrecovered.`);
      return false;
    }

    // Make the original failure visible to the fallback job via the mission blackboard.
    if (pipelineExecution.missionId) {
      try {
        const { missionService: ms } = await import("../domain/mission/core/mission.service.js");
        await ms.updateBlackboard(pipelineExecution.missionId, {
          [`_fallback_reason_${failedStep.id}`]: failedResult.error || "Step failed",
        }, userId || "pipeline_executor", `fallback context for step ${failedStep.id}`);
      } catch { /* best effort */ }
    }

    // Persist a dedicated step-execution row for the fallback, linked to the failed step.
    const fallbackExec = await pipelineService.createStepExecution({
      pipelineExecutionId: pipelineExecution.id,
      pipelineStepId: failedStep.id,
      jobId: fallbackJobId,
      stepOrder: failedStep.order,
      outputName: failedStep.outputName || null,
      output: "",
      status: "running",
      parentStepExecutionId: failedStepExecution.id,
      executedAt: new Date(),
    });

    logger.info(`[PipelineExecutor] Step ${failedStep.id} failed — running fallback job ${fallbackJobId} (exec ${fallbackExec.id}).`);

    let fbResult: StepExecutionResult;
    try {
      fbResult = await resolveAndExecuteJob(fallbackJob, pipeline, context, failedStep.order, pipelineExecution.id, fallbackExec.id, jobMap);
    } catch (err: any) {
      fbResult = { success: false, output: "", status: "failure", error: err?.message || String(err) };
    }

    await pipelineService.updateStepExecution(fallbackExec.id, {
      output: fbResult.output,
      status: fbResult.success ? "success" : "failure",
      error: fbResult.error || null,
      completedAt: new Date(),
    } as any);

    stepResults.push({
      stepId: failedStep.id, jobId: fallbackJobId, stepOrder: failedStep.order,
      outputName: failedStep.outputName, output: fbResult.output, status: fbResult.success ? "success" : "failure",
    } as any);

    logger.info(`[PipelineExecutor] Fallback job ${fallbackJobId} for step ${failedStep.id} finished: ${fbResult.success ? "recovered" : "failed"}.`);
    return !!fbResult.success;
  }

  private async _processExecutionLoop(
    pipeline: any,
    pipelineExecution: any,
    steps: PipelineStep[],
    stepMap: Map<number, PipelineStep>,
    context: VariableContext & { data?: Record<string, any>; history: Record<number, any> },
    currentStep: PipelineStep | null,
    stepResults: Array<{
      stepId: number;
      jobId: number | null;
      stepOrder: number;
      outputName: string | null;
      output: string;
      status: string;
      error?: string;
      knowledgeDocumentId?: number;
    }>,
    visitedSteps: Set<number>,
    traversalPath: Array<{ stepId: number; stepOrder: number; timestamp: Date }>,
    userId?: string,
    jobMap?: Map<number, Job>
  ): Promise<PipelineExecutionResult> {

    let shouldStop = false;
    let hasFailed = false;
    // Set just before the normal-exit hook call, so the catch below cannot fire the
    // hooks a second time for an error thrown after they already ran.
    let hooksFired = false;

    // ── Phase 1: runOnCondition gating state (previous-executed-step semantics) ──
    // Reconstruct outcome from any pre-populated stepResults so resume behaves like a
    // fresh run. `lastStepFailed` reflects the most recent step that actually ran
    // (skips are transparent); `pipelineHasFailures` is sticky across the whole run.
    const isFailureStatus = (s: string | undefined): boolean =>
      !!s && !["success", "completed", "skipped"].includes(s);
    const lastExecutedPrior = [...stepResults].reverse().find((r) => r.status !== "skipped");
    let lastStepFailed = lastExecutedPrior ? isFailureStatus(lastExecutedPrior.status) : false;
    let pipelineHasFailures = stepResults.some((r) => isFailureStatus(r.status));

    // Execution Locking
    if (this.runningExecutions.has(pipelineExecution.id)) {
      console.warn(`[Pipeline Executor] Execution ${pipelineExecution.id} is already running. Skipping duplicate loop.`);
      return { success: true, executionId: pipelineExecution.id, stepResults: stepResults as any };
    }
    this.runningExecutions.add(pipelineExecution.id);

    try {
      // --- MISSION GOVERNANCE PRE-FLIGHT ---
      if (pipelineExecution.missionId) {
        try {
          const { missionQueryService } = await import("../domain/mission/core/mission-query.service.js");
          const [mission] = await db.select().from(missions).where(eq(missions.id, pipelineExecution.missionId)).limit(1);
          if (!mission) throw new Error(`Mission ${pipelineExecution.missionId} not found`);
          
          const currentSpend = await missionQueryService.calculateTotalSpend(pipelineExecution.missionId);
          const budgetLimit = mission?.budgetLimitUsd ? parseFloat(String(mission.budgetLimitUsd)) : 5.00;
          if (currentSpend > budgetLimit) {
            throw new Error(`Mission budget exceeded: ${currentSpend.toFixed(2)} > ${budgetLimit.toFixed(2)}`);
          }

          if (mission && mission.objective) {
            const { missionAnalystService } = await import("../domain/mission/core/mission-analyst.service.js");
            const validation = await missionAnalystService.validateObjectiveClarity(mission.objective || "");
            if (validation.score < 20) {
              throw new Error(`Objective clarity critically low (${validation.score}/100): ${validation.feedback}`);
            }
          }
        } catch (err: any) {
          console.error(`[Pipeline Executor] Governance Pre-flight Block: ${err.message}`);
          return { success: false, executionId: pipelineExecution.id, error: err.message };
        }

        // ── KB PRE-MISSION BRIEFING (non-blocking) ──────────────────────────
        try {
          const plan = (context as any).data?.implementation_plan ?? (context as any).named?.implementation_plan;
          if (plan && pipelineExecution.missionId) {
            const { extractReferences } = await import("@domain/agents/core/context-injection/index.js");
            const { knowledgeBaseQuestionEngineService } = await import("@domain/agents/core/knowledge-base-question-engine.service.js");

            const refs = extractReferences(plan);
            if (refs.filePaths.length > 0) {
              const briefingPromise = knowledgeBaseQuestionEngineService.getPreMissionBriefing(
                pipeline.organizationId,
                refs.filePaths
              );

              const briefingTimeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("BRIEFING_TIMEOUT")), 3000)
              );

              const briefingItems = await Promise.race([briefingPromise, briefingTimeout]);

              if (briefingItems.length > 0) {
                (context as any).data = { ...((context as any).data || {}), _preMissionBriefing: briefingItems };
                logger.info(`[PipelineExecutor] Pre-mission briefing: ${briefingItems.length} unresolved KB questions surfaced`);
              }
            }
          }
        } catch (briefingErr: any) {
          logger.warn(`[PipelineExecutor] Pre-mission briefing failed (non-blocking): ${briefingErr.message}`);
        }
      }

      // --- HIL SEQUENCE PRE-FETCH ---
      let hilSequence: any[] = [];
      if (pipelineExecution.missionId) {
        try {
          const { missions: schemaMissions, missionTemplates: schemaTemplates } = await import("@shared/schema/index.js");
          const [missionRecord] = await db
            .select({ name: schemaMissions.name })
            .from(schemaMissions)
            .where(eq(schemaMissions.id, pipelineExecution.missionId))
            .limit(1);

          if (missionRecord) {
            const [template] = await db
              .select({ config: schemaTemplates.config })
              .from(schemaTemplates)
              .where(eq(schemaTemplates.name, missionRecord.name))
              .limit(1);

            if (template) {
              hilSequence = (template.config as any)?.sequence || [];
            }
          }
        } catch (err) {
          logger.warn(`[PipelineExecutor] Failed to check HIL sequence config:`, err as any);
        }
      }

      while (currentStep && !shouldStop) {
        const activeStep = currentStep;
        
        // ── CHECK ABORT/PAUSE SIGNALS ──
        if (this.abortedExecutions.has(pipelineExecution.id)) {
          console.warn(`[Pipeline Executor] Aborting execution ${pipelineExecution.id} via external signal.`);
          this.abortedExecutions.delete(pipelineExecution.id);
          this.pausedExecutions.delete(pipelineExecution.id);
          shouldStop = true;
          break;
        }

        while (this.pausedExecutions.has(pipelineExecution.id)) {
          if (this.abortedExecutions.has(pipelineExecution.id)) break;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

        // Check safety protocols
        const safetyResult = await this._checkSafetyProtocols(pipelineExecution, activeStep, context, stepResults, stepMap);
        if (safetyResult.action === 'abort' && safetyResult.result) return safetyResult.result;
        if (safetyResult.action === 'reroute' && safetyResult.newStep !== undefined) {
          currentStep = safetyResult.newStep ?? null;
          continue;
        }

        // ── Phase 1: runOnCondition gating (previous-executed-step semantics) ──
        // A step runs only when its declared condition matches the outcome of the
        // previously executed step. Mismatched steps are persisted as `skipped`
        // (queryable audit trail) and advance sequentially WITHOUT touching
        // `lastStepFailed`, so a downstream `on_failure` recovery step still sees the
        // original failure even when `on_success` steps were skipped in between.
        {
          const cond = (activeStep.runOnCondition || "on_success").trim();
          const conditionMatches = PipelineExecutor.shouldRunByCondition(activeStep.runOnCondition, lastStepFailed);

          if (!conditionMatches) {
            console.log(`[Pipeline Executor] Skipping step ${activeStep.id} (order ${activeStep.order}): runOnCondition='${cond}' not satisfied (lastStepFailed=${lastStepFailed})`);
            visitedSteps.add(activeStep.id);
            try {
              const skippedExec = await pipelineService.createStepExecution({
                pipelineExecutionId: pipelineExecution.id,
                pipelineStepId: activeStep.id,
                jobId: activeStep.jobId,
                stepOrder: activeStep.order,
                outputName: activeStep.outputName || null,
                output: "",
                status: "skipped",
                executedAt: new Date(),
              });
              await pipelineService.updateStepExecution(skippedExec.id, {
                status: "skipped",
                completedAt: new Date(),
                error: `Skipped: runOnCondition='${cond}' not satisfied`,
              } as any);
            } catch (skipErr: any) {
              logger.warn(`[PipelineExecutor] Failed to persist skipped step ${activeStep.id}: ${skipErr.message}`);
            }
            stepResults.push({
              stepId: activeStep.id, jobId: activeStep.jobId, stepOrder: activeStep.order,
              outputName: activeStep.outputName, output: "", status: "skipped",
            } as any);
            // Advance sequentially; a skipped step's own routing must not apply.
            currentStep = steps.find((s) => s.order === activeStep.order + 1) || null;
            continue;
          }
        }

        // Increment visit count
        const visitCount = await stateTracker.incrementVisit(pipelineExecution.id, activeStep.id);
        visitedSteps.add(activeStep.id);

        // Trigger ETC Calculation
        if (!activeStep.moduleType || activeStep.moduleType !== "logic_gatekeeper") {
          await this._calculateEstimatedCompletionTime(pipelineExecution.id, pipeline.id, activeStep.order, steps);
        }

        // Track graph traversal path
        traversalPath.push({ stepId: activeStep.id, stepOrder: activeStep.order, timestamp: new Date() });

        console.log(`[Pipeline Executor] Executing step ${activeStep.id} (order ${activeStep.order}, visit #${visitCount})`);

        // Inject mission context
        if (pipelineExecution.missionId) {
          (context as any).missionId = pipelineExecution.missionId;
          (context as any).pipelineExecutionId = pipelineExecution.id;
          try {
            const { missionRunService } = await import("../domain/mission/core/mission-run.service.js");
            const mList = await missionRunService.list({ missionId: pipelineExecution.missionId, status: "active" });
            if (mList.length > 0) {
              const mission = mList[0];
              if (!(context as any).missionRunId) (context as any).missionRunId = mission.id;
              const missionCtx = mission.missionContext as Record<string, unknown> | null;
              if (missionCtx && Object.keys(missionCtx).length > 0) {
                (context as any).data = { ...((context as any).data || {}), ...missionCtx };
              }
            }
          } catch (err) {
            console.warn("[Pipeline Executor] Failed to resolve mission:", err);
          }
        }
        (context as any).currentStepId = activeStep.id;
        (context as any).currentStepOrder = activeStep.order;

        // Pre-create step execution
        const stepExecutedAt = traversalPath[traversalPath.length - 1].timestamp;
        const stepExecution = await pipelineService.createStepExecution({
          pipelineExecutionId: pipelineExecution.id,
          pipelineStepId: activeStep.id,
          jobId: activeStep.jobId,
          stepOrder: activeStep.order,
          outputName: activeStep.outputName || null,
          output: "",
          status: "pending",
          executedAt: stepExecutedAt,
        });

        // Execute step
        let result: StepExecutionResult | null = null;
        if (activeStep.moduleType === "logic_gatekeeper") {
          result = { success: true, output: "", status: "completed" };
        } else {
          // Local Runner Logic
          const activeMissionRunId = (context as any).missionRunId;
          const orgId = assertOrgId(pipeline.organizationId);
          if (activeMissionRunId && pipelineExecution.missionId && activeStep.jobId) {
            try {
              const orgContext = getSystemOrgContext(pipeline.organizationId);
              const job = await jobService.getById(activeStep.jobId, orgContext);
              if (job?.type === "folder_import") {
                const { missionRunService } = await import("../domain/mission/core/mission-run.service.js");
                if (await missionRunService.hasLocalRunner(orgId)) {
                  const assignment = await missionRunService.createAssignment({
                    missionRunId: activeMissionRunId,
                    pipelineExecutionId: pipelineExecution.id,
                    pipelineStepId: activeStep.id,
                    organizationId: orgId,
                    jobType: "folder_import",
                    jobConfig: job.config as Record<string, unknown>,
                  });
                  result = {
                    success: true,
                    output: "",
                    status: "waiting_external_input",
                    suspensionMetadata: {
                      waitReason: "local_runner",
                      assignmentId: assignment.id,
                      pipelineExecutionId: pipelineExecution.id,
                      stepId: activeStep.id,
                    },
                  } as any;
                }
              }
            } catch (assignErr) {
              console.warn("[Pipeline Executor] Local runner assignment failed, falling back to server execution:", assignErr);
            }
          }

          // Intercept for declarative HIL form if defined in mission sequence
          let requiresHuman = false;
          let formRef: string | null = null;
          let routingChannel: string | null = null;

          if (hilSequence.length > 0) {
            const seqStep = hilSequence.find((s: any) => s.order === activeStep.order);
            if (seqStep && seqStep.requiresHuman) {
              requiresHuman = true;
              formRef = seqStep.formRef;
              routingChannel = seqStep.routingChannel;
            }
          }

          if (requiresHuman && formRef) {
            try {
              const { hilForms: schemaHilForms } = await import("@shared/schema/index.js");
              // 1. Fetch the form schema from hil_forms
              const [formRecord] = await db
                .select()
                .from(schemaHilForms)
                .where(
                  and(
                    eq(schemaHilForms.name, formRef),
                    // Only a template is a form definition; a request or stored response
                    // with the same name must never be taken for it.
                    eq(schemaHilForms.kind, "template"),
                    pipeline.organizationId ? eq(schemaHilForms.organizationId, pipeline.organizationId) : sql`${schemaHilForms.organizationId} IS NULL`
                  )
                )
                .limit(1);

              if (formRecord) {
                // 2. This run's request, copied from the template. The step used to
                // set stepExecutionId and status "pending" on the template row itself,
                // so the library form became one run's request: the next run found a
                // form already tied to another step, and the answers overwrote the
                // definition. Announcing is left to the decision router's channels.
                const { hilRequests } = await import("../domain/pipeline/core/hil-requests.service.js");
                const request = await hilRequests.createFromTemplate(formRecord, {
                  source: "step",
                  organizationId: pipeline.organizationId ?? null,
                  stepExecutionId: stepExecution.id,
                  announce: false,
                });

                // 3. Request a decision using decisionRouter
                const { decisionRouter } = await import("../domain/governor/core/decision-router.js");
                const decisionRes = await decisionRouter.requestDecision({
                  sessionId: `hil_${pipelineExecution.id}_${activeStep.id}`,
                  jobId: activeStep.jobId ?? undefined,
                  executionId: String(stepExecution.id),
                  tool: "human_form_input",
                  params: {
                    type: "input_request",
                    fields: (formRecord.schema as any)?.fields || [],
                    formId: request.id,
                    templateFormId: formRecord.id,
                    formName: formRecord.name,
                    description: formRecord.description || `Input required for step: ${activeStep.outputName || activeStep.order}`,
                    pipelineStepExecutionId: stepExecution.id,
                  },
                  goal: `Provide required input for ${formRecord.name}`,
                  riskLevel: "medium",
                  description: formRecord.description || `Approval and inputs required for step: ${activeStep.outputName || activeStep.order}`,
                  approverType: "internal",
                  channels: routingChannel === "approvals_channel" ? ["slack", "email", "inbox"] : ["inbox"],
                  organizationId: pipeline.organizationId ?? undefined,
                  missionId: pipelineExecution.missionId ?? undefined,
                  noWait: true,
                });

                result = {
                  success: true,
                  output: "",
                  status: "waiting_external_input",
                  suspensionMetadata: {
                    waitReason: "human_approval",
                    approvalRequestIds: decisionRes.requestId ? [decisionRes.requestId] : [],
                  },
                } as any;
              }
            } catch (err) {
              console.error("[Pipeline Executor] Failed to process HIL form interaction:", err);
            }
          }

          if (!result) {
            // Check Job Dependencies
            if (activeStep.jobId) {
                try {
                    const { jobDependencyService } = await import("../domain/jobs/core/job-dependency.service.js");
                    const deps = await jobDependencyService.resolveDependencies(activeStep.jobId, pipelineExecution.id);
                    if (!deps.ready) {
                        result = {
                            success: true, // "success" in terms of avoiding failure, it's just paused
                            output: "",
                            status: "waiting_async",
                            suspensionMetadata: {
                                waitReason: "job_dependency",
                                blockingJobs: deps.blocking,
                                softBlockingJobs: deps.softBlocking
                            }
                        } as any;
                        
                        // We set these directly on the update payload later by attaching them to result
                        (result as any).dependencyStatus = 'blocked';
                    } else if (deps.softBlocking.length === 0) {
                        result = (result || {}) as any;
                        (result as any).dependencyStatus = 'resolved';
                        (result as any).dependencyResolutionTime = new Date();
                    }
                } catch (err) {
                    console.error("[PipelineExecutor] Failed to resolve job dependencies:", err);
                }
            }

            if (!result || !result.status) {
              const isFirstStep = visitedSteps.size === 1;
              const lastOutput = context.positional[activeStep.order - 1];
              if (lastOutput !== undefined) {
                 const parsedOutput = safeJsonParse(lastOutput);
                 (context as any).data = { ...((context as any).data || {}), input: lastOutput, result: parsedOutput };
              }
              
              // ── Per-Step Token Budget: inject from YAML step config ────────────
              // If the step declares a tokenBudget in its toolArguments, pass it
              // as stepBudgetLimitUsd so the AI agent executor respects it.
              const stepToolArgs = (activeStep.toolArguments || {}) as any;
              if (stepToolArgs.tokenBudget && typeof stepToolArgs.tokenBudget === 'number') {
                (context as any).stepBudgetLimitUsd = stepToolArgs.tokenBudget / 1000; // Convert tokens to approximate USD
                logger.info(`[PipelineExecutor] Per-step token budget: ${stepToolArgs.tokenBudget} tokens (~$${(stepToolArgs.tokenBudget / 1000).toFixed(2)})`);
              }
              
              await pipelineService.updateStepExecution(stepExecution.id, { status: "running" });
              logger.info(`[PipelineExecutor] Calling executePipelineStep for step ${activeStep.id} (Order ${activeStep.order})...`);

              // ── Structured Code Context Injection ──────────────────────────────
              // For coding steps, inject relevant XRay context before execution.
              // Detection: toolArguments.action contains "write_code" or "implement"
              try {
                const action = stepToolArgs.action as string | undefined;
                if (action && (action.includes("write_code") || action.includes("implement"))) {
                  const plan = (context as any).data?.implementation_plan ?? (context as any).named?.implementation_plan;
                  const workspacePath = (context as any).data?.workspacePath ?? (context as any).named?.workspacePath;

                  if (plan && workspacePath) {
                    const orgId = pipeline.organizationId;
                    const injectionResult = await contextInjectionService.injectContext(
                      plan,
                      workspacePath,
                      orgId,
                      { tokenBudget: stepToolArgs.contextInjectionBudget || 4000 }
                    );

                    if (injectionResult.prompt) {
                      (context as any).data = { ...((context as any).data || {}), _injectedCodeContext: injectionResult.prompt };
                      logger.info(`[PipelineExecutor] Context injection: ${injectionResult.metadata.symbolsInjected} symbols, ${injectionResult.metadata.tokensConsumed} tokens`);
                    }
                  }
                }
              } catch (injectionErr: any) {
                // Context injection must never block pipeline execution
                logger.error(`[PipelineExecutor] Context injection failed (non-blocking): ${injectionErr.message}`);
              }

              result = await executePipelineStep(activeStep, pipeline, context, isFirstStep, pipelineExecution.id, stepExecution.id, jobMap);
              
              if (!result.success && result.error && activeStep.jobId) {
                try {
                    const { errorRecoveryService } = await import("../domain/jobs/core/error-recovery.service.js");
                    const retryOp = async () => executePipelineStep(activeStep, pipeline, context, isFirstStep, pipelineExecution.id, stepExecution.id, jobMap);
                    
                    const recovery = await errorRecoveryService.attemptRecovery(
                        activeStep.jobId,
                        new Error(result.error),
                        { executionId: stepExecution.id, organizationId: pipeline.organizationId, missionId: pipelineExecution.missionId },
                        retryOp
                    );

                    if (recovery.recovered && recovery.result) {
                        logger.info(`[PipelineExecutor] Step ${activeStep.id} recovered via: ${recovery.action}`);
                        result = recovery.result;
                    } else if (!recovery.recovered && recovery.action) {
                        logger.warn(`[PipelineExecutor] Step ${activeStep.id} recovery failed. Suggested action: ${recovery.action}`);
                        
                        // Escalate to HIL for manual review
                        await errorRecoveryService.escalateToHIL(
                            activeStep.jobId,
                            new Error(result.error),
                            recovery.action,
                            { executionId: stepExecution.id, organizationId: pipeline.organizationId, missionId: pipelineExecution.missionId }
                        );
                    }
                } catch (recoveryErr) {
                    logger.error(`[PipelineExecutor] Recovery system failed:`, recoveryErr);
                }
              }

              logger.info(`[PipelineExecutor] Step ${activeStep.id} finished with status: ${result?.status}`);
            }
          }
        }

        if (!result) throw new Error(`Step execution failed for Step ${activeStep.id}`);

        // Update step execution
        const stepCompletedAt = new Date();
        const outputSchema = result.success && result.output ? await this._inferOutputSchema(result) : null;

        await pipelineService.updateStepExecution(stepExecution.id, {
          output: result.output,
          status: result.status,
          completedAt: stepCompletedAt,
          traceId: result.externalId,
          error: result.error || null,
          outputSchema,
          sleepUntil: (result as any).sleepUntil,
          suspensionMetadata: (result as any).suspensionMetadata,
          dependencyStatus: (result as any).dependencyStatus,
          dependencyResolutionTime: (result as any).dependencyResolutionTime,
          diff: result.diff || null, // Reactive Intelligence: Save diff for HIL/observability
        } as any);

        // Post-execution variable updates (moved up so hooks receive updated context)
        if (result.success) {
          context.positional[activeStep.order] = result.output;
          context.history[activeStep.order] = safeJsonParse(result.output);
          if (activeStep.outputName) context.named[activeStep.outputName] = result.output;

          // ── Named Output Chaining: Write step outputs to mission blackboard ──
          // When a step has declared outputs in its toolArguments (from YAML),
          // write the result to the mission blackboard so downstream steps/missions
          // can read it via get_blackboard.
          if (pipelineExecution.missionId && activeStep.toolArguments) {
            const stepArgs = activeStep.toolArguments as any;
            const declaredOutputs = stepArgs.outputs || (stepArgs.output ? [stepArgs.output] : []);
            const stepCode = stepArgs.stepCode || `step_${activeStep.order}`;
            if (declaredOutputs.length > 0 && result.output) {
              try {
                const { missionService: ms } = await import("../domain/mission/core/mission.service.js");
                const outputData: Record<string, any> = {};
                for (const key of declaredOutputs) {
                  outputData[key] = result.output;
                }
                outputData[`_lastCompletedStep`] = stepCode;
                outputData[`_currentStepIndex`] = activeStep.order;
                await ms.updateBlackboard(pipelineExecution.missionId, outputData, userId || "pipeline_executor", `Step ${stepCode} output`);
                logger.info(`[PipelineExecutor] Wrote ${declaredOutputs.length} output(s) to mission blackboard: ${declaredOutputs.join(", ")}`);
                
                // Emit STEP_OUTPUT_WRITTEN event for event-driven mission advancement
                try {
                    const { crossAppEventBus, CrossAppEventType } = await import("../domain/org/core/event-bus.service.js");
                    await crossAppEventBus.publish({
                        type: CrossAppEventType.STEP_OUTPUT_WRITTEN,
                        organizationId: pipeline.organizationId ?? 0,
                        sourceApp: "pipeline_executor",
                        payload: {
                            missionId: pipelineExecution.missionId,
                            missionRunId: pipelineExecution.missionRunId,
                            stepCode,
                            stepOrder: activeStep.order,
                            outputKeys: declaredOutputs,
                            pipelineExecutionId: pipelineExecution.id,
                        },
                    });
                } catch { /* best effort event emission */ }
              } catch (bbErr: any) {
                logger.warn(`[PipelineExecutor] Failed to write step outputs to blackboard: ${bbErr.message}`);
              }
            }
          }

          stepResults.push({
            stepId: activeStep.id, jobId: activeStep.jobId, stepOrder: activeStep.order,
            outputName: activeStep.outputName, output: result.output, status: result.status,
            knowledgeDocumentId: (result as any).knowledgeDocumentId
          } as any);
          lastStepFailed = false;
        } else if (result.status === "skipped") {
          // Phase 1b: a step the runner skipped (e.g. conditionExpression evaluated
          // false) is NOT a failure — skip failure diagnosis and leave lastStepFailed
          // unchanged so the skip stays transparent to downstream runOnCondition steps.
          logger.info(`[PipelineExecutor] Step ${activeStep.id} skipped by runner: ${result.error || "condition not met"}`);
          stepResults.push({
            stepId: activeStep.id, jobId: activeStep.jobId, stepOrder: activeStep.order,
            outputName: activeStep.outputName, output: "", status: "skipped",
          } as any);
        } else {
          await this._handleStepFailure(activeStep, result, pipelineExecution, stepExecution, pipeline, userId);
          lastStepFailed = true;
          pipelineHasFailures = true;

          // ── On-Fail Route-to-Step: Retry logic from YAML step config ──────────
          // If the step has an onFail config with route_to_step action, retry
          // by jumping back to the target step (up to max_retries times).
          const stepArgs = (activeStep.toolArguments || {}) as any;
          const onFail = stepArgs.onFail || stepArgs.on_fail;
          if (onFail && (onFail.action === "route_to_step" || onFail.target)) {
            const retryKey = `_retry_count_${activeStep.id}`;
            const currentRetries = ((context as any).data?.[retryKey] || 0) as number;
            const maxRetries = onFail.max_retries ?? 2;
            
            if (currentRetries < maxRetries) {
              // Increment retry counter
              (context as any).data = { ...((context as any).data || {}), [retryKey]: currentRetries + 1 };
              
              // Find the target step to jump back to
              const targetStepCode = onFail.target;
              const targetStep = steps.find(s => {
                const args = (s.toolArguments || {}) as any;
                return args.stepCode === targetStepCode;
              });
              
              if (targetStep) {
                logger.info(`[PipelineExecutor] on_fail: routing back to step ${targetStepCode} (retry ${currentRetries + 1}/${maxRetries})`);
                // Write failure context so the retried step can see why it was re-invoked
                if (pipelineExecution.missionId) {
                  try {
                    const { missionService: ms } = await import("../domain/mission/core/mission.service.js");
                    await ms.updateBlackboard(pipelineExecution.missionId, {
                      [`_retry_reason_${targetStepCode}`]: result.error || "Previous step failed",
                      [`_retry_payload`]: onFail.payload || null,
                    }, userId || "pipeline_executor", `on_fail retry context for step ${targetStepCode}`);
                  } catch { /* best effort */ }
                }
                currentStep = targetStep;
                continue; // Skip normal next-step determination
              }
            } else {
              logger.warn(`[PipelineExecutor] on_fail: max retries (${maxRetries}) exhausted for step ${activeStep.id}`);
            }
          }
          
          // ── Phase 2: honor onFailureAction explicitly ──
          // "Stop Pipeline" (schema default) halts the run and marks it failed.
          // "Continue to Next" lets the loop proceed; the failure is already recorded
          // via pipelineHasFailures (so the run is not reported as a clean success) and
          // any downstream runOnCondition='on_failure' step now actually runs thanks to
          // the gating above.
          // "Execute Fallback Job" runs the step's configured fallbackJobId: on success
          // the failure is treated as recovered (lastStepFailed cleared, loop continues);
          // on failure the pipeline stops as failed. The fallback run is persisted as its
          // own pipelineStepExecutions row linked to the failed step via parentStepExecutionId.
          const onFailureAction = activeStep.onFailureAction || "Stop Pipeline";
          if (onFailureAction === "Execute Fallback Job") {
            if (activeStep.fallbackJobId) {
              const recovered = await this._runFallbackJob(activeStep, result, stepExecution, pipelineExecution, pipeline, context, stepResults, jobMap, userId);
              if (recovered) {
                lastStepFailed = false; // fallback succeeded → failure recovered, continue
              } else {
                hasFailed = true;
                shouldStop = true;
              }
            } else {
              // No fallback target configured → fail safe like "Stop Pipeline".
              logger.warn(`[PipelineExecutor] Step ${activeStep.id}: onFailureAction='Execute Fallback Job' but no fallbackJobId set — stopping.`);
              hasFailed = true;
              shouldStop = true;
            }
          } else if (onFailureAction === "Stop Pipeline") {
            hasFailed = true;
            shouldStop = true;
          } else {
            logger.warn(`[PipelineExecutor] Step ${activeStep.id} failed but onFailureAction='${onFailureAction}' — continuing.`);
          }
        }
        
        // --- TRIGGER STEP COMPLETE HOOKS ---
        try {
            await hookRegistry.triggerStepComplete({
                result,
                currentStep: activeStep,
                pipeline,
                pipelineExecution,
                stepExecution,
                context,
                userId,
                orgId: assertOrgId(pipeline.organizationId)
            });
        } catch (hookErr: any) {
            logger.error(`[PipelineExecutor] Step complete hook failed: ${hookErr.message}`);
        }

        // --- AGORA REAL-TIME UPDATE ---
        if (pipelineExecution.missionId) {
            try {
                const { AgoraGateway } = await import('../domain/agora/gateways/agora.gateway.js');
                AgoraGateway.systemBroadcast(`mission-${pipelineExecution.missionId}`, 'UPDATE_OBJECT', {
                    id: `step-${activeStep.id}`,
                    type: 'stepNode', // Custom node type for the canvas
                    data: {
                        label: activeStep.outputName || `Step ${activeStep.order}`,
                        status: result.status,
                        output: result.output,
                    },
                    // You would calculate a position based on the step order
                    position: { x: 150 * activeStep.order, y: 100 },
                });
            } catch (agoraErr: any) {
                logger.warn(`Failed to broadcast Agora update: ${agoraErr.message}`);
            }
        }


        // Handle Suspensions
        if (result.status === "waiting_async" || result.status === "waiting_external_input") {
          pipelineExecution.status = result.status; 
          await pipelineService.updateExecution(pipelineExecution.id, { status: result.status });
          shouldStop = true;

          const suspension = (result as any).suspensionMetadata;
          const activeMissionRunId = (context as any).missionRunId;
          if (result.status === "waiting_external_input" && suspension && pipelineExecution.missionId && activeMissionRunId) {
             try {
               const { missionRunService } = await import("../domain/mission/core/mission-run.service.js");
               if (suspension.waitReason === "file") {
                 await missionRunService.pauseForFile(activeMissionRunId, suspension.folderPath, suspension.filePattern, pipelineExecution.id, activeStep.id);
               } else if (suspension.waitReason === "human_approval") {
                 await missionRunService.pauseForHumanApproval(activeMissionRunId, suspension.approvalRequestIds);
               }
             } catch (pauseErr) {
               console.warn("[Pipeline Executor] Failed to pause mission:", pauseErr);
             }
          }
          break;
        }

        // Mission Trace
        if (pipelineExecution.missionRunId != null) {
          try {
            await db.update(missionRuns)
              .set({
                dynamicTrace: sql`COALESCE(dynamic_trace, '[]'::jsonb) || ${JSON.stringify([{
                  type: "system", event: "step_completed", stepId: activeStep.id,
                  stepName: activeStep.outputName || "Step " + activeStep.order,
                  status: result.status, timestamp: new Date().toISOString()
                }])}::jsonb`,
                updatedAt: new Date()
              })
              .where(eq(missionRuns.id, pipelineExecution.missionRunId));
          } catch (traceErr) {
            console.warn(`[Pipeline Executor] Failed to append mission trace:`, traceErr);
          }
        }

        // Post-execution variable updates already processed above

        // Determine next step
        const routingResult = await this._determineNextStep(activeStep, result, steps, stepMap, context, pipelineExecution, pipeline, userId);
        currentStep = routingResult.nextStep;
        if (routingResult.shouldStop) shouldStop = true;
        if (routingResult.hasFailed) hasFailed = true;
      }

      if (!shouldStop && !hasFailed) {
        pipelineExecution.status = "completed";
        // Phase 1b: a run that continued past a failed step (onFailureAction=Continue/
        // Execute Fallback Job) still completes, but must not masquerade as a clean
        // success — record the failure summary on the execution row.
        await pipelineService.updateExecution(pipelineExecution.id, {
          status: "completed",
          completedAt: new Date(),
          ...(pipelineHasFailures ? { error: "Completed with one or more failed steps (onFailureAction=Continue/Execute Fallback Job)." } : {}),
        });

        // --- REACTIVE INTELLIGENCE: DRIFT ANALYSIS ---
        try {
            await driftDetectionService.analyzeExecution(
                pipeline.id, 
                pipelineExecution.id, 
                stepResults
            );
        } catch (driftErr) {
            logger.error(`[PipelineExecutor] Drift analysis failed:`, driftErr);
        }
      } else if (hasFailed) {
        const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
        pipelineExecution.status = "failed";
        await pipelineService.updateExecution(pipelineExecution.id, { status: "failed", completedAt: new Date() });
      }
      
      // --- TRIGGER PIPELINE COMPLETE HOOKS (ALWAYS ON COMPLETION) ---
      hooksFired = true;
      await this.firePipelineCompleteHooks(pipeline, pipelineExecution, stepResults, userId);

      return { success: !hasFailed, executionId: pipelineExecution.id, stepResults: stepResults as any, error: hasFailed ? "Pipeline execution failed" : undefined };

    } catch (error) {
      console.error(`[Pipeline Executor] Loop error:`, error);
      // Persist failed status so the execution row doesn't stay permanently "running"
      try {
        await pipelineService.updateExecution(pipelineExecution.id, {
          status: "failed",
          completedAt: new Date(),
          error: String(error),
        });
      } catch (updateErr) {
        console.error(`[Pipeline Executor] Failed to persist error status for execution ${pipelineExecution.id}:`, updateErr);
      }
      // The run this execution belongs to must hear that it failed, or it stays
      // "active" until the stale-run sweep finds it.
      if (!hooksFired) {
        pipelineExecution.status = "failed";
        await this.firePipelineCompleteHooks(pipeline, pipelineExecution, stepResults, userId);
      }
      return { success: false, executionId: pipelineExecution.id, error: String(error) };
    } finally {
      this.runningExecutions.delete(pipelineExecution.id);
    }
  }

  /**
   * Fire the pipeline-complete hooks for an execution that has finished.
   *
   * Every exit that finishes an execution must come through here, because
   * MissionCheckpointHook.onPipelineComplete is what closes the mission run. Two
   * exits used to mark the execution terminal without it: the resume branch where
   * every step is already done, and this loop's catch. Approving a pipeline's final
   * HIL step resumes through the first, so the execution completed while its run
   * stayed "active"; the stale-run healer relaunched the run and the same step came
   * back for approval — about a dozen times over four days for runs 160 and 177.
   *
   * Never throws: a hook failure must not turn a finished execution into an error.
   */
  private async firePipelineCompleteHooks(
    pipeline: any,
    pipelineExecution: any,
    stepResults: any[],
    userId?: string,
  ): Promise<void> {
    try {
      await hookRegistry.triggerPipelineComplete({
        pipeline,
        pipelineExecution,
        stepResults,
        userId,
        orgId: assertOrgId(pipeline.organizationId),
      });
    } catch (hookErr: any) {
      logger.error(`[PipelineExecutor] Pipeline complete hook failed for execution ${pipelineExecution?.id}: ${hookErr.message}`);
    }
  }

  // ============================================================================
  // HELPER METHODS - Extracted from _processExecutionLoop for maintainability
  // ============================================================================

  /**
   * Check safety protocols (Doomsday Clock, Cycle Breaker, Stagnation Lock)
   * Returns null if safe to proceed, or a PipelineExecutionResult if execution should stop
   */
  private async _checkSafetyProtocols(
    pipelineExecution: any,
    currentStep: PipelineStep,
    context: VariableContext & { data?: Record<string, any> },
    stepResults: any[],
    stepMap: Map<number, PipelineStep>
  ): Promise<{ action: 'continue' | 'abort' | 'reroute'; result?: PipelineExecutionResult; newStep?: PipelineStep | null }> {
    const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
    // Check Doomsday Clock (Protocol C) - global timeout
    const timeoutCheck = checkDoomsdayClock(pipelineExecution);
    if (!timeoutCheck.allowed) {
      console.error(`[Pipeline Executor] ${timeoutCheck.logReason}`);
      await pipelineService.updateExecution(pipelineExecution.id, {
        status: "timeout",
        completedAt: new Date(),
        error: timeoutCheck.logReason,
      });
      return {
        action: 'abort',
        result: {
          success: false,
          executionId: pipelineExecution.id,
          error: timeoutCheck.logReason,
          stepResults,
        }
      };
    }

    // Check Loopbane Protocols if this is a Decision Node
    if (currentStep.moduleType === "logic_gatekeeper" && currentStep.decisionNodeConfig) {
      const config = currentStep.decisionNodeConfig as DecisionNodeConfig;

      // Protocol A: Cycle Breaker
      if (config.safetyPolicy) {
        const cycleCheck = await checkCycleBreaker(
          pipelineExecution.id,
          currentStep.id,
          config.safetyPolicy,
          stateTracker
        );

        if (!cycleCheck.allowed) {
          console.warn(`[Pipeline Executor] ${cycleCheck.logReason}`);

          if (cycleCheck.action === "abort_workflow") {
            await pipelineService.updateExecution(pipelineExecution.id, {
              status: "failed",
              completedAt: new Date(),
              error: cycleCheck.logReason,
            });
            return {
              action: 'abort',
              result: {
                success: false,
                executionId: pipelineExecution.id,
                error: cycleCheck.logReason,
                stepResults,
              }
            };
          } else if (cycleCheck.action === "route_to_fallback" && cycleCheck.destination) {
            const newStep = stepMap.get(cycleCheck.destination) || null;
            return { action: 'reroute', newStep };
          }
        }

        // Protocol B: Stagnation Lock
        const stagnationCheck = await checkStagnationLock(
          pipelineExecution.id,
          currentStep.id,
          context,
          config.safetyPolicy,
          stateTracker
        );

        if (!stagnationCheck.allowed) {
          console.warn(`[Pipeline Executor] ${stagnationCheck.logReason}`);
          await pipelineService.updateExecution(pipelineExecution.id, {
            status: "failed",
            completedAt: new Date(),
            error: stagnationCheck.logReason,
          });
          return {
            action: 'abort',
            result: {
              success: false,
              executionId: pipelineExecution.id,
              error: stagnationCheck.logReason,
              stepResults,
            }
          };
        }
      }
    }

    return { action: 'continue' };
  }

  /**
   * Handle step failure with error diagnosis
   */
  private async _handleStepFailure(
    currentStep: PipelineStep,
    result: { success: boolean; output: string; status: string; error?: string },
    pipelineExecution: any,
    stepExecution: any,
    pipeline: any,
    userId?: string
  ): Promise<void> {
    const { jobService } = await import("@domain/jobs/job.service.js");
    // Phase 3: Auto-Diagnose Failure
    try {
      const failedJob = currentStep.jobId
        ? await jobService.getById(currentStep.jobId, { userId: userId || 'system', organizationId: pipeline.organizationId, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true })
        : undefined;

      await errorDiagnosisEngine.diagnose({
        error: result.error || `Step ${currentStep.order} failed`,
        stepExecutionId: stepExecution.id,
        pipelineExecutionId: pipelineExecution.id,
        jobId: currentStep.jobId ?? undefined,
        jobType: failedJob?.type,
        jobConfig: failedJob?.config,
        stepOutput: result.output,
        organizationId: pipeline.organizationId
      }, { includeAI: true });
    } catch (diagError) {
      console.error("[Pipeline Executor] Failed to generate error diagnosis:", diagError);
    }
  }

  /**
   * Determine the next step based on routing logic
   * Returns the next step or null if execution should end
   */
  private async _determineNextStep(
    currentStep: PipelineStep,
    result: { success: boolean; output: string; status: string; error?: string },
    steps: PipelineStep[],
    stepMap: Map<number, PipelineStep>,
    context: VariableContext & { data?: Record<string, any> },
    pipelineExecution: any,
    pipeline: any,
    userId?: string
  ): Promise<{ nextStep: PipelineStep | null; shouldStop: boolean; hasFailed: boolean }> {
    const { jobService } = await import("@domain/jobs/job.service.js");
    const { pipelineService } = await import("@domain/pipeline/core/pipeline.service.js");
    let nextStep: PipelineStep | null = null;
    let nextStepIsResolved = false;
    let shouldStop = false;
    let hasFailed = false;

    // Logic A: Standard Decision Job (New V2 Control Flow)
    if (currentStep.jobId && result.status === "success") {
      const job = await jobService.getById(currentStep.jobId, { userId: userId || 'system', organizationId: pipeline.organizationId, isSuperAdmin: true, isAdmin: true, isOrgAdmin: true });
      if (job && job.type === "decision") {
        console.log(`[Pipeline Executor] Processing Decision Job ${job.id} output: ${result.output}`);
        const stepRouting = currentStep.decisionNodeConfig as { trueStepId?: number; falseStepId?: number } | null;
        const jobConfig = job.config as DecisionNodeConfig & { trueStepId?: number; falseStepId?: number } | null;
        const trueStepId = stepRouting?.trueStepId ?? jobConfig?.trueStepId;
        const falseStepId = stepRouting?.falseStepId ?? jobConfig?.falseStepId;

        const isTrue = result.output === "true";
        let targetStepId: number | undefined;

        if (isTrue && trueStepId) {
          targetStepId = trueStepId;
          console.log(`[Pipeline Executor] Condition TRUE -> Routing to Step ID ${targetStepId}`);
        } else if (!isTrue && falseStepId) {
          targetStepId = falseStepId;
          console.log(`[Pipeline Executor] Condition FALSE -> Routing to Step ID ${targetStepId}`);
        }

        if (targetStepId) {
          nextStep = stepMap.get(targetStepId) || null;
          if (!nextStep) {
            console.warn(`[Pipeline Executor] Target step ID ${targetStepId} not found in pipeline!`);
          }
          nextStepIsResolved = true;
        } else {
          console.log(`[Pipeline Executor] Branch matched but no specific jump defined. Falling through to next sequential step.`);
        }
      }
    }

    // Logic B: Legacy Logic Gatekeeper (Protocol-based)
    if (!nextStepIsResolved && currentStep.moduleType === "logic_gatekeeper" && currentStep.decisionNodeConfig) {
      const config = currentStep.decisionNodeConfig as DecisionNodeConfig;
      console.log(`[Pipeline Executor] Evaluating Legacy Decision Node at step ${currentStep.id}`);

      const routing = await evaluateDecisionNode(config, context);
      console.log(`[Pipeline Executor] Decision Node evaluation result: matched=${routing.matched}, routing to step ${routing.destinationStepId}`);

      if (routing.injectContext) {
        Object.assign(context.named, routing.injectContext);
        Object.assign(context.data || {}, routing.injectContext);
      }

      if (routing.action === "stop_failure") {
        console.warn(`[Pipeline Executor] Decision Node routed to explicit failure`);
        shouldStop = true;
        hasFailed = true;
        await pipelineService.updateExecution(pipelineExecution.id, {
          status: "failed",
          completedAt: new Date(),
          error: "Pipeline stopped by Condition Check (Decision Node)",
        });
        return { nextStep: null, shouldStop, hasFailed };
      } else if (routing.action === "stop_success") {
        console.log(`[Pipeline Executor] Decision Node routed to explicit stop (success)`);
        shouldStop = true;
        return { nextStep: null, shouldStop, hasFailed };
      } else {
        if (routing.destinationStepId) {
          nextStep = stepMap.get(routing.destinationStepId) || null;
          if (!nextStep) {
            console.warn(`[Pipeline Executor] Decision Node routed to missing step ID ${routing.destinationStepId}`);
          }
          nextStepIsResolved = true;
        } else {
          console.warn(`[Pipeline Executor] Decision Node matched but no destination ID provided, looking for next sequential step`);
          const nextByOrder = steps.find(s => s.order === currentStep.order + 1);
          if (nextByOrder) {
            nextStep = nextByOrder;
            nextStepIsResolved = true;
          } else {
            nextStep = null;
            nextStepIsResolved = true;
          }
        }
      }
    }

    // Logic C: Explicit Step Routing (Generic)
    if (!nextStepIsResolved && currentStep.destinationStepId !== null && currentStep.destinationStepId !== undefined) {
      const explicitDestId = currentStep.destinationStepId;
      console.log(`[Pipeline Executor] Using explicit routing from step ${currentStep.id} to step ${explicitDestId}`);
      nextStep = stepMap.get(explicitDestId) || null;
      nextStepIsResolved = true;
    }

    // Logic D: Default Sequential Flow
    if (!nextStepIsResolved && !shouldStop) {
      const nextByOrder = steps.find(s => s.order === currentStep.order + 1);
      if (nextByOrder) {
        console.log(`[Pipeline Executor] Routing to next step by order: step ${nextByOrder.id} (order ${nextByOrder.order})`);
      } else {
        console.log(`[Pipeline Executor] No next step by order, execution complete`);
      }
      nextStep = nextByOrder || null;
    }

    return { nextStep, shouldStop, hasFailed };
  }

  /**
   * Infer output schema from step result
   */
  private async _inferOutputSchema(result: { output: string }): Promise<any> {
    try {
      const { schemaInferenceService } = await import("@domain/knowledge/core/schema-inference.service.js");
      const parsedOutput = safeJsonParse(result.output);
      if (parsedOutput && typeof parsedOutput === 'object') {
        return schemaInferenceService.infer(parsedOutput);
      }
    } catch (schemaError) {
      console.warn(`[Pipeline Executor] Failed to infer schema:`, schemaError);
    }
    return null;
  }

  /**
   * Calculate Estimated Time to Completion (ETC)
   * Averages historical step execution times for pending steps
   */
  private async _calculateEstimatedCompletionTime(executionId: number, pipelineId: number, currentOrder: number, steps: PipelineStep[]): Promise<void> {
    try {
      const pendingSteps = steps.filter(s => s.order > currentOrder);
      if (pendingSteps.length === 0) return;

      const jobIds = [...new Set(pendingSteps.map(s => s.jobId).filter((id): id is number => id != null))];
      if (jobIds.length === 0) return;

      const jobIdList = sql.join(jobIds.map((id) => sql`${id}`), sql`, `);

      // Single bulk query: average duration per job across last 10 executions each
      const avgQuery = await db.execute(sql`
        SELECT job_id, AVG(seconds) AS avg_seconds
        FROM (
          SELECT job_id,
                 EXTRACT(EPOCH FROM (completed_at - executed_at)) AS seconds,
                 ROW_NUMBER() OVER (PARTITION BY job_id ORDER BY completed_at DESC) AS rn
          FROM pipeline_step_executions
          WHERE job_id IN (${jobIdList})
            AND status = 'success'
            AND completed_at IS NOT NULL
        ) ranked
        WHERE rn <= 10
        GROUP BY job_id
      `);

      const avgByJob = new Map<number, number>();
      for (const row of (avgQuery?.rows ?? [])) {
        if (row.job_id != null && row.avg_seconds != null) {
          avgByJob.set(Number(row.job_id), Number(row.avg_seconds) * 1000);
        }
      }

      let totalRemainingMs = 0;
      for (const step of pendingSteps) {
        totalRemainingMs += step.jobId != null
          ? (avgByJob.get(step.jobId) ?? 5000)
          : 0;
      }

      await pipelineService.updateExecution(executionId, {
        estimatedTimeRemainingMs: Math.round(totalRemainingMs),
        lastEtcCalculationAt: new Date(),
      } as any);

    } catch (err) {
      console.warn(`[Pipeline Executor] Failed to calculate ETC for execution ${executionId}:`, err);
    }
  }
}

export const pipelineExecutor = new PipelineExecutor();



