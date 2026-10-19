import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { db } from "@server/database_service.js";
import { evaluationResults } from "@shared/schema/index.js";

export class LogEvaluationResultExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "log_evaluation_result";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const { harnessId, harnessVersion, status, metrics, traceId, failureReason } = resolvedConfig;

    if (!harnessId || !harnessVersion || !status) {
      return { success: false, output: "", status: "failure", error: "harnessId, harnessVersion, and status are required for logging evaluation result" };
    }

    // Fail closed on tenancy. This table had no organization column at all, so
    // every row was global; refusing here is what keeps the new one meaningful.
    // Never substitute a default organization.
    const organizationId = job.organizationId;
    if (!Number.isInteger(organizationId) || (organizationId as number) <= 0) {
      return {
        success: false,
        output: "",
        status: "failure",
        error: "log_evaluation_result requires an organization-scoped job; refusing to write unattributed harness telemetry.",
      };
    }

    const [newEvaluationResult] = await db.insert(evaluationResults).values({
      organizationId,
      harnessId,
      harnessVersion,
      status,
      metrics: metrics || {},
      traceId,
      failureReason,
    }).returning();

    return { success: true, output: JSON.stringify({ evaluationResultId: newEvaluationResult.id }), status: "success" };
  }
}