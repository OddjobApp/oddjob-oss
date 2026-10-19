import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { Job } from "bullmq";
import { QUEUE_NAMES } from "@domain/core/infrastructure/queue/queue-service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { credentialsService } from "@domain/auth/core/credentials-service.js";
import { BaseWorker } from "./base-worker.js";
import { createChildSpan } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";


export interface AIJobData {
    organizationId?: number;
    credentialId: number;
    config: {
        model?: string;
        userPrompt?: string;
        systemPrompt?: string;
        temperature?: number;
        maxTokens?: number;
        responseFormat?: string;
        [key: string]: any;
    };
    input?: string;
    fileAttachments?: Array<{
        fileUri: string;
        mimeType?: string;
        fileName?: string;
    }>;
    traceContext?: any;
    callbackJobId?: number;
    callbackType?: "job_test" | "pipeline_step";
}

export interface AIJobResult {
    success: boolean;
    output?: string;
    error?: string;
    metadata?: {
        model: string;
        provider: string;
        tokensUsed?: number;
        latencyMs: number;
    };
}

export class AIWorker extends BaseWorker<AIJobData, AIJobResult> {
    constructor() {
        super(QUEUE_NAMES.AI, {
            concurrency: 20,
            limiter: {
                max: 100,
                duration: 1000
            }
        });
    }

    protected async execute(job: Job<AIJobData>): Promise<AIJobResult> {
        const { credentialId, config, input, fileAttachments } = job.data;
        let { traceContext } = job.data;

        // Resource Monitoring Guard
        const { governorService } = await import("@domain/governor/index.js");
        const resourceCheck = await governorService.validateResourceLoad();
        if (!resourceCheck.allowed) {
            throw new Error(resourceCheck.message || "System under critical load");
        }

        // Update internal traceContext if parent exists to keep forensic logs in sync
        if (traceContext) {
            traceContext = createChildSpan(traceContext);
        }

        // Get credential
        const orgConfig = job.data.organizationId != null
            ? await systemAiService.getAiConfig('copilot', job.data.organizationId) : null;
        const credential = orgConfig ? { metadata: orgConfig, envVarName: '' }
            : await credentialsService.getById(credentialId, null, false);
        if (!credential) {
            throw new Error(`Credential ${credentialId} not found`);
        }

        const apiKey = orgConfig?.apiKey || ("id" in credential ? await resolveCredentialSecret(credential) : undefined);
        if (!apiKey) {
            throw new Error(`API key not found for credential ${credentialId}`);
        }

        // Get AI client
        const client = AIClientFactory.getClient(credential.metadata as any);

        // Execute AI call
        const result = await client.execute({ ...config, organizationId: job.data.organizationId } as any, input, apiKey, fileAttachments, traceContext);

        this.logger.info(`Job ${job.id} completed`, {
            success: result.success,
            tokensUsed: result.metadata?.tokensUsed,
            latencyMs: result.metadata?.latencyMs
        });

        return result;
    }
}

let workerInstance: AIWorker | null = null;

export function startAIWorker() {
    if (!workerInstance) {
        workerInstance = new AIWorker();
    }
    return workerInstance;
}


