import { systemAiService } from "@domain/ai/core/system-ai.service.js";

import { Job, Pipeline, AIApiCallConfig, ragAssets, RagAsset, AIProviderMetadata } from "@shared/schema/index.js";
import { VariableContext } from "../../../../core/variable-resolver.js";
import { StepExecutionResult } from "../../../../core/pipeline-step-runner.js";
import { JobExecutor } from "./index.js";
import { credentialsService } from "../../../auth/core/credentials-service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { db } from "../../../../database_service.js";
import { eq } from "drizzle-orm";
import { resolveRagContentSources } from "../../../knowledge/core/knowledge-store.js";
import { uploadFileToGemini, supportsGeminiFileAttachments, GeminiFileUploadResult } from "@domain/ai/core/gemini-files.service.js";
import { buildHybridContextFromAssets } from "@domain/knowledge/core/rag-langchain.service.js";
import { augmentPromptWithRag } from "@domain/knowledge/core/rag-utils.service.js";
import { CredentialNotFoundError, ConfigurationError, AIProviderError, AppError, ErrorCode } from "@server/utils/errors.js";
import { saveJobOutput } from "./executor-utils.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

export class AiApiExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "ai_api_call";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as AIApiCallConfig;

        // Key priority: the org's own default AI connection, then the step's pinned
        // credential (within the job's org), then the platform configuration.
        const { orgModelService } = await import("@domain/ai/core/org-model.service.js");
        const orgOwn = job.organizationId != null ? await orgModelService.resolve(job.organizationId) : null;
        let credential: { type: string; metadata: unknown; envVarName: string };
        let apiKey: string | undefined;
        if (orgOwn) {
            credential = { type: 'ai_provider', metadata: { provider: orgOwn.provider, model: orgOwn.model }, envVarName: '' };
            apiKey = orgOwn.apiKey;
        } else if (config.credentialId) {
            // Within the job's org, then platform credentials — never another tenant's
            // (the third argument is isSuperAdmin; true would drop the org filter).
            const credentialId = config.credentialId;
            const pinned = await credentialsService.getById(credentialId, job.organizationId ?? null, false)
                .catch(() => job.organizationId != null ? credentialsService.getById(credentialId, null, false) : null)
                .catch(() => null);
            if (!pinned) throw new CredentialNotFoundError(config.credentialId);
            credential = pinned as any;
            apiKey = (await resolveCredentialSecret(pinned));
        } else {
            const platform = await systemAiService.getAiConfig('copilot', job.organizationId ?? undefined);
            if (!platform?.apiKey) throw new ConfigurationError("No AI credential on this step and no platform AI provider configured");
            credential = { type: 'ai_provider', metadata: { provider: platform.provider, model: platform.model }, envVarName: '' };
            apiKey = platform.apiKey;
        }
        if (credential.type !== "ai_provider") throw new ConfigurationError("Credential must be an AI provider");
        if (!apiKey) throw new ConfigurationError(`The AI credential's key is not set (${credential.envVarName || "no env var"})`);
        config.organizationId = job.organizationId;

        let finalConfig = config;
        let geminiAttachments: GeminiFileUploadResult[] | undefined = undefined;
        let resolvedSources: any[] = [];
        let status = "success";
        let output = "";

        // 2. RAG & Attachments Logic
        if (job.tool === "RAG Resource") {
            const ragAssetsList = await db.select().from(ragAssets).where(eq(ragAssets.jobId, job.id)).orderBy(ragAssets.order);
            resolvedSources = await resolveRagContentSources(ragAssetsList as RagAsset[]);

            if (resolvedSources.length > 0) {
                const metadata = credential.metadata as AIProviderMetadata;
                if (metadata.provider === "google") {
                    // Specific logic for Gemini File API
                    if (!supportsGeminiFileAttachments(config.model)) {
                        throw new ConfigurationError(`Gemini model "${config.model}" does not support file attachments.`);
                    }
                    try {
                        geminiAttachments = await Promise.all(resolvedSources.map(asset => uploadFileToGemini(asset, apiKey)));
                        finalConfig = config;
                        resolvedSources = []; // Handled by Gemini API, not context injection
                    } catch (error) {
                        console.error(`[AiApiExecutor] Error uploading files to Gemini, falling back to context injection:`, error);
                        // Fallback to text context injection
                        const ragResult = await buildHybridContextFromAssets(resolvedSources, config.userPrompt || "", {
                            enableQueryExpansion: config.enableQueryExpansion,
                            credentialId: config.credentialId,
                            retrievalSettings: config.retrievalSettings
                        });
                        finalConfig = augmentPromptWithRag(config, ragResult.context);

                        if (ragResult.retrievedDocs.length > 0) {
                            resolvedSources = ragResult.retrievedDocs.map(doc => ({
                                name: doc.metadata.name || "Unknown Document",
                                textContent: doc.pageContent,
                                fileData: null,
                                url: (doc.metadata as any).source || (doc.metadata as any).url || null,
                                ...doc
                            }));
                        }
                    }
                } else {
                    // Standard RAG for other providers (OpenAI, Anthropic, etc)
                    const ragResult = await buildHybridContextFromAssets(resolvedSources, config.userPrompt || "", {
                        enableQueryExpansion: config.enableQueryExpansion,
                        credentialId: config.credentialId,
                        retrievalSettings: config.retrievalSettings
                    });
                    finalConfig = augmentPromptWithRag(config, ragResult.context);

                    if (ragResult.retrievedDocs.length > 0) {
                        resolvedSources = ragResult.retrievedDocs.map(doc => ({
                            name: doc.metadata.name || "Unknown Document",
                            textContent: doc.pageContent,
                            fileData: null,
                            url: (doc.metadata as any).source || (doc.metadata as any).url || null,
                            ...doc
                        }));
                    }
                }
            }
        }

        // 3. Execute AI Implementation
        const metadata = credential.metadata as AIProviderMetadata;
        const client = AIClientFactory.getClient(metadata);

        let result;
        try {
            // Inject Financial Context
            finalConfig.organizationId = job.organizationId || context.orgId || null;
            finalConfig.missionId = context.missionId || null;

            result = await client.execute(finalConfig, undefined, apiKey, geminiAttachments);
        } catch (e: any) {

            throw new AIProviderError(metadata.provider || 'unknown', e);
        }

        if (!result.success) throw new AIProviderError(metadata.provider || 'unknown', new Error(result.error));

        output = result.output || "";

        // 4. Augment output with Source Metadata if RAG was used
        if (job.tool === "RAG Resource" && resolvedSources.length > 0) {
            output = JSON.stringify({
                generated_content: output,
                citation_metadata: {
                    usage: { total_tokens: result.metadata?.tokensUsed || 0, latency_ms: result.metadata?.latencyMs || 0 },
                    citations: resolvedSources.map(s => ({
                        document_name: s.name,
                        snippet_text: s.textContent || (s.fileData ? "[File Content]" : s.url) || s.name,
                        relevance_score: (s as any).adjustedScore || (s as any).score || 1.0,
                        semantic_score: (s as any).semanticScore,
                        is_verified: (s as any).metadata?.verificationStatus === "verified"
                    }))
                }
            }, null, 2);
        }

        // 5. Telemetry
        const telemetry = {
            tokens_used: result.metadata?.tokensUsed || 0,
            latency_ms: result.metadata?.latencyMs || 0,
            model: finalConfig.model,
            rag_sources_count: resolvedSources.length,
            is_rag: job.tool === "RAG Resource"
        };

        await saveJobOutput(job, config, output);

        return {
            success: true,
            output,
            status,
            telemetry,
            __aiUsageMetadata: {
                provider: (metadata as any).provider || 'unknown',
                model: finalConfig.model,
                metadata: {
                    totalTokens: result.metadata?.tokensUsed || 0,
                    promptTokens: result.metadata?.promptTokens || 0,
                    completionTokens: result.metadata?.completionTokens || 0
                }
            }
        } as any;
    }
}


