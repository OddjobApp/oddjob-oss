
import { Job, Pipeline, SlackPostConfig } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { credentialsService } from "../../../auth/core/credentials-service.js";
import { CredentialNotFoundError, AppError, ErrorCode, NotFoundError } from "@server/utils/errors.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

export class SlackExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "slack_post";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as SlackPostConfig;
        let credential;
        try {
            credential = await credentialsService.getForExecution(config.credentialId, pipeline.organizationId);
        } catch (err) {
            if (err instanceof NotFoundError) {
                throw new CredentialNotFoundError(config.credentialId);
            }
            throw err;
        }

        const res = await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${(await resolveCredentialSecret(credential))}`
            },
            body: JSON.stringify({ channel: config.channelId, text: config.message })
        });

        const data = await res.json();

        if (!data.ok) {
            throw new AppError(`Slack API Error: ${data.error}`, 500, ErrorCode.EXTERNAL_SERVICE_ERROR, { details: data });
        }

        return {
            success: true,
            output: JSON.stringify(data),
            status: "success"
        };
    }
}


