import { JobExecutor, ExecuteJobFn } from "./index.js";
import { Job, Pipeline, CloudFunctionConfig } from "@shared/schema/index.js";
import { VariableContext } from "@server/core/variable-resolver.js";
import { StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { getCloudClient, CloudClient } from "@domain/integrations/cloud-service.js";

export class CloudFunctionExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "cloud_function";
    }

    async execute(
        job: Job,
        resolvedConfig: CloudFunctionConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const { credentialId, provider, action, functionName, functionPayload, invocationType, logGroupName, filterPattern, startTime, endTime } = resolvedConfig;

        try {
            const client = await getCloudClient(credentialId, job.organizationId);
            let result: any;

            if (provider === "aws") {
                switch (action) {
                    case "invoke_function":
                        if (!functionName) throw new Error("functionName is required for invoke_function");
                        result = await client.invokeAWSLambda(functionName, functionPayload || {}, invocationType || "sync");
                        break;
                    case "list_functions":
                        result = await client.listAWSFunctions();
                        break;
                    case "read_logs":
                        if (!logGroupName) throw new Error("logGroupName is required for read_logs");
                        result = await client.readAWSLogs(logGroupName, filterPattern, startTime, endTime);
                        break;
                    default:
                        throw new Error(`Action '${action}' is not supported for provider '${provider}'`);
                }
            } else if (provider === "gcp") {
                switch (action) {
                    case "invoke_function":
                        if (!functionName) throw new Error("functionName is required for invoke_function");
                        result = await client.invokeGCPFunction(functionName, functionPayload || {});
                        break;
                    case "list_functions":
                        result = await client.listGCPFunctions();
                        break;
                    default:
                        throw new Error(`Action '${action}' is not supported for provider '${provider}'`);
                }
            } else {
                throw new Error(`Provider '${provider}' is not yet fully supported. Supported providers: aws, gcp`);
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
