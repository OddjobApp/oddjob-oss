
import { Job, Pipeline, EmailSendConfig, SmtpMetadata } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { credentialsService } from "../../../auth/core/credentials-service.js";
import { CredentialNotFoundError, AppError, ErrorCode } from "@server/utils/errors.js";
import nodemailer from "nodemailer";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

export class EmailExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "email_send";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as EmailSendConfig;
        const credential = await credentialsService.getForExecution(config.credentialId, pipeline.organizationId);
        if (!credential) throw new CredentialNotFoundError(config.credentialId);

        const metadata = credential.metadata as SmtpMetadata;
        const transporter = nodemailer.createTransport({
            host: metadata.host,
            port: metadata.port,
            secure: metadata.secure,
            auth: {
                user: metadata.user,
                pass: (await resolveCredentialSecret(credential))
            }
        });

        const info = await transporter.sendMail({
            from: metadata.fromEmail,
            to: config.to,
            subject: config.subject,
            html: config.isHtml ? config.body : undefined,
            text: !config.isHtml ? config.body : undefined
        });

        return {
            success: true,
            output: `Sent: ${info.messageId}`,
            status: "success"
        };
    }
}


