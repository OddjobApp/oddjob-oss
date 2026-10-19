import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { TerritoryService } from "@server/domain/sales/core/territory.service.js";

export class TerritoryAssignmentExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "assign_to_territory";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const orgId = job.organizationId;
    if (!orgId) {
      return { success: false, output: "", status: "failure", error: "assign_to_territory requires an organizationId" };
    }

    const { record } = resolvedConfig;
    const territoryService = new TerritoryService();
    const territoryId = await territoryService.assignToTerritory(record);

    return { success: true, output: JSON.stringify({ territoryId }), status: "success" };
  }
}