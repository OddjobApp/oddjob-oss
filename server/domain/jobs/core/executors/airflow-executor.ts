
import { Job, Pipeline, AirflowDagRunConfig, AirflowMetadata } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { credentialsService } from "../../../auth/core/credentials-service.js";
import { AppError, ErrorCode, ConfigurationError } from "@server/utils/errors.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

export class AirflowExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "airflow_dag_run";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as AirflowDagRunConfig;
        const credId = parseInt(config.connectionId);
        if (isNaN(credId)) throw new ConfigurationError("Airflow connectionId must be a numeric Credential ID");

        const credential = await credentialsService.getForExecution(credId, pipeline.organizationId);
        if (!credential) throw new ConfigurationError(`Credential ${credId} not found`);
        const metadata = credential.metadata as AirflowMetadata;

        const baseUrl = metadata.baseUrl.replace(/\/$/, "");
        const url = `${baseUrl}/dags/${encodeURIComponent(config.dagId)}/dagRuns`;
        const envVar = (await resolveCredentialSecret(credential));

        const headers: any = { "Content-Type": "application/json" };
        if (metadata.authType === "basic" && envVar) {
            headers["Authorization"] = `Basic ${Buffer.from(`${metadata.username}:${envVar}`).toString("base64")}`;
        } else if (metadata.authType === "bearer" && envVar) {
            headers["Authorization"] = `Bearer ${envVar}`;
        }

        const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ conf: config.dagRunConf || {} })
        });

        if (!res.ok) {
            const text = await res.text();
            throw new AppError(`Airflow trigger failed: ${text}`, res.status, ErrorCode.EXTERNAL_SERVICE_ERROR);
        }

        const data = await res.json();

        return {
            success: true,
            output: `Triggered: ${data.dag_run_id}`,
            status: "waiting_async",
            externalId: data.dag_run_id
        };
    }
}


