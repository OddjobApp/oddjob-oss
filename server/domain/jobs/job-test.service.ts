/**
 * Job Test Service
 * 
 * Business logic for executing job tests (curl, openapi, ai_api_call).
 */

import { db } from "@server/database_service.js";
import {
    jobs,
    ragAssets,
    apiSpecs,
    orgSettings,
    pipelines,
    pipelineExecutions,
    type RagAsset,
    type AIAgentConfig
} from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { credentialsService } from "@domain/auth/core/credentials-service.js";
import { datasetService } from "@domain/knowledge/core/dataset-service.js";
import { resolveJobConfig } from "@server/core/variable-resolver.js";
import { createRootTrace, TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { logForensicEvent, getMonotonicTimeNs } from "@domain/core/infrastructure/tracing/trace-logger.service.js";
import { supportsGeminiFileAttachments, uploadFileToGemini, type GeminiFileUploadResult } from "@domain/ai/core/gemini-files.service.js";
import { buildHybridContextFromAssets } from "@domain/knowledge/core/rag-langchain.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { createJobInputSchema, createJobOutputSchema } from "@server/utils/schema-generator.js";
import { type SchemaMapping } from "@domain/knowledge/core/flattening-service.js";
import { storeJobOutputAsKnowledge } from "@domain/knowledge/core/knowledge-store.js";
import { BadRequestError, NotFoundError, AppError, ErrorCode } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("JobTestService");

interface CaptureSchemas {
    captureInput?: boolean;
    captureOutput?: boolean;
    input?: any;
}

interface TestResult {
    success: boolean;
    output: any;
    error?: string;
    metadata?: Record<string, any>;
    request?: Record<string, any>;
    inputSchema?: any;
    outputSchema?: any;
    traceId?: string;
    stats?: any;
}

export const jobTestService = {
    /**
     * Test a CURL job
     */
    async testCurlJob(jobData: any, config: any, captureSchemas?: CaptureSchemas): Promise<TestResult> {
        let context: any = { named: {}, positional: {} };
        const rawInput = captureSchemas?.input;
        if (rawInput) {
            let parsedInput = rawInput;
            if (typeof rawInput === 'string' && (rawInput.trim().startsWith('{') || rawInput.trim().startsWith('['))) {
                try { parsedInput = JSON.parse(rawInput); } catch (e) { }
            }
            if (parsedInput && typeof parsedInput === 'object' && (parsedInput.positional || parsedInput.named)) {
                context = { ...context, ...parsedInput };
            }
        }

        const replaceInput = (val: any): any => {
            if (typeof val === 'string') return val.replace(/\{\{input\}\}/g, typeof rawInput === 'object' ? JSON.stringify(rawInput) : String(rawInput || ''));
            if (typeof val === 'object' && val !== null) {
                if (Array.isArray(val)) return val.map(replaceInput);
                const newObj: any = {};
                for (const k in val) newObj[k] = replaceInput(val[k]);
                return newObj;
            }
            return val;
        };

        let mutableConfig = JSON.parse(JSON.stringify(config));
        mutableConfig = replaceInput(mutableConfig);
        try { mutableConfig = resolveJobConfig("curl", mutableConfig, context); } catch (e) { }
        config = mutableConfig;

        if (!config.url) throw new BadRequestError("Job config is missing required 'url' field", {}, ErrorCode.CONFIGURATION_ERROR);

        const headers: Record<string, string> = { ...(config.headers || {}) };
        let resolvedUrl = config.url;
        let credential = null;

        const originalUrl = config.url;
        const isJiraSearchPost = (originalUrl.includes('/rest/api/3/search') || originalUrl.includes('/rest/api/2/search') || originalUrl.includes('/search/jql')) &&
            (config.method === "POST" || config.method === "PUT" || config.method === "PATCH");

        if (config.credentialId) {
            credential = await credentialsService.getById(config.credentialId, jobData.organizationId, true);
            if (credential) {
                const apiToken = (await resolveCredentialSecret(credential));
                if (apiToken) {
                    if (credential.type === "jira") {
                        const metadata = credential.metadata as any;
                        if (metadata?.email) {
                            headers['Authorization'] = `Basic ${Buffer.from(`${metadata.email}:${apiToken}`).toString('base64')}`;
                            if (resolvedUrl.startsWith('/')) resolvedUrl = metadata.baseUrl.replace(/\/$/, '') + resolvedUrl;
                        }
                    } else headers['Authorization'] = `Bearer ${apiToken}`;
                }
            }
        }

        if (isJiraSearchPost && resolvedUrl.includes('?')) {
            const urlParts = resolvedUrl.split('?');
            resolvedUrl = urlParts[0];
            if (!config.body) {
                const sp = new URLSearchParams(urlParts[1]);
                const bodyObj: any = {};
                sp.forEach((v, k) => {
                    if (k === 'fields') bodyObj[k] = v.split(',');
                    else if (k === 'maxResults' || k === 'startAt') bodyObj[k] = parseInt(v);
                    else bodyObj[k] = v;
                });
                config.body = JSON.stringify(bodyObj);
                if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
            }
        }

        const response = await fetch(resolvedUrl, {
            method: config.method || 'GET',
            headers,
            body: (config.method !== "GET" && config.method !== "HEAD") ? (typeof config.body === 'string' ? config.body : JSON.stringify(config.body)) : undefined
        });

        const text = await response.text();
        let json = null; try { json = JSON.parse(text); } catch (e) { }

        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: response.ok ? "success" : "failure" }).where(eq(jobs.id, Number(jobData.id)));

        // Mask sensitive headers for display
        const displayHeaders = { ...headers };
        if (displayHeaders.Authorization) {
            displayHeaders.Authorization = displayHeaders.Authorization.substring(0, 10) + '***';
        }

        const resData: TestResult = {
            success: response.ok,
            output: json || text,
            metadata: {
                status: response.status,
                statusText: response.statusText,
                url: resolvedUrl,
                headers: Object.fromEntries(response.headers.entries())
            },
            request: {
                url: resolvedUrl,
                method: config.method || 'GET',
                headers: displayHeaders,
                body: config.body || null,
            },
        };
        if (captureSchemas?.captureInput && captureSchemas.input) resData.inputSchema = createJobInputSchema(captureSchemas.input);
        if (captureSchemas?.captureOutput && (json || text)) resData.outputSchema = createJobOutputSchema(json || text);

        return resData;
    },

    /**
     * Test an OpenAPI job
     */
    async testOpenAPIJob(jobData: any, config: any, captureSchemas?: CaptureSchemas): Promise<TestResult> {
        const [spec] = await db.select().from(apiSpecs).where(eq(apiSpecs.id, Number(config.specId)));
        if (!spec || !spec.content) throw new NotFoundError("Spec not found", ErrorCode.NOT_FOUND, { specId: config.specId });

        const content = spec.content as any;
        const op = config.operationId;
        let method = "", path = "";
        for (const [p, ms] of Object.entries(content.paths)) {
            for (const [m, d] of Object.entries(ms as any)) {
                if ((d as any).operationId === op) { method = m.toUpperCase(); path = p; break; }
            }
            if (method) break;
        }

        let baseUrl = content.servers?.[0]?.url?.replace(/\/$/, "") || "";
        const headers: Record<string, string> = { "Content-Type": "application/json" };

        if (config.credentialId) {
            const cred = await credentialsService.getById(config.credentialId, jobData.organizationId, true);
            if (cred) {
                const token = (await resolveCredentialSecret(cred));
                if (token) {
                    if (cred.type === "jira") {
                        const m = cred.metadata as any;
                        headers["Authorization"] = `Basic ${Buffer.from(`${m.email}:${token}`).toString('base64')}`;
                        if (m.baseUrl) baseUrl = m.baseUrl.replace(/\/$/, "");
                    } else headers["Authorization"] = `Bearer ${token}`;
                }
            }
        }

        let actualPath = path;
        const query = new URLSearchParams();
        if (config.parameters) {
            for (const [k, v] of Object.entries(config.parameters)) {
                if (actualPath.includes(`{${k}}`)) actualPath = actualPath.replace(`{${k}}`, String(v));
                else query.append(k, String(v));
            }
        }

        const url = baseUrl + actualPath + (query.toString() ? "?" + query.toString() : "");
        const response = await fetch(url, {
            method, headers,
            body: method !== "GET" ? JSON.stringify(config.parameters) : undefined
        });

        const text = await response.text();
        let json = null; try { json = JSON.parse(text); } catch (e) { }

        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: response.ok ? "success" : "failure" }).where(eq(jobs.id, Number(jobData.id)));
        return { success: response.ok, output: json || text };
    },

    /**
     * Test an AI API Call job
     */
    async testAIAPICallJob(jobData: any, config: any, captureSchemas?: CaptureSchemas): Promise<TestResult> {
        const cred = await credentialsService.getById(config.credentialId, jobData.organizationId, true);
        if (!cred) throw new NotFoundError("AI Credential not found", ErrorCode.NOT_FOUND);
        const apiKey = (await resolveCredentialSecret(cred));
        if (!apiKey) throw new AppError("API Key missing", 500, ErrorCode.INTERNAL_ERROR);

        let finalConfig = config;
        let attachments: GeminiFileUploadResult[] | undefined = undefined;

        if (jobData.tool === "RAG Resource") {
            const assets = await db.select().from(ragAssets).where(eq(ragAssets.jobId, jobData.id)).orderBy(ragAssets.order);
            if (assets.length > 0) {
                const m = cred.metadata as any;
                if (m?.provider === "google") {
                    attachments = await Promise.all(assets.map(a => uploadFileToGemini(a, apiKey)));
                } else {
                    const ragResult = await buildHybridContextFromAssets(assets as RagAsset[], config.userPrompt || "");
                    finalConfig = { ...config, userPrompt: `${config.userPrompt}\n\nContext:\n${ragResult.context}` };
                }
            }
        }

        const client = AIClientFactory.getClient(cred.metadata as any);
        const execResult = await client.execute(finalConfig, undefined, apiKey, attachments);

        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: execResult.success ? "success" : "failure" }).where(eq(jobs.id, Number(jobData.id)));

        const result: TestResult = { success: execResult.success, output: execResult.output, error: execResult.error, metadata: execResult.metadata };
        if (captureSchemas?.captureInput && captureSchemas.input) result.inputSchema = createJobInputSchema(captureSchemas.input);
        if (captureSchemas?.captureOutput && execResult.output) result.outputSchema = createJobOutputSchema(execResult.output);

        return result;
    },

    /**
     * Test an AI Agent Job
     */
    async testAIAgentJob(jobData: any, config: any, captureSchemas?: CaptureSchemas): Promise<TestResult> {
        const agentConfig = config as AIAgentConfig;

        // 1. Resolve Credentials
        const cred = await credentialsService.getById(agentConfig.credentialId, jobData.organizationId, true);
        if (!cred) throw new NotFoundError("AI Credential not found", ErrorCode.NOT_FOUND);
        const apiKey = (await resolveCredentialSecret(cred));
        if (!apiKey) throw new AppError("API Key missing (Env Var not set)", 500, ErrorCode.INTERNAL_ERROR);

        // 2. Resolve Tools (Org Governance)
        let finalAllowedTools = agentConfig.allowedTools || [];
        if (jobData.organizationId) {
            const [settings] = await db.select().from(orgSettings).where(eq(orgSettings.organizationId, jobData.organizationId)).limit(1);
            if (settings?.allowedAgentTools) {
                finalAllowedTools = finalAllowedTools.filter(t => settings.allowedAgentTools!.includes(t));
            }
        }

        // 3. Setup Tracing
        const traceContext = createRootTrace(true);
        const startTimeNs = getMonotonicTimeNs();

        // 4. Resolve Variables (Test Input)
        let resolvedGoal = agentConfig.goal;
        let context: any = { named: {}, positional: {}, data: {} };
        const rawInput = captureSchemas?.input;

        if (rawInput) {
            let parsedInput = rawInput;
            if (typeof rawInput === 'string' && (rawInput.trim().startsWith('{') || rawInput.trim().startsWith('['))) {
                try { parsedInput = JSON.parse(rawInput); } catch (e) { }
            }
            context.data = { input: rawInput };
            if (parsedInput && typeof parsedInput === 'object') {
                context.named = parsedInput;
                if (parsedInput.positional) context.positional = parsedInput.positional;
            }
        }

        const { resolveJobConfig } = await import("@server/core/variable-resolver.js");
        const resolvedConfig = resolveJobConfig("ai_agent", agentConfig, context);
        resolvedGoal = resolvedConfig.goal;

        // If test input is provided and it's a string, use it as the goal.
        // This ensures that "Test Input" in the UI actually drives the test.
        if (rawInput && typeof rawInput === 'string' && rawInput.trim().length > 0) {
            resolvedGoal = rawInput;
        }

        // 5. Run Agent Loop
        const client = AIClientFactory.getClient(cred.metadata as any);
        const { runAgentLoop } = await import("@domain/agents/agent-runner.js");

        // Base config for LLM calls (Agent Runner needs this)
        const baseConfig: any = {
            credentialId: agentConfig.credentialId,
            model: agentConfig.model,
            temperature: 0, // Deterministic for tests
            systemPrompt: resolvedConfig.systemPrompt || agentConfig.systemPrompt,
            userPrompt: "",
            useCache: false
        };

        let output = "";
        let error: string | undefined;
        let success = false;

        try {
            const agentResult = await runAgentLoop(
                client,
                baseConfig,
                resolvedGoal,
                finalAllowedTools,
                agentConfig.maxIterations || 10,
                apiKey,
                {}, // Initial context
                traceContext,
                false, // dryRun
                undefined, // governorConfig
                "none" // Test runs skip all ALM stages for speed
            );
            output = agentResult.output;
            success = true;
        } catch (e: any) {
            error = e.message || String(e);
            output = error || "Agent execution failed";
        }

        // 5. Finalize Trace
        const endTimeNs = getMonotonicTimeNs();
        logForensicEvent(traceContext, {
            jobType: 'ai_agent',
            jobId: jobData.id,
            status: success ? 'success' : 'failure',
            startTimeNs,
            endTimeNs,
            errorMessage: error,
            attributes: {
                goal: agentConfig.goal,
                mode: 'manual_test'
            }
        });

        // 6. Return Result
        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: success ? "success" : "failure" }).where(eq(jobs.id, Number(jobData.id)));

        const result: TestResult = {
            success,
            output,
            error,
            metadata: {
                traceId: traceContext.traceId
            },
            traceId: traceContext.traceId
        };

        if (captureSchemas?.captureOutput && output) result.outputSchema = createJobOutputSchema(output);

        return result;
    },


    async saveOutputToDataset(jobData: any, result: TestResult): Promise<{ stats?: any } | void> {
        if (!result.success || !jobData.outputDatasetId) {
            return;
        }

        try {
            const outputString = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);

            const mockStepExecution = {
                id: 0,
                status: 'success',
                executedAt: new Date()
            };

            const settings = jobData.outputStorageSettings || {
                storeOnStatus: 'success',
                requireNonEmpty: true,
                schemaMapping: (await datasetService.getById(jobData.outputDatasetId, { organizationId: jobData.organizationId, userId: "system", isSuperAdmin: true } as any))?.schemaMapping
            };

            if (!settings.schemaMapping) {
                const dataset = await datasetService.getById(jobData.outputDatasetId, { organizationId: jobData.organizationId, userId: "system", isSuperAdmin: true } as any);
                settings.schemaMapping = dataset?.schemaMapping;
            }

            const knowledgeResult = await storeJobOutputAsKnowledge({
                output: outputString,
                job: jobData,
                stepExecution: mockStepExecution,
                topicId: jobData.outputKnowledgeTopicId || null,
                datasetId: jobData.outputDatasetId,
                tags: ['manual-test'],
                settings: settings
            });

            logger.info(`Delegated saving output to Dataset ${jobData.outputDatasetId} to knowledge store`);
            return knowledgeResult ?? undefined;
        } catch (datasetError) {
            logger.error(`Failed to save output to Dataset ${jobData.outputDatasetId}:`, datasetError);
        }
    },

    /**
     * Test a generic job using its registered executor
     */
    async testGenericJob(jobData: any, config: any, captureSchemas?: CaptureSchemas): Promise<TestResult> {
        // Dynamic import to avoid circular dependencies if any
        const { jobExecutorRegistry } = await import("./index.js");

        const executor = jobExecutorRegistry.getExecutor(jobData.type);
        if (!executor) {
            throw new BadRequestError("Unsupported job type", { type: jobData.type });
        }

        const traceContext = createRootTrace(true);
        let executionId = 0;

        // Supervisor jobs require an active pipeline execution ID for state management
        if (jobData.type === "supervisor") {
            // Use a dummy pipeline ID or create a transient one
            const [dummyPipeline] = await db.select().from(pipelines).limit(1);
            const pipelineId = dummyPipeline?.id || 0;

            const [execution] = await db.insert(pipelineExecutions).values({
                pipelineId,
                organizationId: jobData.organizationId,
                status: "running",
                createdBy: "system-tester",
                traceId: traceContext.traceId,
            } as any).returning();
            executionId = execution.id;
        }

        const execResult = await executor.execute(
            jobData,
            config,
            { id: 0, organizationId: jobData.organizationId } as any, // Mock pipeline
            { named: {}, positional: {}, traceContext, executionId } as any
        );

        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: execResult.success ? "success" : "failure" }).where(eq(jobs.id, Number(jobData.id)));

        const result: TestResult = {
            success: execResult.success,
            output: execResult.output,
            error: execResult.error,
            metadata: {
                status: execResult.status,
                traceId: traceContext.traceId
            },
            traceId: traceContext.traceId
        };

        if (captureSchemas?.captureInput && captureSchemas.input) result.inputSchema = createJobInputSchema(captureSchemas.input);
        if (captureSchemas?.captureOutput && execResult.output) result.outputSchema = createJobOutputSchema(execResult.output);

        if (result.success && (jobData.outputDatasetId || (jobData.enableKnowledgeStore && jobData.outputKnowledgeTopicId))) {
            try {
                const saveStats = await this.saveOutputToDataset(jobData, result);
                if (saveStats && saveStats.stats) {
                    result.stats = saveStats.stats;
                }
            } catch (err) {
                console.error(`[JobTest] Failed to save output to dataset:`, err);
                // Return error to frontend for debugging
                result.error = result.error ? `${result.error}\nDataset Save Error: ${err instanceof Error ? err.message : String(err)}` : `Dataset Save Error: ${err instanceof Error ? err.message : String(err)}`;
                // Also attach to metadata
                result.metadata = { ...result.metadata, datasetSaveError: err instanceof Error ? err.message : String(err) };
            }
        }

        return result;
    }
};

export default jobTestService;



