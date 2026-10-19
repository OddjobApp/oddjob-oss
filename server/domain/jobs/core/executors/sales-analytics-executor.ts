import { Job, JobExecutor, StepExecutionResult, VariableContext } from "./executor-types.js";
import { SalesAnalyticsService } from "@server/domain/sales/core/sales-analytics.service.js";

export class SalesAnalyticsExecutor implements JobExecutor {
  canExecute(jobType: string): boolean {
    return jobType === "generate_sales_analytics";
  }

  async execute(
    job: Job,
    resolvedConfig: any,
    pipeline: any,
    context: VariableContext
  ): Promise<StepExecutionResult> {
    const orgId = job.organizationId;
    if (!orgId) {
      return { success: false, output: "", status: "failure", error: "generate_sales_analytics requires an organizationId" };
    }

    const salesAnalyticsService = new SalesAnalyticsService();
    const winLossRate = await salesAnalyticsService.getWinLossRate();
    const salesCycleDuration = await salesAnalyticsService.getSalesCycleDuration();
    const salesRepPerformance = await salesAnalyticsService.getSalesRepPerformance();

    const output = {
      winLossRate,
      salesCycleDuration,
      salesRepPerformance,
    };

    return { success: true, output: JSON.stringify(output), status: "success" };
  }
}