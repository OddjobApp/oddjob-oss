import { JobExecutor, ExecuteJobFn } from "./index.js";
import { Job, Pipeline, TeamsPostConfig } from "@shared/schema/index.js";
import { VariableContext } from "@server/core/variable-resolver.js";
import { StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { getMicrosoft365Client } from "@domain/integrations/microsoft365-service.js";

export class TeamsExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "teams_post";
    }

    async execute(
        job: Job,
        resolvedConfig: TeamsPostConfig,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any> },
        executeJob?: ExecuteJobFn
    ): Promise<StepExecutionResult> {
        const { credentialId, teamId, channelId, message, isHtml, subject } = resolvedConfig;

        try {
            const client = await getMicrosoft365Client(credentialId, job.organizationId);
            const result = await client.postTeamsMessage(teamId, channelId, message, isHtml, subject);
            return {
                success: true,
                status: "success",
                output: JSON.stringify({ messageId: result.id, teamId, channelId, status: "sent" }),
            };
        } catch (error: any) {
            return {
                success: false,
                status: "failed",
                output: JSON.stringify({ error: error.message, teamId, channelId }),
            };
        }
    }
}
