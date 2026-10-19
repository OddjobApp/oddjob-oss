import { db } from "@server/database_service.js";
import { fineTuningDatasets, fineTuningExamples, agentPips, agentConductLogs, agentToolUsage, competencies, actorCompetencies } from "@shared/schema/index.js";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@server/domain/core/infrastructure/event-stream.service.js";
import { FineTuningService } from "@server/domain/ai/core/fine-tuning.service.js";
import { UpskillingJob } from "./performance-manager.service.js";

const logger = createLogger("UpskillingOrchestrator");
const fineTuningService = new FineTuningService();

export interface CanaryEvalResult {
  /** False when nothing was actually run. An unevaluated result never promotes. */
  evaluated: boolean;
  score: number; // 0-1
  passed: boolean;
  benchmarkMissions: number;
  successfulMissions: number;
  diagnostics: string[];
}

export class UpskillingOrchestratorService {
  /**
   * Execute autonomous upskilling workflow based on the job tier/type.
   */
  async executeUpskilling(job: UpskillingJob, organizationId: number): Promise<{ success: boolean; resultSummary: string; canaryScore: number }> {
    logger.info(`🚀 Starting Upskilling Execution [Job: ${job.id}, Type: ${job.type}, Agent: ${job.agentId}]`);

    try {
      // Broadcast progress: Started
      this.publishProgress(job, "training", 10, "Initializing upskilling environment & trajectory analysis");

      let resultSummary = "";
      let canaryScore = 0;

      switch (job.type) {
        case "prompt_optimization":
          resultSummary = await this.runPromptOptimization(job, organizationId);
          break;

        case "golden_samples":
          resultSummary = await this.runGoldenSamplesCurator(job, organizationId);
          break;

        case "fine_tuning":
          resultSummary = await this.runFineTuningPipeline(job, organizationId);
          break;

        default:
          throw new Error(`Unsupported upskilling type: ${(job as any).type}`);
      }

      // Step: Run Canary Verification
      this.publishProgress(job, "training", 85, "Executing Canary Benchmark Verification");
      const canaryEval = await this.runCanaryBenchmark(job.agentId, organizationId, job.type);
      canaryScore = canaryEval.score;

      if (!canaryEval.evaluated) {
        // Distinct from a failed benchmark: nothing was tested, so this must not
        // read as either a pass or a measured 0%.
        const message = `Not verified: ${canaryEval.diagnostics.join("; ")}`;
        logger.warn(`⚠️ Upskilling job ${job.id} for Agent ${job.agentId} was not verified — competency not promoted`);
        this.publishProgress(job, "failed", 100, message);
        return {
          success: false,
          resultSummary: `${resultSummary} ${message}`,
          canaryScore,
        };
      }

      if (!canaryEval.passed) {
        logger.warn(`⚠️ Canary Benchmark failed for Agent ${job.agentId} (Score: ${(canaryScore * 100).toFixed(1)}%)`);
        this.publishProgress(job, "failed", 100, `Canary benchmark failed. Score: ${(canaryScore * 100).toFixed(1)}%`);
        return {
          success: false,
          resultSummary: `Upskilling completed but failed canary evaluation: ${canaryEval.diagnostics.join("; ")}`,
          canaryScore,
        };
      }

      // Promote agent competency on successful canary evaluation
      await this.promoteAgentCompetency(job, organizationId, canaryScore, canaryEval.diagnostics);

      // Complete job
      this.publishProgress(job, "completed", 100, `Upskilling successful! ${resultSummary}`);
      logger.info(`✅ Upskilling completed successfully for Agent ${job.agentId} with canary score ${(canaryScore * 100).toFixed(1)}%`);

      return {
        success: true,
        resultSummary,
        canaryScore,
      };
    } catch (error: any) {
      logger.error(`❌ Upskilling job ${job.id} failed: ${error.message}`, error);
      this.publishProgress(job, "failed", 100, error.message || "Upskilling execution failed");
      return {
        success: false,
        resultSummary: `Execution error: ${error.message}`,
        canaryScore: 0,
      };
    }
  }

