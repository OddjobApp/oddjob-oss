import { JobExecutor, ExecuteJobFn } from "./index.js";
import { Job, Pipeline, MonitoringQueryConfig } from "@shared/schema/index.js";
import { VariableContext } from "@server/core/variable-resolver.js";
import { StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { getMonitoringClient, DatadogClient, PagerDutyClient } from "@domain/integrations/monitoring-service.js";

export class MonitoringExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "monitoring_query";
    }

    async execute(
        job: Job,
        resolvedConfig: MonitoringQueryConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const { credentialId, provider, action, query, from, to, tags, incidentId, alertTitle, alertBody, severity, limit } = resolvedConfig;

        try {
            const client = await getMonitoringClient(credentialId, job.organizationId, provider);
            let result: any;

            if (provider === "datadog") {
                const dd = client as DatadogClient;
                const fromTs = from ? Math.floor(new Date(from).getTime() / 1000) : Math.floor(Date.now() / 1000) - 3600;
                const toTs = to ? Math.floor(new Date(to).getTime() / 1000) : Math.floor(Date.now() / 1000);

                switch (action) {
                    case "query_metrics":
                        if (!query) throw new Error("query is required for query_metrics");
                        result = await dd.queryMetrics(query, fromTs, toTs);
                        break;
                    case "list_alerts":
                        result = await dd.listMonitors(tags, limit);
                        break;
                    case "list_dashboards":
                        result = await dd.listDashboards();
                        break;
                    case "trigger_alert":
                        if (!alertTitle) throw new Error("alertTitle is required for trigger_alert");
                        result = await dd.postEvent(alertTitle, alertBody || alertTitle, severity || "error", tags);
                        break;
                    default:
                        throw new Error(`Action '${action}' is not supported for Datadog`);
                }
            } else if (provider === "pagerduty") {
                const pd = client as PagerDutyClient;

                switch (action) {
                    case "get_incidents":
                        result = await pd.listIncidents(limit);
                        break;
                    case "resolve_incident":
                        if (!incidentId) throw new Error("incidentId is required for resolve_incident");
                        result = await pd.resolveIncident(incidentId, "oddjob@system");
                        break;
                    case "get_service_status":
                        result = await pd.listServices(limit);
                        break;
                    default:
                        throw new Error(`Action '${action}' is not supported for PagerDuty`);
                }
            } else {
                throw new Error(`Provider '${provider}' is not yet supported. Supported: datadog, pagerduty`);
            }

            return {
                success: true,
                status: "success",
                output: JSON.stringify({ provider, action, result }),
            };
        } catch (error: any) {
            return {
                success: false,
                status: "failed",
                output: JSON.stringify({ error: error.message, provider, action: resolvedConfig.action }),
            };
        }
    }
}
