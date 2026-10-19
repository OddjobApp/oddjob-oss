import { ExecutionHook, PipelineCompleteParams } from "./execution-hooks.js";


/**
 * Reporting Hook
 * 
 * Automatically refreshes KPI materialized views after pipeline completion.
 */
export class ReportingHook implements ExecutionHook {
    name = "ReportingHook";

    async onPipelineComplete(params: PipelineCompleteParams) {
        console.log(`[ReportingHook] Pipeline ${params.pipeline.id} completed. Refreshing KPI views...`);
        try {
            const { reportingService } = await import("@domain/analytics/core/reporting.service.js");
            const results = await reportingService.refreshKPIViews();
            console.log(`[ReportingHook] KPI views refreshed successfully.`, results);
        } catch (error) {
            console.error(`[ReportingHook] Failed to refresh KPI views:`, error);
        }
    }
}