  /**
   * Tier 1: Prompt & Directive Optimization
   *
   * Collects the evidence a directive patch would be built from and records it
   * against the agent. It does NOT change any prompt: nothing in the platform
   * applies a directive patch. This used to log "Applied dynamic directive patch"
   * and report `max(errorCount, 3)` patches applied — three when there were no
   * errors at all.
   */
  private async runPromptOptimization(job: UpskillingJob, organizationId: number): Promise<string> {
    this.publishProgress(job, "training", 30, "Collecting recent tool failures");

    // agent_tool_usage has no agent column, so this is organization-wide evidence.
    const recentErrors = await db
      .select()
      .from(agentToolUsage)
      .where(and(eq(agentToolUsage.organizationId, organizationId), eq(agentToolUsage.status, "error")))
      .orderBy(desc(agentToolUsage.createdAt))
      .limit(10);

    const errorCount = recentErrors.length;
    this.publishProgress(job, "training", 60, `Found ${errorCount} recent tool failure(s) in this organization`);

    // agent_conduct_logs.agent_id is an integer. `Number(job.agentId) || 1` filed
    // the log for any non-numeric id (e.g. "agent-7") against agent 1.
    const agentNumericId = Number(job.agentId);
    if (Number.isInteger(agentNumericId) && agentNumericId > 0) {
      await db.insert(agentConductLogs).values({
        agentId: agentNumericId,
        type: "PROMPT_REVIEW_PENDING",
        severity: "info",
        description: `Prompt-optimization upskilling collected ${errorCount} recent tool failure(s) for review. No directive patch was applied.`,
        data: { upskillingJobId: job.id, toolFailureIds: recentErrors.map((e) => e.id) },
      });
    }

    return `Collected ${errorCount} recent tool failure(s) for review. No directive patch was applied — the platform has no step that applies one.`;
  }

