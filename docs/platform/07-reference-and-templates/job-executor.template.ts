import { BaseJobExecutor, JobExecutionContext, JobExecutionResult } from "../../server/domain/jobs/core/executors/base-job-executor.js";
import { z } from "zod";

/**
 * Input validation schema for this executor.
 * Document every field clearly with descriptions to assist both human developers
 * and AI agent prompt compilers.
 */
export const CustomJobInputSchema = z.object({
  targetEntityId: z.string().min(1).describe("The unique identifier of the target entity to process"),
  operationMode: z.enum(["dry-run", "commit"]).default("dry-run").describe("Execution mode: dry-run simulates changes without persistence"),
  batchSize: z.number().int().min(1).max(1000).default(100).describe("Number of records to process per iteration batch"),
  metadata: z.record(z.unknown()).optional().default({}).describe("Additional contextual parameters"),
});

export type CustomJobInput = z.infer<typeof CustomJobInputSchema>;

/**
 * Custom Job Executor Template
 * 
 * Auto-discovered upon server boot by matching the pattern `*-executor.ts`
 * in `server/domain/jobs/core/executors/`.
 */
export class CustomJobExecutor extends BaseJobExecutor {
  /** Unique job type identifier stored in `jobs.type` */
  public readonly jobType = "custom_operation_job";

  /**
   * Main execution lifecycle method.
   */
  public async execute(context: JobExecutionContext<CustomJobInput>): Promise<JobExecutionResult> {
    const { input, logger, span, signal } = context;

    logger.info(`[${this.jobType}] Starting execution for job ${context.jobId}`, {
      targetEntityId: input.targetEntityId,
      operationMode: input.operationMode,
    });

    try {
      // 1. Stage 1: Validation and Hydration
      await this.emitProgress(context, 10, "Validating parameters and hydrating context...");
      
      if (signal?.aborted) {
        throw new Error("Job execution was aborted by user request");
      }

      // 2. Stage 2: Core Processing with OpenTelemetry Span
      await this.emitProgress(context, 40, "Processing entity records...");
      const processedResults = await span.traceChild("process-records", async () => {
        // Business logic here
        return [
          { recordId: "rec-001", status: "success" },
          { recordId: "rec-002", status: "success" },
        ];
      });

      // 3. Stage 3: Persistence / Writeback
      await this.emitProgress(context, 80, "Persisting output results...");
      if (input.operationMode === "commit") {
        logger.info(`[${this.jobType}] Committing changes to database...`);
        // Commit mutation
      } else {
        logger.info(`[${this.jobType}] Dry-run mode: skipping database commit.`);
      }

      // 4. Final Progress & Return
      await this.emitProgress(context, 100, "Operation complete");

      return {
        success: true,
        output: {
          processedCount: processedResults.length,
          mode: input.operationMode,
          records: processedResults,
        },
        metrics: {
          durationMs: context.getDurationMs(),
          recordsProcessed: processedResults.length,
        },
      };
    } catch (error) {
      logger.error(`[${this.jobType}] Execution failed: ${(error as Error).message}`, {
        error,
        jobId: context.jobId,
      });

      return {
        success: false,
        error: (error as Error).message,
        metrics: {
          durationMs: context.getDurationMs(),
          recordsProcessed: 0,
        },
      };
    }
  }
}

export default CustomJobExecutor;
