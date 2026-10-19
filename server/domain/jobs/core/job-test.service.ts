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
    type RagAsset,
    type AIAgentConfig
} from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { storage } from "@domain/knowledge/core/storage.service.js";
import { credentialsService } from "@domain/auth/core/credentials-service.js";
import { resolveJobConfig } from "@server/core/variable-resolver.js";
import { createRootTrace, TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { logForensicEvent, getMonotonicTimeNs } from "@domain/core/infrastructure/tracing/trace-logger.service.js";
import { supportsGeminiFileAttachments, uploadFileToGemini, type GeminiFileUploadResult } from "@domain/ai/core/gemini-files.service.js";
import { buildHybridContextFromAssets } from "@domain/knowledge/core/rag-langchain.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { createJobInputSchema, createJobOutputSchema } from "@server/utils/schema-generator.js";
import { type SchemaMapping } from "@domain/knowledge/core/flattening-service.js"; // Removed flattenForDataset
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
            credential = await credentialsService.getById(config.credentialId, jobData.organizationId);
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

        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: response.ok ? "success" : "failure" }).where(eq(jobs.id, jobData.id));

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
                url: resolvedUrl
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
            const cred = await credentialsService.getById(config.credentialId, jobData.organizationId);
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

        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: response.ok ? "success" : "failure" }).where(eq(jobs.id, jobData.id));
        return { success: response.ok, output: json || text };
    },

    /**
     * Test an AI API Call job
     */
    async testAIAPICallJob(jobData: any, config: any, captureSchemas?: CaptureSchemas): Promise<TestResult> {
        const cred = await credentialsService.getById(config.credentialId, jobData.organizationId);
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

        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: execResult.success ? "success" : "failure" }).where(eq(jobs.id, jobData.id));

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
        const cred = await credentialsService.getById(agentConfig.credentialId, jobData.organizationId);
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

        // 4. Run Agent Loop
        const client = AIClientFactory.getClient(cred.metadata as any);
        const { runAgentLoop } = await import("@domain/agents/agent-runner.js");

        // Base config for LLM calls (Agent Runner needs this)
        const baseConfig: any = {
            credentialId: agentConfig.credentialId,
            model: agentConfig.model,
            temperature: 0, // Deterministic for tests
            systemPrompt: agentConfig.systemPrompt,
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
                agentConfig.goal,
                finalAllowedTools,
                agentConfig.maxIterations || 10,
                apiKey,
                {}, // Initial context
                traceContext
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
        await db.update(jobs).set({ lastTestedAt: new Date(), lastTestStatus: success ? "success" : "failure" }).where(eq(jobs.id, jobData.id));

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

    /**
     * Fallback for generic jobs
     */
    async testGenericJob(jobId: any, config: any, captureSchemas?: CaptureSchemas): Promise<TestResult> {
        return this.testCurlJob(jobId, config, captureSchemas);
    },

    /**
     * Save test output to dataset (with flattening)
     */
    async saveOutputToDataset(jobData: any, result: TestResult): Promise<any> {
        if (!result.success || !jobData.outputDatasetId) return;

        try {
            const outputString = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);

            // Re-fetch job to get latest settings if needed, or use jobData if it's full Job object
            // jobData usually comes from the request body or DB. 
            // We need outputStorageSettings.

            // Mock a step execution for manual test
            const mockStepExecution = {
                id: 0, // Indicates manual/test run
                status: 'success',
                executedAt: new Date()
            };

            // Use settings from jobData or default
            const settings = jobData.outputStorageSettings || {
                storeOnStatus: 'success',
                requireNonEmpty: true,
                schemaMapping: (await storage.getDataset(jobData.outputDatasetId))?.schemaMapping
            };

            // We need to ensure schemaMapping is present. 
            // In the original code, it fetched the dataset to get the schemaMapping.
            // storeJobOutputAsKnowledge uses 'settings' which is passed in.
            // If jobData doesn't have the latest schema mapping (e.g. it was just edited in the UI but not saved to job?), 
            // then we should respect what's passed or fetch from dataset.
            // The UI usually saves the job config before running test? 
            // Actually, for "Test Job", we might be testing UN-SAVED changes.
            // But 'saveOutputToDataset' is likely called after the user explicitly clicks "Save to Dataset" button?
            // "Save Output" usually implies using the Job's configured output dataset.

            // Let's stick effectively to what was there: fetch dataset to get schema.
            // BUT storeJobOutputAsKnowledge expects settings to contain the schemaMapping if we want it used?
            // knowledge-store.ts: 
            // const { flattened } = flatteningService.flattenForDataset(item, settings.schemaMapping);

            // So we must populate settings.schemaMapping.
            if (!settings.schemaMapping) {
                const dataset = await storage.getDataset(jobData.outputDatasetId);
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
            return knowledgeResult;
        } catch (datasetError) {
            logger.error(`Failed to save output to Dataset ${jobData.outputDatasetId}:`, datasetError);
        }
    }
};

export default jobTestService;


