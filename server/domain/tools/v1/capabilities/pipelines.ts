import { z } from "zod";
import { db } from "../../../../database_service.js";
import { pipelines, pipelineExecutions, pipelineStepExecutions, agentDeployments, jobs } from "@shared/schema/index.js";
import { eq, desc, and, ilike, inArray } from "drizzle-orm";
import type { ToolDefinition, ToolContext } from "./types.js";
import { requireToolOrgId } from "./org-context.js";

// Helper function to extract text from MCP response format
function extractMcpText(mcpResult: any): string {
    if (mcpResult?.content && Array.isArray(mcpResult.content)) {
        const textContent = mcpResult.content.find((c: any) => c.type === "text");
        if (textContent?.text) {
            return textContent.text;
        }
    }
    return JSON.stringify(mcpResult, null, 2);
}

export const PIPELINE_TOOLS: Record<string, ToolDefinition> = {
    // --- Template Tools ---
    list_templates: {
        name: "list_templates",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Templates",
        group: "Pipeline Orchestration",
        description: "List available pipeline templates. Use this to recommend templates to the user.",
        parameters: z.object({
            search: z.string().optional().describe("Search term for template name"),
            category: z.string().optional().describe("Filter by category"),
            limit: z.number().optional().default(10),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleListTemplates } = await import("../../../../mcp/handlers.js");
            const result = await handleListTemplates(params, context);
            return extractMcpText(result);
        }
    },
    get_template_details: {
        name: "get_template_details",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Template Details",
        group: "Pipeline Orchestration",
        description: "Get the configuration details of a specific template.",
        parameters: z.object({
            templateId: z.number().optional(),
            templateName: z.string().optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleGetTemplateDetails } = await import("../../../../mcp/handlers.js");
            const result = await handleGetTemplateDetails(params, context);
            return extractMcpText(result);
        }
    },

    // --- Pipeline Orchestration ---
    resolve_intent_to_pipeline: {
        name: "resolve_intent_to_pipeline",
        idempotency: "read-safe",
        label: "Resolve Intent to Pipeline",
        group: "Pipeline Orchestration",
        description: "Map a user's natural language intent (e.g. 'Run JIRA analysis') to a pipeline. Use before trigger_pipeline when the user describes what they want to run.",
        parameters: z.object({
            intent: z.string().describe("The user's intent in natural language"),
        }),
        execute: async ({ intent }: any, context: ToolContext) => {
            try {
                const orgId = context?.organizationId;
                const allowedPipelineIds = context?.allowedPipelineIds ?? context?.jobConfig?.pipelineIds;
                if (!orgId) return "Error: Organization context required.";
                const { mapIntentToPipeline } = await import("@domain/pipeline/core/intent-pipeline-mapper.service.js");
                const result = await mapIntentToPipeline(intent, orgId, allowedPipelineIds ?? undefined);
                if (!result) return `No pipeline found matching intent: "${intent}". Use list_pipelines to see available pipelines.`;
                return JSON.stringify({
                    pipelineId: result.pipelineId,
                    confidence: result.confidence,
                    inputHints: result.inputHints,
                    message: `Use show_pipeline_input_form with pipelineId: ${result.pipelineId} to gather required inputs.`,
                }, null, 2);
            } catch (e: any) {
                return `Error resolving intent: ${e.message}`;
            }
        }
    },
    list_pipelines: {
        name: "list_pipelines",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Pipelines",
        group: "Pipeline Orchestration",
        /*
          The UI calls these "workstreams" (sidebar, /operations/workstreams, the
          cycle explorer); only the tools and API say "pipeline". Without the synonym
          spelled out, "how many workstreams are running?" found no matching tool and
          the assistant escalated it to a research mission instead of just counting.
        */
        description:
            "List available pipelines, optionally filtering by name. A pipeline is the same thing the Oddjob UI calls a WORKSTREAM — " +
            "use this tool for any question about workstreams (how many exist, which are running, listing or finding one). " +
            "Combine with get_pipeline_status to report which are currently executing.",
        parameters: z.object({
            search: z.string().optional().describe("Search term for pipeline name"),
            limit: z.number().optional().default(10),
        }),
        execute: async ({ search, limit }: any, context: ToolContext) => {
            try {
                const orgContext: any = {
                    userId: context?.userId || "unknown",
                    organizationId: context?.organizationId || null,
                    isAdmin: !!context?.isAdmin,
                    isSuperAdmin: !!context?.isSuperAdmin,
                    isOrgAdmin: !!context?.isOrgAdmin
                };

                // Use pipelineService
                const options: any = {
                    limit,
                    pipelineIds: context?.allowedPipelineIds || context?.jobConfig?.pipelineIds
                };

                const { pipelineService } = await import("../../../pipeline/core/pipeline.service.js");
                const pipelines = await pipelineService.list(orgContext, options);

                // Filter by name/search if provided (pipelineService.list does not natively support fuzzy search yet)
                let results = pipelines;
                if (search) {
                    const searchLower = search.toLowerCase();
                    results = pipelines.filter(p => p.name.toLowerCase().includes(searchLower));
                }

                return JSON.stringify(results.map(p => ({
                    id: p.id,
                    name: p.name,
                    description: p.description,
                    isActive: p.isActive
                })), null, 2);
            } catch (e: any) {
                return `Error listing pipelines: ${e.message}`;
            }
        }
    },
    show_pipeline_input_form: {
        name: "show_pipeline_input_form",
        idempotency: "read-safe",
        label: "Show Pipeline Input Form",
        group: "Pipeline Orchestration",
        description: "RENDERS A UI FORM in the chat when a pipeline requires input (like VIN, ID, etc.). `pipelineId` must be a real pipeline id or an exact existing name — if you are not certain the name exists, call list_pipelines first rather than guessing, because an invented name fails. Use pre-cached form definitions if available by only providing pipelineId. If no manifest is found, provide fields manually.",
        parameters: z.object({
            pipelineId: z.union([z.number(), z.string()]).describe("ID or Name of the pipeline to run"),
            pipelineName: z.string().optional().describe("Human-readable name of the pipeline (used as fallback)"),
            fields: z.array(z.object({
                name: z.string().describe("Field name (e.g., 'vin', 'customerId')"),
                label: z.string().describe("Human-readable label for the field"),
                type: z.enum(['text', 'number', 'email', 'select', 'boolean', 'date', 'location']).default('text').describe("Field type"),
                required: z.boolean().default(true).describe("Whether field is required"),
                placeholder: z.string().optional().describe("Placeholder text"),
                description: z.string().optional().describe("Help text for the field"),
                pattern: z.string().optional().describe("Regex pattern for validation (e.g., '^[A-Z0-9]{10}$')"),
                patternMessage: z.string().optional().describe("Custom error message if pattern mismatch"),
                options: z.array(z.union([
                    z.string(),
                    z.number(),
                    z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })
                ])).optional().default([]).describe("Options for select fields (array of strings or {label, value} objects)")
            })).optional().default([]).describe("Array of input fields (optional if pre-cached in manifest)")
        }),
        execute: async ({ pipelineId: rawPipelineId, pipelineName, fields }: any, context: ToolContext) => {
            let finalFields = fields;
            let finalPipelineName = pipelineName;
            // Defaults to what the model sent; each resolution branch below narrows it.
            let pipelineId: number | string = rawPipelineId;

            // Fetch the deployment once up front — both the asset-triage key lookup
            // below and the numeric-pipelineId manifest lookup further down need it.
            let deployment: typeof agentDeployments.$inferSelect | undefined;
            if (context?.jobId) {
                try {
                    deployment = await db.query.agentDeployments.findFirst({
                        where: and(
                            eq(agentDeployments.jobId, context.jobId as number),
                            eq(agentDeployments.organizationId, (context.organizationId || 0) as number)
                        )
                    });
                } catch (err) {
                    console.error(`[Agent Tools] Failed to fetch deployment ${context.jobId}:`, err);
                }
            }

            // Resolve pipelineId if it's a string
            if (typeof rawPipelineId === 'string') {
                // A numeric string is an id, not a name.
                //
                // This is the failure the telemetry actually recorded: the model
                // passed "1" — the id it had just read from list_pipelines, or an
                // ordinal from a list it rendered — and every string went down the
                // name path, so the lookup asked for a pipeline literally NAMED "1",
                // failed, and the model retried another guess until the circuit
                // breaker opened. 47 of this tool's 52 recorded failures are that
                // error, and it is the single largest failure class in
                // agent_tool_usage.
                //
                // The parameter is typed z.union([z.number(), z.string()]), so a
                // numeric string is a shape the contract invites. Accepting it as an
                // id is not leniency, it is honouring the declared type. Org scoping
                // is the same as the name lookup below — an id from another tenant
                // must not resolve.
                let resolvedById = false;
                const asNumericId = /^\d+$/.test(rawPipelineId.trim())
                    ? Number(rawPipelineId.trim())
                    : null;
                if (asNumericId !== null && Number.isSafeInteger(asNumericId)) {
                    const { getOrgConditions } = await import("../../../pipeline/core/pipeline-engine.js");
                    const orgConditions = getOrgConditions({
                        userId: context?.userId || "unknown",
                        organizationId: context?.organizationId ?? null,
                        isAdmin: !!context?.isAdmin,
                        isSuperAdmin: !!context?.isSuperAdmin,
                        isOrgAdmin: !!context?.isOrgAdmin,
                    });
                    const [byId] = await db
                        .select({ id: pipelines.id, name: pipelines.name })
                        .from(pipelines)
                        .where(and(...orgConditions, eq(pipelines.id, asNumericId)))
                        .limit(1);
                    if (byId) {
                        pipelineId = byId.id;
                        finalPipelineName = finalPipelineName || byId.name;
                        resolvedById = true;
                    }
                    // No match falls through to the name path, so a pipeline genuinely
                    // named "1" still resolves and the existing recovery hint still fires.
                }

                if (resolvedById) {
                    // Already resolved by id above.
                } else if (rawPipelineId.startsWith('job_')) {
                    // It's a standalone form agent ID, keep as string
                    pipelineId = rawPipelineId as any;
                    finalPipelineName = finalPipelineName || `Form ${rawPipelineId}`;
                } else {
                    // Asset-triage forms (intent_selection, restock_request, escalation_contact,
                    // feedback, diagnostic_*) aren't real rows in the `pipelines` table — they only
                    // exist as keys in the deployment's blueprint-owned formManifest (or the
                    // hardcoded chatFormResolver fallback). Check those before the DB name lookup,
                    // which would otherwise 404 on every one of these and stall the agent loop.
                    const assetRecord = (context as any)?._assetRecord || (context as any)?.extra?._assetRecord;
                    const { formBlockService } = await import("../../../asset-service/form-block.service.js");
                    const resolved = formBlockService.resolveByKey(assetRecord, rawPipelineId, deployment?.formManifest as Record<string, any> | null);

                    if (resolved) {
                        pipelineId = `asset-triage:${rawPipelineId}`;
                        finalFields = finalFields?.length ? finalFields : resolved.fields;
                        finalPipelineName = finalPipelineName || resolved.pipelineName;
                    } else {
                        // Try to resolve as a real pipeline name.
                        //
                        // Scoped by organization: the lookup was previously by name
                        // alone, which reads another tenant's pipelines whenever two
                        // orgs happen to use the same name.
                        //
                        // Scoping goes through pipeline-engine's getOrgConditions —
                        // the same helper list_pipelines uses — rather than being
                        // rebuilt here. A hand-rolled `orgId != null ? eq(...) :
                        // undefined` reads as safe and is not: it drops the filter
                        // entirely when organizationId is null, which is a real
                        // occurring case (OrgContext.organizationId is `number |
                        // null`), and an absent WHERE returns EVERY organization's
                        // pipelines. The canonical rule is `organizationId IS NULL`
                        // — org-less pipelines only, never all of them.
                        //
                        // Matched case-insensitively, because the caller is a language
                        // model reproducing a name from context, not a user picking
                        // from a list.
                        const { getOrgConditions } = await import("../../../pipeline/core/pipeline-engine.js");
                        const orgConditions = getOrgConditions({
                            userId: context?.userId || "unknown",
                            organizationId: context?.organizationId ?? null,
                            isAdmin: !!context?.isAdmin,
                            isSuperAdmin: !!context?.isSuperAdmin,
                            isOrgAdmin: !!context?.isOrgAdmin,
                        });

                        const [pipeline] = await db
                            .select({ id: pipelines.id, name: pipelines.name })
                            .from(pipelines)
                            .where(and(...orgConditions, ilike(pipelines.name, rawPipelineId)))
                            .limit(1);

                        if (!pipeline) {
                            // Name the alternatives. This error accounted for ~89% of all
                            // recorded tool failures (agent_tool_usage), essentially all
                            // from this tool: the model invents a plausible pipeline name,
                            // gets a dead end that does not say what IS valid, and retries
                            // another invention until the circuit breaker opens. Listing
                            // the real names turns a dead end into a recoverable turn.
                            //
                            // Same org scoping as the lookup above, and it matters more
                            // here: these names go straight into the model's context and
                            // from there into the user's chat, so an unscoped query does
                            // not just read across tenants, it discloses across them.
                            const available = await db
                                .select({ name: pipelines.name })
                                .from(pipelines)
                                .where(and(...orgConditions))
                                .limit(40);

                            const names = available.map(p => p.name).filter(Boolean);
                            const hint = names.length
                                ? ` Available pipelines: ${names.join(", ")}. Call list_pipelines for full details, then retry with an exact name.`
                                : ` No pipelines are defined for this organization, so no pipeline form can be shown. Say so rather than retrying.`;

                            return `Error: Pipeline '${rawPipelineId}' not found.${hint}`;
                        }
                        pipelineId = pipeline.id;
                        finalPipelineName = finalPipelineName || pipeline.name;
                    }
                }
            } else {
                pipelineId = rawPipelineId;
            }

            // Attempt to retrieve from pre-cached manifest if jobId is available
            if (deployment && typeof pipelineId === 'number') {
                if (deployment.formManifest && (deployment.formManifest as any)[pipelineId.toString()]) {
                    const manifestEntry = (deployment.formManifest as any)[pipelineId.toString()];
                    finalFields = manifestEntry.fields;
                    finalPipelineName = manifestEntry.pipelineName || finalPipelineName || pipelineName;
                }
            }

            // A form with zero fields must NEVER be rendered — the UI would show an
            // empty "provide the required information" shell the user cannot fill in.
            // (An empty array passed as `fields` is truthy, so the old `!fields` guard
            // let `fields: []` through and emitted a broken empty form.)
            if (!finalFields || finalFields.length === 0) {
                // Block fallback: if this is an asset-triage conversation and we have the
                // scanned asset on context, serve the always-valid intent form from the
                // cached block registry instead of an empty form.
                const assetRecord = (context as any)?._assetRecord || (context as any)?.extra?._assetRecord;
                if (assetRecord && context?.organizationId) {
                    try {
                        const { formBlockService } = await import("../../../asset-service/form-block.service.js");
                        const resolved = await formBlockService.getIntentForm(context.organizationId, assetRecord);
                        if (resolved?.fields?.length) {
                            finalFields = resolved.fields as any;
                            finalPipelineName = resolved.pipelineName;
                        }
                    } catch { /* fall through to conversational instruction */ }
                }
                if (!finalFields || finalFields.length === 0) {
                    return `No input form is needed for pipeline ${pipelineId} — it has no defined input fields (it is a conversational flow). Do NOT render a form. Ask the user for the necessary details in plain conversation, then call trigger_pipeline directly with the values you collect.`;
                }
            }

            // Generate a session-scoped nonce to protect the pipelineId
            const sessionId = context?.userId || context?.sessionId || 'anonymous';
            const { agentNonceService } = await import("../../../agents/agent-nonce.service.js");
            // Thread the scanned asset's ID through the nonce (when present) so a later
            // [FORM_SUBMISSION] can recover it without the client resending it — needed for
            // the asset-triage chain-advance (intent_selection -> next form) in agent-deployments.ts.
            const assetRecordForNonce = (context as any)?._assetRecord || (context as any)?.extra?._assetRecord;
            const nonce = await agentNonceService.generate(sessionId, pipelineId, finalPipelineName, undefined, assetRecordForNonce?.assetId);

            // Return structured JSON with nonce instead of pipelineId
            return JSON.stringify({
                type: "input_request",
                nonce,
                pipelineName: finalPipelineName,
                fields: finalFields
            });
        }
    },
    trigger_pipeline: {
        name: "trigger_pipeline",
        idempotency: "none",
        riskLevel: "high",
        label: "Trigger Pipeline",
        group: "Pipeline Orchestration",
        description: "Trigger a new execution of a pipeline with optional input data. Returns an executionId. After triggering, poll 'get_pipeline_status' until completed. IMPORTANT: If inputs are required (VIN, etc.), prefer using 'show_pipeline_input_form' to get them from the user FIRST.",
        parameters: z.object({
            nonce: z.string().optional().describe("Secure nonce from show_pipeline_input_form (preferred)"),
            pipelineId: z.union([z.number(), z.string()]).optional().describe("ID or Name of the pipeline to trigger (use nonce instead for security)"),
            inputData: z.record(z.any()).optional().describe("Optional input data to pass to the pipeline (e.g., { vin: '12345' })"),
        }),
        execute: async ({ nonce, pipelineId: rawPipelineId, inputData }: any, context: ToolContext) => {
            try {
                const sessionId = context?.userId || context?.sessionId || 'anonymous';
                let pipelineId: number | string;

                // Resolve pipeline ID from nonce (preferred) or use direct ID (backward compat)
                let actualNonce = nonce;
                if (!actualNonce && typeof rawPipelineId === 'string' && rawPipelineId.startsWith('nonce-')) {
                    actualNonce = rawPipelineId;
                }

                if (actualNonce) {
                    const { agentNonceService } = await import("../../../agents/agent-nonce.service.js");
                    const resolved = await agentNonceService.resolve(sessionId, actualNonce);
                    if (!resolved) {
                        // Retryable, user-facing message (E): the input-form security token
                        // (nonce) expired (1h TTL) or was already used. Do NOT fail silently —
                        // tell the user why and give the concrete retry step for THIS flow
                        // (re-open the input form; note this is a form token, not an Approvals-tab
                        // approval token, so "re-approve from Approvals" would misdirect here).
                        return (
                            "This action's security token has expired or was already used, so I won't run the pipeline with it " +
                            "(that protects against stale or replayed actions). Please ask me to re-open the input form and submit it again to retry."
                        );
                    }
                    pipelineId = resolved as number;

                    // Automatically pull inputData from context if it exists and nonce matches
                    // This handles cases where the LLM might not have extracted form inputs perfectly
                    if (context?.pipelineExecution?.nonce === actualNonce && context.pipelineExecution.inputData) {
                        console.log(`[trigger_pipeline] Merging inputData from context for nonce ${actualNonce}`);
                        inputData = { ...(context.pipelineExecution.inputData || {}), ...(inputData || {}) };
                    }
                } else if (rawPipelineId) {
                    // Backward compatibility: allow direct pipelineId or Name
                    if (typeof rawPipelineId === 'string') {
                        const [pipeline] = await db.select({ id: pipelines.id }).from(pipelines).where(eq(pipelines.name, rawPipelineId)).limit(1);
                        if (!pipeline) {
                            return `Error: Pipeline with name '${rawPipelineId}' not found.`;
                        }
                        pipelineId = pipeline.id;
                    } else {
                        pipelineId = rawPipelineId;
                    }
                } else {
                    return `Error: Either 'nonce' or 'pipelineId' must be provided.`;
                }

                // If it's a standalone form agent (job_123) or a deterministic triage form (asset-triage), return the data directly
                if (typeof pipelineId === 'string' && (pipelineId.startsWith('job_') || pipelineId.startsWith('asset-triage:'))) {
                    return `Form submitted successfully for ${pipelineId}.\nSubmitted Data:\n${JSON.stringify(inputData, null, 2)}`;
                }

                // Validate access
                const allowedPipelineIds = context?.jobConfig?.pipelineIds || context?.allowedPipelineIds;
                if (allowedPipelineIds && allowedPipelineIds.length > 0) {
                    if (typeof pipelineId === 'number' && !allowedPipelineIds.includes(pipelineId)) {
                        return `Access Denied: Agent is not authorized to trigger this pipeline.`;
                    }
                }

                // ============================================================
                // INPUT PARAMETER VALIDATION
                // ============================================================
                const { InputValidationService } = await import("../../../../domain/core/input-validation.service.js");
                const params = await InputValidationService.getParamsForPipeline(pipelineId as number);

                if (params && params.length > 0) {
                    // Use the comprehensive validateInputs method
                    const validationResult = await InputValidationService.validateInputs(pipelineId as number, inputData || {});

                    if (!validationResult.isValid) {
                        const errorsByType = {
                            required: [] as string[],
                            other: [] as string[]
                        };

                        for (const err of validationResult.errors) {
                            const param = params.find(p => p.name === err.field);
                            const desc = param?.description || param?.label || 'No description';
                            const dataType = param?.dataType || 'string';

                            if (err.constraint === 'required') {
                                errorsByType.required.push(`- **${err.field}** (${dataType}): ${desc}`);
                            } else {
                                errorsByType.other.push(`- **${err.field}**: ${err.message}`);
                            }
                        }

                        let message = `**Cannot execute pipeline - input validation failed:**\n\n`;

                        if (errorsByType.required.length > 0) {
                            message += `**Missing Required Parameters:**\n${errorsByType.required.join('\n')}\n\n`;
                        }

                        if (errorsByType.other.length > 0) {
                            message += `**Validation Errors:**\n${errorsByType.other.join('\n')}\n\n`;
                        }

                        message += `Please provide the required input data. Example:\n`;
                        message += `\`\`\`json\n{\n`;
                        message += params.filter(p => p.isRequired).map(p => `  "${p.name}": ${p.dataType === 'string' ? '"<value>"' : '<value>'}`).join(',\n');
                        message += `\n}\n\`\`\`\n`;
                        message += `\n**CRITICAL**: Use the 'show_pipeline_input_form' tool with pipelineId: ${pipelineId} to gather these missing values from the user via a UI form. DO NOT collect them manually.`;

                        return message;
                    }
                }


                const { pipelineExecutor } = await import("../../../../core/pipeline-executor.js");
                const userId = context?.userId || "system-agent";
                // ARGS: pipelineId, userId, startStepId, ttl, initialVariables
                const res = await pipelineExecutor.executePipeline(pipelineId as number, userId, null, null, inputData || undefined);

                if (res.success && res.executionId) {
                    // Start monitoring if running in agent context
                    const jobId = context?.jobId || context?.jobConfig?.id || context?.screenContext?.jobId;
                    const userId = context?.userId || context?.screenContext?.sessionId || context?.screenContext?.userId;

                    console.log(`[DEBUG] Trigger Pipeline: ExecutionId=${res.executionId}, JobId=${jobId}, UserId=${userId}`);

                    if (jobId && userId) {
                        const { PipelineMonitor } = await import("../../../pipeline/core/pipeline-monitor.js");
                        PipelineMonitor.startMonitoring(res.executionId, jobId, userId);
                    } else {
                        console.warn(`[PipelineMonitor] Failed to start: Missing context. JobId=${jobId}, UserId=${userId}`);
                    }
                    return `Pipeline execution triggered successfully.\nExecution ID: ${res.executionId}\nStatus: running\nI am monitoring the execution and will notify you of updates.`;
                } else {
                    return `Failed to trigger pipeline: ${res.error}`;
                }
            } catch (e: any) {
                return `Error triggering pipeline: ${e.message}`;
            }
        }
    },
    get_pipeline_status: {
        name: "get_pipeline_status",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Pipeline Status",
        group: "Pipeline Orchestration",
        description: "Check the status and results of a specific pipeline execution. Use this to poll for completion after triggering a pipeline.",
        parameters: z.object({
            executionId: z.number().describe("The ID of the pipeline execution to check"),
        }),
        execute: async ({ executionId }: any, context: ToolContext) => {
            try {
                const orgContext: any = {
                    userId: context?.userId || "unknown",
                    organizationId: context?.organizationId || null,
                    isAdmin: !!context?.isAdmin,
                    isSuperAdmin: !!context?.isSuperAdmin,
                    isOrgAdmin: !!context?.isOrgAdmin
                };

                const { pipelineService } = await import("../../../pipeline/core/pipeline.service.js");
                const { execution, stepExecutions: stepExecs } = await pipelineService.getExecutionDetails(executionId, orgContext);

                const result = {
                    status: execution.status,
                    error: execution.error,
                    completedAt: execution.completedAt,
                    stepsCount: stepExecs.length,
                    completedSteps: stepExecs.filter((s: any) => s.status === 'success' || s.status === 'failed').length,
                };

                if (execution.status === 'completed') {
                    // Try to find the last step's output
                    const lastStep = [...stepExecs].sort((a: any, b: any) => b.stepOrder - a.stepOrder)[0];
                    return `Pipeline Execution ${executionId} COMPLETED successfully.\nFinal Result: ${lastStep?.output || "No output data"}\nSummary: ${JSON.stringify(result, null, 2)}`;
                } else if (execution.status === 'failed') {
                    return `Pipeline Execution ${executionId} FAILED.\nError: ${execution.error}\nSummary: ${JSON.stringify(result, null, 2)}`;
                } else {
                    return `Pipeline Execution ${executionId} is currently ${execution.status.toUpperCase()}.\nProgress: ${result.completedSteps}/${result.stepsCount} steps finished.\nPlease wait and poll again in a few seconds if not yet completed.`;
                }
            } catch (e: any) {
                return `Error fetching pipeline status: ${e.message}`;
            }
        }
    },
    get_pipeline_details: {
        name: "get_pipeline_details",
        idempotency: "read-safe",
        label: "Get Pipeline Details",
        group: "Pipeline Orchestration",
        description: "Get detailed information about a specific pipeline.",
        parameters: z.object({
            pipelineId: z.number().optional(),
            pipelineName: z.string().optional(),
            includeExecutionHistory: z.boolean().optional().default(true),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleGetPipelineDetails } = await import("../../../../mcp/handlers.js");

            // Validate access
            const allowedPipelineIds = context?.jobConfig?.pipelineIds || context?.allowedPipelineIds;
            if (allowedPipelineIds && allowedPipelineIds.length > 0) {
                const targetId = params.pipelineId;
                if (targetId && !allowedPipelineIds.includes(targetId)) {
                    return `Access Denied: Agent is not authorized to access Pipeline ID ${targetId}.`;
                }
                // If only name provided, we'd need to resolve it first. 
                // handleGetPipelineDetails handles both. For simplicity, we trust the name-based lookup
                // but ideally we'd resolve ID and check.
            }

            // The MCP handlers resolve a missing or null org to ODDJOB_ORG_ID || 1.
            requireToolOrgId(context);
            const result = await handleGetPipelineDetails(params, context);
            // The input schema below is looked up by id alone, so only add it for a
            // pipeline the scoped handler actually found in this organization.
            if ((result as any).isError) return extractMcpText(result);

            // Add input schema if found
            const pipelineId = params.pipelineId; // Ideally resolved by handleGetPipelineDetails
            if (pipelineId) {
                const { InputValidationService } = await import("../../../core/input-validation.service.js");
                const inputPrompt = await InputValidationService.generateAgentPrompt(pipelineId);
                if (inputPrompt) {
                    return `${extractMcpText(result)}\n\n${inputPrompt}`;
                }
            }

            return extractMcpText(result);
        }
    },
    run_pipeline: {
        name: "run_pipeline",
        idempotency: "none",
        label: "Run Pipeline",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Trigger execution of a pipeline. Requires admin permissions. Returns executionId. You should poll get_pipeline_status for final results.",
        parameters: z.object({
            pipelineId: z.number().optional(),
            pipelineName: z.string().optional(),
            inputData: z.record(z.any()).optional(),
            dryRun: z.boolean().optional().default(false),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to run pipelines.";
            }

            // Validate access
            const allowedPipelineIds = context?.jobConfig?.pipelineIds || context?.allowedPipelineIds;
            if (allowedPipelineIds && allowedPipelineIds.length > 0) {
                const targetId = params.pipelineId;
                if (targetId && !allowedPipelineIds.includes(targetId)) {
                    return `Access Denied: Agent is not authorized to run Pipeline ID ${targetId}.`;
                }
            }

            const orgId = requireToolOrgId(context);
            const { handleRunPipeline } = await import("../../../../mcp/handlers.js");

            // Resolve the target inside the caller's organization before validating:
            // validation errors name the pipeline's input fields.
            let targetId: number | undefined;
            if (params.pipelineId || params.pipelineName) {
                const [pipeline] = await db.select({ id: pipelines.id }).from(pipelines).where(and(
                    params.pipelineId ? eq(pipelines.id, params.pipelineId) : eq(pipelines.name, params.pipelineName),
                    eq(pipelines.organizationId, orgId),
                )).limit(1);
                if (!pipeline && params.pipelineId) return `Error: Pipeline ${params.pipelineId} not found in this organization.`;
                // A name with no exact match falls through to the handler's (scoped) partial match.
                targetId = pipeline?.id;
            }

            if (targetId) {
                const { InputValidationService } = await import("../../../../domain/core/input-validation.service.js");
                const validation = await InputValidationService.validateInputs(targetId, params.inputData || {});
                if (!validation.isValid) {
                    const errorMsg = validation.errors.map((e: any) => `- ${e.field}: ${e.message}`).join("\n");
                    return `Validation Failed for Pipeline ID ${targetId}:\n${errorMsg}\n\nPlease correct these inputs before running.`;
                }
            }

            const result = await handleRunPipeline(params, context);
            return `${extractMcpText(result)}\n\nNOTE: You can track this execution using 'get_pipeline_status' if an executionId was provided above.`;
        }
    },
    propose_pipeline_run: {
        name: "propose_pipeline_run",
        idempotency: "none",
        label: "Propose Pipeline Run",
        group: "Pipeline Orchestration",
        description:
            "Ask a human to approve running one of this organization's pipelines with the given inputs. Nothing runs " +
            "until an org admin approves the card; approving starts the run. Find the pipeline with list_pipelines, and " +
            "read the result afterwards with list_recent_executions.",
        parameters: z.object({
            pipelineId: z.number().optional().describe("The pipeline's id (preferred)"),
            pipelineName: z.string().optional().describe("The pipeline's exact name, when the id is unknown"),
            inputData: z.record(z.any()).optional().describe("Inputs for the run, keyed by the pipeline's input field names"),
            reason: z.string().describe("Why this run is needed now"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const orgId = requireToolOrgId(context);
            const { pipelineRunProposals, PipelineRunProposalError } = await import("../../../pipeline/core/pipeline-run-proposals.js");
            try {
                const { approvalId, request } = await pipelineRunProposals.propose(
                    { ...params, sessionKey: (context as any).sessionKey ?? null },
                    { organizationId: orgId, userId: context.userId ?? null, email: null, isOrgAdmin: Boolean(context.isOrgAdmin || context.isSuperAdmin) },
                );
                return JSON.stringify({
                    type: "approval_request",
                    kind: "pipeline_run",
                    proposalId: approvalId,
                    title: `Run pipeline: ${request.pipelineName}`,
                    pipelineId: request.pipelineId,
                    pipelineName: request.pipelineName,
                    inputData: request.inputData,
                    reason: request.reason,
                    sessionKey: request.sessionKey,
                    organizationId: orgId,
                    status: "pending",
                    message: `Approval requested to run "${request.pipelineName}". Nothing runs until an org admin approves it.`,
                });
            } catch (err: any) {
                // An "Error ...:" string is classified ok:false by crew-tools, so a refused
                // proposal is never read as a run that was requested.
                if (err instanceof PipelineRunProposalError) return `Error proposing pipeline run: ${err.message}`;
                throw err;
            }
        }
    },
    list_recent_executions: {
        name: "list_recent_executions",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Recent Executions",
        group: "Pipeline Orchestration",
        description:
            "List recent pipeline executions, optionally filtered by status. A pipeline execution is a run of what the " +
            "Oddjob UI calls a WORKSTREAM — use this with status='RUNNING' to answer \"how many workstreams are running?\" " +
            "or to report what is currently executing. Prefer this over guessing or proposing research.",
        parameters: z.object({
            limit: z.number().optional().default(10),
            status: z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED", "CANCELLED"]).optional(),
            pipelineId: z.number().optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            requireToolOrgId(context);
            const { handleListRecentExecutions } = await import("../../../../mcp/handlers.js");
            const result = await handleListRecentExecutions(params, context);
            return extractMcpText(result);
        }
    },
    /**
     * Renamed from `delegate_task`, which collided with the sub-agent tool in
     * DELEGATION_TOOLS. Both were registered into the same flat namespace by
     * capabilities/index.ts, and DELEGATION_TOOLS is spread second — so this
     * definition lost every time and was unreachable. Nothing depended on the
     * pipeline behaviour, because nothing could ever have received it.
     */
    delegate_to_pipeline: {
        name: "delegate_to_pipeline",
        idempotency: "none",
        label: "Delegate to Pipeline",
        group: "Pipeline Orchestration",
        description: "Delegate a sub-task to a specific pipeline. This creates a child execution linked to the current execution. Returns an executionId.",
        parameters: z.object({
            pipelineId: z.number().optional(),
            pipelineName: z.string().optional(),
            inputData: z.record(z.any()).optional(),
            reason: z.string().describe("Reason for delegation"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const userId = context?.userId || "system-agent";
            const parentExecutionId = (context as any)?.executionId;

            if (!parentExecutionId) {
                return "Error: Cannot delegate without a parent execution context. Use run_pipeline instead if this is a top-level request.";
            }

            let pipelineId = params.pipelineId;
            const { supervisorService } = await import("../../../integrations/core/supervisor.service.js");
            if (!pipelineId && params.pipelineName) {
                const pipeline = await supervisorService.findPipelineForAgent(params.pipelineName, context?.organizationId || undefined);
                if (pipeline) pipelineId = pipeline.id;
            }

            if (!pipelineId) {
                return "Error: Pipeline not found.";
            }

            try {
                const res = await supervisorService.delegate(pipelineId, params.inputData || {}, parentExecutionId, userId);
                if (res.success) {
                    return `Delegated successfully. Child Execution ID: ${res.executionId}.`;
                } else {
                    return `Delegation failed: ${res.error}`;
                }
            } catch (e: any) {
                return `Error delegating task: ${e.message}`;
            }
        }
    },

    // --- Pipeline CRUD Tools (Admin only) ---
    create_pipeline: {
        name: "create_pipeline",
        idempotency: "none",
        label: "Create Pipeline",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Create a new automation pipeline. Requires admin permissions. Can include steps with jobs, decisions, and iterators.",
        parameters: z.object({
            name: z.string().describe("Unique name for the pipeline"),
            description: z.string().optional(),
            triggerType: z.enum(["Manual", "Schedule", "Webhook", "API"]).optional(),
            isActive: z.boolean().optional(),
            steps: z.array(z.object({
                jobId: z.number().optional().describe("Job ID for job steps"),
                moduleType: z.enum(["job", "decision", "iterator", "start", "end"]).optional(),
                order: z.number().int().min(1).optional().describe("Step execution order (1, 2, 3...) - Optional, will be auto-assigned if omitted"),
                outputName: z.string().optional(),
                runOnCondition: z.string().optional(),
                onFailureAction: z.enum(["stop", "continue", "retry"]).optional(),
                decisionNodeConfig: z.record(z.any()).optional(),
            })).optional().default([]).describe("Pipeline steps in execution order"),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to create pipelines.";
            }

            // Auto-assign order if missing
            if (params.steps) {
                params.steps = params.steps.map((step: any, index: number) => ({
                    ...step,
                    order: step.order || (index + 1)
                }));
            }

            const { handleCreatePipeline } = await import("../../../../mcp/handlers.js");
            const result = await handleCreatePipeline(params, context);
            return extractMcpText(result);
        }
    },
    update_pipeline: {
        name: "update_pipeline",
        idempotency: "idempotent",
        label: "Update Pipeline",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Update an existing pipeline. Requires admin permissions.",
        parameters: z.object({
            pipelineId: z.number().describe("ID of the pipeline to update"),
            name: z.string().optional(),
            description: z.string().optional(),
            isActive: z.boolean().optional(),
            triggerType: z.enum(["Manual", "Schedule", "Webhook", "API"]).optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to update pipelines.";
            }
            const { handleUpdatePipeline } = await import("../../../../mcp/handlers.js");
            const result = await handleUpdatePipeline(params, context);
            return extractMcpText(result);
        }
    },
    delete_pipeline: {
        name: "delete_pipeline",
        idempotency: "idempotent",
        riskLevel: "high",
        label: "Delete Pipeline",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Delete a pipeline. Requires admin permissions. IMPORTANT: You MUST ask user to confirm before executing this delete.",
        parameters: z.object({
            pipelineId: z.number().describe("ID of the pipeline to delete"),
            userConfirmed: z.boolean().describe("Set to true ONLY after user explicitly confirms deletion"),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!params.userConfirmed) {
                return "CONFIRMATION REQUIRED: Please ask the user to confirm they want to delete this pipeline before proceeding.";
            }
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to delete pipelines.";
            }
            const { handleDeletePipeline } = await import("../../../../mcp/handlers.js");
            const result = await handleDeletePipeline(params, context);
            return extractMcpText(result);
        }
    },

    // --- Pipeline Step Management (Admin only) ---
    add_pipeline_step: {
        name: "add_pipeline_step",
        idempotency: "none",
        label: "Add Pipeline Step",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Add a step to an existing pipeline. Step can be a job, decision node, or iterator. Requires admin permissions.",
        parameters: z.object({
            pipelineId: z.number().describe("Pipeline to add step to"),
            jobId: z.number().optional().describe("Job ID for job steps"),
            moduleType: z.enum(["job", "decision", "iterator", "start", "end"]).optional().describe("Step type (default: job)"),
            order: z.number().describe("Execution order (1, 2, 3...)"),
            outputName: z.string().optional().describe("Name for output variable"),
            runOnCondition: z.string().optional().describe("Condition expression"),
            onFailureAction: z.enum(["stop", "continue", "retry"]).optional(),
            waitDurationSeconds: z.number().optional(),
            decisionNodeConfig: z.record(z.any()).optional().describe("For decision: {condition, trueStepId, falseStepId}"),
            iteratorConfig: z.record(z.any()).optional().describe("For iterator: {inputArray, targetJobId, itemVarName}"),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to add pipeline steps.";
            }
            const { handleAddPipelineStep } = await import("../../../../mcp/handlers.js");
            const result = await handleAddPipelineStep(params, context);
            return extractMcpText(result);
        }
    },
    update_pipeline_step: {
        name: "update_pipeline_step",
        idempotency: "idempotent",
        label: "Update Pipeline Step",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Update a pipeline step. Requires admin permissions.",
        parameters: z.object({
            stepId: z.number().describe("ID of the step to update"),
            jobId: z.number().optional(),
            order: z.number().optional(),
            outputName: z.string().optional(),
            runOnCondition: z.string().optional(),
            onFailureAction: z.enum(["stop", "continue", "retry"]).optional(),
            waitDurationSeconds: z.number().optional(),
            decisionNodeConfig: z.record(z.any()).optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to update pipeline steps.";
            }
            const { handleUpdatePipelineStep } = await import("../../../../mcp/handlers.js");
            const result = await handleUpdatePipelineStep(params, context);
            return extractMcpText(result);
        }
    },
    delete_pipeline_step: {
        name: "delete_pipeline_step",
        idempotency: "idempotent",
        label: "Delete Pipeline Step",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Remove a step from a pipeline. Requires admin permissions. IMPORTANT: You MUST ask user to confirm before executing this delete.",
        parameters: z.object({
            stepId: z.number().describe("ID of the step to delete"),
            userConfirmed: z.boolean().describe("Set to true ONLY after user explicitly confirms deletion"),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!params.userConfirmed) {
                return "CONFIRMATION REQUIRED: Please ask the user to confirm they want to delete this pipeline step before proceeding.";
            }
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to delete pipeline steps.";
            }
            const { handleDeletePipelineStep } = await import("../../../../mcp/handlers.js");
            const result = await handleDeletePipelineStep(params, context);
            return extractMcpText(result);
        }
    },

    // --- Schedule Tools ---
    list_schedules: {
        name: "list_schedules",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Schedules",
        group: "Pipeline Orchestration",
        description: "List all schedule patterns in the organization. Schedules define WHEN jobs/pipelines run (hourly, daily, weekly, cron).",
        parameters: z.object({
            activeOnly: z.boolean().optional().describe("Only show active schedules"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleListSchedules } = await import("../../../../mcp/handlers.js");
            const result = await handleListSchedules(params, context);
            return extractMcpText(result);
        }
    },
    get_schedule_details: {
        name: "get_schedule_details",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Schedule Details",
        group: "Pipeline Orchestration",
        description: "Get details of a specific schedule including its pattern configuration.",
        parameters: z.object({
            scheduleId: z.number().optional(),
            scheduleName: z.string().optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleGetScheduleDetails } = await import("../../../../mcp/handlers.js");
            const result = await handleGetScheduleDetails(params, context);
            return extractMcpText(result);
        }
    },
    create_schedule: {
        name: "create_schedule",
        idempotency: "none",
        label: "Create Schedule",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Create a new schedule pattern. Requires admin. Patterns: 1=hourly, 2=daily, 3=weekly, 4=cron. Use patternString for timing config.",
        parameters: z.object({
            name: z.string().describe("Unique schedule name"),
            description: z.string().optional(),
            pattern: z.number().min(1).max(4).describe("1=hourly, 2=daily, 3=weekly, 4=cron"),
            patternString: z.record(z.any()).optional().describe("{hour, minute, days, cron}"),
            patternLabel: z.string().optional().describe("Human-readable label"),
            timezone: z.string().optional().describe("e.g., America/New_York"),
            isActive: z.boolean().optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to create schedules.";
            }
            const { handleCreateSchedule } = await import("../../../../mcp/handlers.js");
            const result = await handleCreateSchedule(params, context);
            return extractMcpText(result);
        }
    },
    update_schedule: {
        name: "update_schedule",
        idempotency: "idempotent",
        label: "Update Schedule",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Update a schedule pattern. Requires admin permissions.",
        parameters: z.object({
            scheduleId: z.number().describe("Schedule ID to update"),
            name: z.string().optional(),
            description: z.string().optional(),
            pattern: z.number().min(1).max(4).optional(),
            patternString: z.record(z.any()).optional(),
            patternLabel: z.string().optional(),
            timezone: z.string().optional(),
            isActive: z.boolean().optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to update schedules.";
            }
            const { handleUpdateSchedule } = await import("../../../../mcp/handlers.js");
            const result = await handleUpdateSchedule(params, context);
            return extractMcpText(result);
        }
    },
    delete_schedule: {
        name: "delete_schedule",
        idempotency: "idempotent",
        label: "Delete Schedule",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Delete a schedule. Requires admin. IMPORTANT: You MUST ask user to confirm before executing this delete.",
        parameters: z.object({
            scheduleId: z.number().describe("Schedule ID to delete"),
            userConfirmed: z.boolean().describe("Set to true ONLY after user explicitly confirms deletion"),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!params.userConfirmed) {
                return "CONFIRMATION REQUIRED: Please ask the user to confirm they want to delete this schedule before proceeding.";
            }
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to delete schedules.";
            }
            const { handleDeleteSchedule } = await import("../../../../mcp/handlers.js");
            const result = await handleDeleteSchedule(params, context);
            return extractMcpText(result);
        }
    },
    list_scheduled_jobs: {
        name: "list_scheduled_jobs",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "List Scheduled Jobs",
        group: "Pipeline Orchestration",
        description: "List all scheduled jobs/pipelines. Shows which jobs or pipelines are scheduled and their trigger type.",
        parameters: z.object({
            activeOnly: z.boolean().optional(),
            triggerType: z.enum(["Schedule", "Manual", "Webhook", "API"]).optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleListScheduledJobs } = await import("../../../../mcp/handlers.js");
            const result = await handleListScheduledJobs(params, context);
            return extractMcpText(result);
        }
    },
    get_scheduled_job_details: {
        name: "get_scheduled_job_details",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        label: "Get Scheduled Job Details",
        group: "Pipeline Orchestration",
        description: "Get detailed configuration of a scheduled job including schedule, alerts, and retry settings.",
        parameters: z.object({
            scheduledJobId: z.number().optional(),
            scheduledJobName: z.string().optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleGetScheduledJobDetails } = await import("../../../../mcp/handlers.js");
            const result = await handleGetScheduledJobDetails(params, context);
            return extractMcpText(result);
        }
    },
    get_upcoming_scheduled_runs: {
        name: "get_upcoming_scheduled_runs",
        idempotency: "read-safe",
        label: "Get Upcoming Runs",
        group: "Pipeline Orchestration",
        description: "Get a list of upcoming scheduled executions. Calculates next run times for all active scheduled jobs/pipelines.",
        parameters: z.object({
            limit: z.number().optional().default(10).describe("Number of runs to return (default: 10)"),
        }),
        execute: async (params: any, context: ToolContext) => {
            const { handleGetUpcomingScheduledRuns } = await import("../../../../mcp/handlers.js");
            const result = await handleGetUpcomingScheduledRuns(params, context);
            return extractMcpText(result);
        }
    },
    create_scheduled_job: {
        name: "create_scheduled_job",
        idempotency: "none",
        label: "Create Scheduled Job",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Schedule a job or pipeline to run automatically. Requires admin. Provide jobId OR pipelineId, plus scheduleId for scheduling.",
        parameters: z.object({
            name: z.string().describe("Name for this scheduled job"),
            jobId: z.number().optional().describe("Job ID to schedule (use this OR pipelineId)"),
            pipelineId: z.number().optional().describe("Pipeline ID to schedule (use this OR jobId)"),
            scheduleId: z.number().optional().describe("Schedule pattern to use"),
            triggerType: z.enum(["Schedule", "Manual", "Webhook", "API"]).optional(),
            priority: z.number().min(1).max(3).optional().describe("1=high, 2=medium, 3=low"),
            isActive: z.boolean().optional(),
            alertOnFailure: z.boolean().optional(),
            maxRetries: z.number().min(0).max(10).optional(),
            parameterValues: z.record(z.any()).optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to create scheduled jobs.";
            }
            const { handleCreateScheduledJob } = await import("../../../../mcp/handlers.js");
            const result = await handleCreateScheduledJob(params, context);
            return extractMcpText(result);
        }
    },
    update_scheduled_job: {
        name: "update_scheduled_job",
        idempotency: "idempotent",
        label: "Update Scheduled Job",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Update a scheduled job configuration. Requires admin permissions.",
        parameters: z.object({
            scheduledJobId: z.number().describe("Scheduled job ID to update"),
            name: z.string().optional(),
            scheduleId: z.number().optional(),
            triggerType: z.enum(["Schedule", "Manual", "Webhook", "API"]).optional(),
            priority: z.number().min(1).max(3).optional(),
            isActive: z.boolean().optional(),
            alertOnFailure: z.boolean().optional(),
            maxRetries: z.number().min(0).max(10).optional(),
            parameterValues: z.record(z.any()).optional(),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to update scheduled jobs.";
            }
            const { handleUpdateScheduledJob } = await import("../../../../mcp/handlers.js");
            const result = await handleUpdateScheduledJob(params, context);
            return extractMcpText(result);
        }
    },
    delete_scheduled_job: {
        name: "delete_scheduled_job",
        idempotency: "idempotent",
        label: "Delete Scheduled Job",
        group: "Pipeline Orchestration",
        adminOnly: true,
        description: "Delete a scheduled job. Requires admin. IMPORTANT: You MUST ask user to confirm before executing this delete.",
        parameters: z.object({
            scheduledJobId: z.number().describe("Scheduled job ID to delete"),
            userConfirmed: z.boolean().describe("Set to true ONLY after user explicitly confirms deletion"),
        }),
        execute: async (params: any, context: ToolContext) => {
            if (!params.userConfirmed) {
                return "CONFIRMATION REQUIRED: Please ask the user to confirm they want to delete this scheduled job before proceeding.";
            }
            if (!context?.isAdmin && !context?.isOrgAdmin && !context?.isSuperAdmin) {
                return "Error: Admin permissions required to delete scheduled jobs.";
            }
            const { handleDeleteScheduledJob } = await import("../../../../mcp/handlers.js");
            const result = await handleDeleteScheduledJob(params, context);
            return extractMcpText(result);
        }
    },
};


