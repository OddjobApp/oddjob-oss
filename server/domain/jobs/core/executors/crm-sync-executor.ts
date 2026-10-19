import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { CrmSyncService } from "@server/domain/sales/core/crm-sync.service.js";

export class CrmSyncJob implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "sync_with_crm";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const orgId = job.organizationId;
    if (!orgId) {
      return { success: false, output: "", status: "failure", error: "crm_sync requires an organizationId" };
    }

    const { objectType, objects } = resolvedConfig;
    const crmSyncService = new CrmSyncService(orgId);
    await crmSyncService.sync(objectType, objects);

    return { success: true, output: "", status: "success" };
  }
}