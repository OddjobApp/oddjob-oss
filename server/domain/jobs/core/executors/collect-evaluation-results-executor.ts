import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { db } from "@server/database_service.js";
import { evaluationResults } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";

export class CollectEvaluationResultsExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "collect_evaluation_results";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const { harnessId, harnessVersion } = resolvedConfig;
    
    if (!harnessId || !harnessVersion) {
      return { success: false, output: "", status: "failure", error: "harnessId and harnessVersion are required" };
    }

    // Fail closed rather than reading every tenant's harness telemetry.
    const organizationId = job.organizationId;
    if (!Number.isInteger(organizationId) || (organizationId as number) <= 0) {
      return {
        success: false,
        output: "",
        status: "failure",
        error: "collect_evaluation_results requires an organization-scoped job; refusing an unscoped read of harness telemetry.",
      };
    }

    // In a real scenario, this would trigger an actual evaluation process and collect results.
    // For now, we'll fetch existing evaluation results from the database.
    // The organization predicate is explicit: a NULL organization_id is an
    // unattributed legacy row and must never match a scoped read.
    const results = await db.select().from(evaluationResults)
      .where(and(
        eq(evaluationResults.organizationId, organizationId as number),
        eq(evaluationResults.harnessId, harnessId),
        eq(evaluationResults.harnessVersion, harnessVersion),
      ));

    return { success: true, output: JSON.stringify({ evaluationResults: results }), status: "success" };
  }
}