  /**
   * Tier 2: Few-Shot Golden Samples Curator
   *
   * Ensures the agent's golden-sample dataset exists and reports what is in it.
   * No curation step exists yet. This used to insert the same canned
   * input/output pair on every run — training data describing no real task — and
   * report "5 high-confidence Golden Samples" after inserting one.
   */
  private async runGoldenSamplesCurator(job: UpskillingJob, organizationId: number): Promise<string> {
    this.publishProgress(job, "training", 25, "Locating the agent's golden-sample dataset");

    // Find or create fine-tuning dataset for Golden Samples
    const datasetName = `Agent-${job.agentId}-GoldenSamples`;
    let [dataset] = await db
      .select()
      .from(fineTuningDatasets)
      .where(and(eq(fineTuningDatasets.organizationId, organizationId), eq(fineTuningDatasets.name, datasetName)))
      .limit(1);

    if (!dataset) {
      dataset = await fineTuningService.createDataset(
        {
          name: datasetName,
          description: `Auto-generated Golden Samples for Agent ${job.agentId} upskilling`,
        },
        organizationId
      );
    }

    job.datasetId = String(dataset.id);

    const [{ count: exampleCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(fineTuningExamples)
      .where(eq(fineTuningExamples.datasetId, dataset.id));

    this.publishProgress(job, "training", 60, `Dataset #${dataset.id} holds ${exampleCount} example(s)`);

    return `Golden-sample dataset #${dataset.id} holds ${exampleCount} example(s). None were curated automatically — no curation step exists yet.`;
  }

  /**
   * Tier 3: SFT / LoRA Model Fine-Tuning Pipeline
   *
   * Prepares the SFT dataset, then fails: there is no training backend.
   * `fineTuningService.startTraining` is itself a simulation that returns a random
   * run id. This used to wait 800ms, announce "LoRA Adapter v2.1", and register a
   * model id (`ft:oddjob-agent-N:v2-pip`) for a model that was never trained.
   */
  private async runFineTuningPipeline(job: UpskillingJob, organizationId: number): Promise<string> {
    this.publishProgress(job, "training", 20, "Assembling specialized SFT fine-tuning dataset");

    const datasetName = `Agent-${job.agentId}-SFT-Dataset`;
    let [dataset] = await db
      .select()
      .from(fineTuningDatasets)
      .where(and(eq(fineTuningDatasets.organizationId, organizationId), eq(fineTuningDatasets.name, datasetName)))
      .limit(1);

    if (!dataset) {
      dataset = await fineTuningService.createDataset(
        {
          name: datasetName,
          description: `Fine-tuning SFT dataset for Agent ${job.agentId} under PIP`,
        },
        organizationId
      );
    }

    job.datasetId = String(dataset.id);

    throw new Error(
      `No model was trained: this platform has no fine-tuning backend (training is simulated). ` +
        `SFT dataset #${dataset.id} is prepared for when one exists.`,
    );
  }

  /**
   * Canary verification — the gate for promoting a competency.
   *
   * No benchmark harness exists for upskilled agents; nothing runs the agent
   * against test missions. This used to return a hardcoded 5/5 pass with invented
   * diagnostics ("Latency improved by 14%"), after which every job wrote a
   * competency into actor_competencies marked "verified by Canary Benchmark
   * (Score: 100.0%)". Until a real harness exists it reports not-evaluated, which
   * blocks promotion.
   */
  private async runCanaryBenchmark(agentId: string, _organizationId: number, upskillType: string): Promise<CanaryEvalResult> {
    return {
      evaluated: false,
      score: 0,
      passed: false,
      benchmarkMissions: 0,
      successfulMissions: 0,
      diagnostics: [
        `no canary benchmark harness exists, so the ${upskillType} result for agent ${agentId} was not tested and no competency was promoted`,
      ],
    };
  }

  /**
   * Helper to update job status and emit SSE events.
   */
  private publishProgress(
    job: UpskillingJob,
    status: UpskillingJob["status"],
    progressPercent: number,
    statusMessage: string
  ) {
    job.status = status;
    job.progressPercent = progressPercent;

    if (status === "training" && !job.startedAt) {
      job.startedAt = new Date();
    } else if ((status === "completed" || status === "failed") && !job.completedAt) {
      job.completedAt = new Date();
    }

    if (status === "failed") {
      job.error = statusMessage;
    }

    eventStream.publish(
      "agent.upskilling_progress",
      {
        jobId: job.id,
        agentId: job.agentId,
        pipId: job.pipId,
        status: job.status,
        type: job.type,
        progressPercent: job.progressPercent,
        message: statusMessage,
      },
      {},
      "upskilling_orchestrator"
    );
  }

  /**
   * Promote or record agent competency in the polymorphic actor_competencies ledger
   */
  public async promoteAgentCompetency(
    job: UpskillingJob,
    organizationId: number,
    canaryScore: number,
    diagnostics: string[] = []
  ): Promise<{ competencyId: number; proficiencyLevel: number }> {
    const competencyName =
      job.type === "prompt_optimization"
        ? "Prompt Directives & Schema Adherence"
        : job.type === "golden_samples"
        ? "Few-Shot Contextual Reasoning"
        : "Fine-Tuned Domain Mastery";

    const targetLevel = job.type === "prompt_optimization" ? 2 : job.type === "golden_samples" ? 3 : 4;

    try {
      // 1. Get or create the competency definition
      let [comp] = await db
        .select()
        .from(competencies)
        .where(and(eq(competencies.name, competencyName), eq(competencies.organizationId, organizationId)))
        .limit(1);

      if (!comp) {
        const [newComp] = await db
          .insert(competencies)
          .values({
            name: competencyName,
            category: "engineering",
            description: `Automated competency certified via autonomous ${job.type} upskilling`,
            organizationId,
            metadata: { certifiedVia: "upskilling_orchestrator" },
          })
          .returning();
        comp = newComp;
      }

      const agentIdStr = String(job.agentId);

      // 2. Check existing actor competency
      const [existing] = await db
        .select()
        .from(actorCompetencies)
        .where(
          and(
            eq(actorCompetencies.actorType, "agent"),
            eq(actorCompetencies.actorId, agentIdStr),
            eq(actorCompetencies.competencyId, comp.id)
          )
        )
        .limit(1);

      let finalLevel = targetLevel;
      if (existing) {
        finalLevel = Math.max(existing.proficiencyLevel, targetLevel);
        await db
          .update(actorCompetencies)
          .set({
            proficiencyLevel: finalLevel,
            verifiedAt: new Date(),
            verifiedBy: `Canary Benchmark (Score: ${(canaryScore * 100).toFixed(1)}%)`,
            metadata: {
              lastJobId: job.id,
              canaryScore,
              diagnostics,
              promotedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          })
          .where(eq(actorCompetencies.id, existing.id));
      } else {
        await db.insert(actorCompetencies).values({
          organizationId,
          actorType: "agent",
          actorId: agentIdStr,
          competencyId: comp.id,
          proficiencyLevel: targetLevel,
          verifiedAt: new Date(),
          verifiedBy: `Canary Benchmark (Score: ${(canaryScore * 100).toFixed(1)}%)`,
          metadata: {
            jobId: job.id,
            canaryScore,
            diagnostics,
            promotedAt: new Date().toISOString(),
          },
        });
      }

      eventStream.publish(
        "agent.competency_promoted",
        {
          agentId: job.agentId,
          competencyId: comp.id,
          competencyName,
          proficiencyLevel: finalLevel,
          canaryScore,
        },
        { organizationId },
        "upskilling_orchestrator"
      );

      return { competencyId: comp.id, proficiencyLevel: finalLevel };
    } catch (error: any) {
      // Do NOT return a success-shaped value here. This previously logged a warn
      // and returned { competencyId: 0 }, which the caller ignores -- so a failed
      // ledger write still reported "Upskilling successful!" and the operator was
      // told a competency had been granted that does not exist. Rethrow so the
      // job is marked failed by executeUpskillingJob's handler.
      logger.error(
        `Failed to update actor_competencies for agent ${job.agentId}: ${error.message}`,
        error,
      );
      throw new Error(
        `Competency promotion failed for agent ${job.agentId} (${competencyName}): ${error.message}`,
      );
    }
  }
}

export const upskillingOrchestratorService = new UpskillingOrchestratorService();
