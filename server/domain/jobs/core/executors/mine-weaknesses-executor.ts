import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { WeaknessMiningService } from "@server/domain/self-improvement/weakness-mining.service.js";

export class MineWeaknessesExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "mine_weaknesses";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const { harnessId, harnessVersion, evaluationResults } = resolvedConfig;

    if (!harnessId || !harnessVersion || !evaluationResults) {
      return { success: false, output: "", status: "failure", error: "harnessId, harnessVersion, and evaluationResults are required" };
    }

    // Clustering is tenant-scoped; without an organization it would merge
    // failures across every tenant on the same harness.
    const organizationId = job.organizationId;
    if (!Number.isInteger(organizationId) || (organizationId as number) <= 0) {
      return {
        success: false,
        output: "",
        status: "failure",
        error: "mine_weaknesses requires an organization-scoped job; refusing to cluster failures across tenants.",
      };
    }

    const weaknessMiningService = new WeaknessMiningService();
    const failurePatterns = await weaknessMiningService.mineWeaknesses(
      organizationId as number,
      harnessId,
      harnessVersion,
      evaluationResults,
    );

    return { success: true, output: JSON.stringify({ failurePatterns }), status: "success" };
  }
}