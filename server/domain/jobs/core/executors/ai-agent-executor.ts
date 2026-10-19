import { Job, Pipeline, AIAgentConfig, orgSettings, AIApiCallConfig, AIProviderMetadata, type AgentPersona, jobs, missions, appDeployments, agentDeployments } from "@shared/schema/index.js";
import { type VariableContext } from "@server/core/variable-resolver.js";
import { type StepExecutionResult } from "@server/core/pipeline-step-runner.js";
import { type JobExecutor } from "./index.js";
import { AgentPersonaService } from "@domain/agents/agent-persona.service.js";
import { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { credentialsService } from "@domain/auth/core/credentials-service.js";
import { AIClientFactory, normalizeGeminiModel } from "@domain/ai/core/ai-client.service.js";
import { db } from "@server/database_service.js";
import { eq, and, inArray } from "drizzle-orm";
import { CredentialNotFoundError, ConfigurationError } from "@server/utils/errors.js";
import { saveJobOutput } from "./executor-utils.js";
import { transactionLogService } from "@domain/audit/core/transaction-log.js";
import { missionService } from "@domain/mission/core/mission.service.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { topicService } from "@domain/knowledge/core/topic-service.js";
import { datasetService } from "@domain/knowledge/core/dataset-service.js";
import { getSystemOrgContext } from "@server/utils/auth-context.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

export class AiAgentExecutor implements JobExecutor {
    canExecute(jobType: string): boolean {
        return jobType === "ai_agent" || jobType === "data_processing" || jobType === "analyst";
    }

    async execute(
        job: Job,
        resolvedConfig: any,
        pipeline: Pipeline,
        context: VariableContext & { data?: Record<string, any>; traceContext?: TraceContext; executionId?: number }
    ): Promise<StepExecutionResult> {
        const config = resolvedConfig as any;

        // Reactive Intelligence: Test Bypass
        if (config.test) {
            return {
                success: true,
                output: `Test execution successful for job: ${job.name}. Config: ${JSON.stringify(config)}`,
                status: "success"
            };
        }

        // Credential resolution with system fallback

        let apiKey: string | undefined;
        let metadata: AIProviderMetadata;

        const credentialId = config.credentialId;
        let credential = null;

        // Key priority: the org's own default AI connection, then the job's pinned
        // credential (looked up within the job's org, as before), then the
        // platform configuration. An org key is optional.
        const { orgModelService } = await import("@domain/ai/core/org-model.service.js");
        const orgOwn = job.organizationId != null ? await orgModelService.resolve(job.organizationId) : null;

        if (!orgOwn && credentialId) {
            // Within the job's org, then platform (org-less) credentials — never
            // another tenant's. The third argument is isSuperAdmin: passing true
            // (as this once did) dropped the org filter and let a job pin any
            // org's credential.
            credential = await credentialsService.getById(credentialId, job.organizationId ?? null, false)
                .catch(() => job.organizationId != null ? credentialsService.getById(credentialId, null, false) : null)
                .catch(() => null);
            if (!credential) {
                throw new CredentialNotFoundError(`Credential ${credentialId} not found`);
            }
        }

        config.organizationId = job.organizationId;
        if (orgOwn) {
            apiKey = orgOwn.apiKey;
            metadata = { provider: orgOwn.provider, model: orgOwn.model } as AIProviderMetadata;
        } else if (credential) {
            apiKey = (await resolveCredentialSecret(credential));
            metadata = (credential.metadata || {}) as AIProviderMetadata;

            // Auto-infer provider if missing (for generic api_key credentials)
            if (!metadata.provider) {
                const envVar = credential.envVarName.toUpperCase();
                if (envVar.includes("GEMINI") || envVar.includes("GOOGLE")) {
                    (metadata as any).provider = "google";
                } else if (envVar.includes("OLLAMA")) {
                    (metadata as any).provider = "ollama";
                } else if (envVar.includes("OPENAI")) {
                    (metadata as any).provider = "openai";
                } else if (envVar.includes("ANTHROPIC") || envVar.includes("CLAUDE")) {
                    (metadata as any).provider = "anthropic";
                } else if (envVar.includes("MIDJOURNEY")) {
                    (metadata as any).provider = "midjourney";
                }
            }

            // Ollama uses a base URL, not a key — default to localhost if not set.
            // Applies whether the provider was auto-inferred above or already set on the credential.
            if ((metadata as any).provider === "ollama") {
                if (!(metadata as any).baseUrl) {
                    (metadata as any).baseUrl = apiKey || "http://localhost:11434";
                }
                apiKey = ""; // Ollama needs no API key
            }
        } else {
            // Fallback to system AI config (same as supervisor uses)
            const aiConfig = await systemAiService.getAiConfig('copilot', job.organizationId ?? undefined);
            if (!aiConfig || !aiConfig.apiKey) {
                throw new ConfigurationError("No credential found and no system AI provider configured.");
            }
            apiKey = aiConfig.apiKey;
            metadata = { provider: aiConfig.provider, model: aiConfig.model, baseUrl: aiConfig.baseUrl } as any;
        }

        // Gemini-first resilience: a pinned credential whose API key isn't configured for
        // this org (blueprint-seeded jobs routinely pin an OpenAI/Anthropic credential on
        // AI_API_KEY with no key set) should fall back to the org's default AI provider
        // rather than killing the whole pipeline at the first ai_agent step. Ollama
        // legitimately runs with an empty key, so only fall back when there's no provider.
        if (!apiKey && (metadata as any)?.provider !== "ollama") {
            const aiConfig = await systemAiService.getAiConfig('copilot', job.organizationId ?? undefined);
            if (!aiConfig?.apiKey) {
                throw new ConfigurationError("API Key not found");
            }
            console.warn(
                `[AiAgentExecutor] Pinned credential ${config.credentialId} (${credential?.envVarName ?? "none"}) has no API key for org ${job.organizationId}; ` +
                `falling back to default provider ${aiConfig.provider}/${aiConfig.model} (Gemini-first policy).`
            );
            apiKey = aiConfig.apiKey;
            metadata = { provider: aiConfig.provider, model: aiConfig.model, baseUrl: aiConfig.baseUrl } as any;
        }

        const client = AIClientFactory.getClient(metadata!);

        // Fetch Org Settings for Tool Governance
        const [settings] = await db
            .select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, job.organizationId!))
            .limit(1);

        let finalAllowedTools = config.allowedTools || [];

        // --- Mission & App Settings Resolution ---
        let resolvedMissionId = context?.data?.resolvedMissionId;
        if (!resolvedMissionId && job.id) {
            try {
                const wg = await missionService.getMissionForEntity({
                    entityType: 'job',
                    entityId: job.id
                });
                if (wg) resolvedMissionId = wg.id;
            } catch (e) {
                console.warn("[AiAgentExecutor] Failed to resolve mission:", e);
            }
        }

        // Dynamic Allotment (Provisioned by Supervisor/Parent)
        const provisionedTools = context.data?.allottedTools || context.data?.allotted_tools;
        if (Array.isArray(provisionedTools) && provisionedTools.length > 0) {
            console.log(`[AiAgentExecutor] Provisioning additional tools from parent: ${provisionedTools.join(', ')}`);
            finalAllowedTools = [...new Set([...finalAllowedTools, ...provisionedTools])];
        }

        // Apply Org-level restriction if configured
        if (settings?.allowedAgentTools) {
            const { normalizeToolName } = await import("@domain/tools/v1/tool-registry.service.js");
            const normalizedOrgTools = (settings.allowedAgentTools || []).map((t: string) => normalizeToolName(t));
            finalAllowedTools = finalAllowedTools.filter((t: string) => normalizedOrgTools.includes(normalizeToolName(t)));
        }

        // --- BASELINE TOOLS ENFORCEMENT ---
        // Ensure essential tools are ALWAYS present if the org has them enabled
        const baselineTools = ['file_read', 'file_list', 'google_search', 'search_unified_knowledge', 'browse_web'];
        const { isToolAvailable } = await import("@domain/tools/v1/tool-registry.service.js");
        
        for (const tool of baselineTools) {
            if (!finalAllowedTools.includes(tool)) {
                const available = await isToolAvailable(tool, job.organizationId!);
                if (available) {
                    finalAllowedTools.push(tool);
                }
            }
        }
        // ----------------------------------

        // 4. Augment System Prompt with Persona traits & resolve variables
        const baseSystemPrompt = config.systemPrompt || "";
        const { resolveVariables } = await import("@server/core/variable-resolver.js");

        // Merge config into context for self-referential property access (e.g. {{website}})
        const resolutionContext = {
            ...context,
            data: {
                ...(context.data || {}),
                ...(config as any)
            }
        };

        const resolvedSystemPrompt = resolveVariables(baseSystemPrompt, resolutionContext);

        // --- SOUL PERSONALITY INJECTION ---
        let soulPrompt: string | undefined;
        try {
            const { SoulService } = await import("@domain/agents/core/soul.service.js");
            
            // 1. Try Agent Deployment traits
            const [agentDep] = await db.select()
                .from(agentDeployments)
                .where(eq(agentDeployments.jobId, job.id))
                .limit(1);
            
            if (agentDep && agentDep.oceanTraits) {
                soulPrompt = SoulService.generateSoulPrompt(agentDep.oceanTraits as any, agentDep.soulArchetype || "Lead Directive");
            } 
            // 2. Fallback to App Deployment traits if mission-linked
            else if (resolvedMissionId) {
                const [appDep] = await db.select()
                    .from(appDeployments)
                    .where(eq(appDeployments.nextPipelineId, resolvedMissionId)) // Approximation if no direct link
                    .limit(1);
                
                if (appDep && appDep.oceanTraits) {
                    soulPrompt = SoulService.generateSoulPrompt(appDep.oceanTraits as any, appDep.soulArchetype || "Lead Directive");
                }
            }
        } catch (err) {
            console.warn("[AiAgentExecutor] Failed to resolve soul personality:", err);
        }

        const augmentedPrompt = AgentPersonaService.augmentSystemPrompt(
            (config.persona as AgentPersona) || 'generic',
            resolvedSystemPrompt,
            soulPrompt
        );

        // --- NEW: PARAMETER VALIDATION & HIL FALLBACK ---
        const parameterSchema = (job as any).parameterSchema;
        if (parameterSchema && Object.keys(parameterSchema).length > 0) {
            const required = parameterSchema.required || [];
            const missing = [];

            for (const key of required) {
                const val = resolutionContext.data[key];
                if (val === undefined || val === null || val === "" || (typeof val === 'string' && val.includes("{{"))) {
                    missing.push(key);
                }
            }

            if (missing.length > 0) {
                console.log(`[AiAgentExecutor-V3-DEBUG] Missing required parameters: ${missing.join(', ')}`);
                console.log(`[AiAgentExecutor] Missing required parameters for Job ${job.id}: ${missing.join(', ')}`);
                return {
                    success: true,
                    output: `Required parameters missing: ${missing.join(', ')}`,
                    status: "waiting_external_input",
                    suspensionMetadata: {
                        waitReason: "external_interaction",
                        type: "input_request",
                        title: "Mission Context Required",
                        reason: "Agent needs more information to proceed with the mission goal.",
                        message: `The agent '${job.name}' is paused because it needs more information to fulfill the mission goal: "${config.goal || 'unknown'}".`,
                        fields: missing.map(key => {
                            const prop = parameterSchema.properties?.[key];
                            let type = 'text';
                            if (prop?.type === 'number') type = 'number';
                            else if (prop?.type === 'boolean') type = 'checkbox';
                            else if (prop?.enum) type = 'select';

                            return {
                                name: key,
                                label: prop?.title || key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' '),
                                type,
                                required: true,
                                description: prop?.description,
                                placeholder: prop?.default || (type === 'text' ? `Enter ${key}...` : undefined),
                                options: prop?.enum
                            };
                        })
                    }
                } as any;
            }
        }

        // 5. Fetch Document Templates for Output Standards
        let templateAddition = "";
        if (config.templateIds && config.templateIds.length > 0) {
            const { documentTemplateService } = await import("../../../knowledge/index.js");
            const { inArray } = await import("drizzle-orm");
            const { documentTemplates } = await import("@shared/schema/index.js");

            const selectedTemplates = await db
                .select()
                .from(documentTemplates)
                .where(inArray(documentTemplates.id, config.templateIds));

            if (selectedTemplates.length > 0) {
                templateAddition = "\n\n## REFERENCE TEMPLATES FOR OUTPUT\n";
                templateAddition += "Use the following templates as reference for the expected format and structure of your outputs:\n\n";

                for (const t of selectedTemplates) {
                    const resolvedContent = await documentTemplateService.getResolvedContent(t);
                    templateAddition += `### Template: ${t.name} (Type: ${t.type})\n`;
                    if (t.description) templateAddition += `Description: ${t.description}\n`;
                    templateAddition += `\`\`\`\n${resolvedContent}\n\`\`\`\n\n`;
                }
            }
        }

        // 5b. Fetch Mission-Level RAG Assets & Document Templates
        let missionContextAddition = "";
        if (resolvedMissionId) {
            try {
                const { missionRagAssets, missionDocumentTemplates, missionFileAttachments } = await import("@shared/schema/missions/index.js");
                const { ragAssets } = await import("@shared/schema/knowledge/index.js");
                const { documentTemplates: docTemplates } = await import("@shared/schema/document-templates.js");
                const { documentTemplateService } = await import("../../../knowledge/index.js");
                const { getAssetPlainText } = await import("../../../knowledge/core/rag-utils.service.js");

                // --- Mission RAG Assets ---
                const missionAssets = await db
                    .select({
                        purpose: missionRagAssets.purpose,
                        name: ragAssets.name,
                        assetType: ragAssets.assetType,
                        sourceType: ragAssets.sourceType,
                        textContent: ragAssets.textContent,
                        fileData: ragAssets.fileData,
                        url: ragAssets.url,
                        id: ragAssets.id,
                    })
                    .from(missionRagAssets)
                    .innerJoin(ragAssets, eq(missionRagAssets.ragAssetId, ragAssets.id))
                    .where(eq(missionRagAssets.missionId, resolvedMissionId));

                if (missionAssets.length > 0) {
                    const purposeLabels: Record<string, string> = {
                        example: "EXAMPLES — These demonstrate expected output quality and format",
                        template: "TEMPLATES — Use these as starting structures for your deliverables",
                        reference: "REFERENCE MATERIAL — Consult this information as needed",
                        context: "BACKGROUND CONTEXT — Important context for this mission",
                    };

                    const grouped = new Map<string, typeof missionAssets>();
                    for (const asset of missionAssets) {
                        const p = asset.purpose || "reference";
                        if (!grouped.has(p)) grouped.set(p, []);
                        grouped.get(p)!.push(asset);
                    }

                    missionContextAddition += "\n\n## MISSION KNOWLEDGE ASSETS\n";
                    for (const [purpose, assets] of grouped) {
                        missionContextAddition += `\n### ${purposeLabels[purpose] || purpose.toUpperCase()}\n`;
                        for (const asset of assets) {
                            try {
                                const text = await getAssetPlainText(asset as any);
                                missionContextAddition += `\n**${asset.name}** (${asset.assetType}):\n${text}\n`;
                            } catch (e) {
                                missionContextAddition += `\n**${asset.name}**: [Content extraction failed]\n`;
                            }
                        }
                    }
                }

                // --- Mission Document Templates ---
                const missionTemplates = await db
                    .select({
                        role: missionDocumentTemplates.role,
                        templateId: docTemplates.id,
                        name: docTemplates.name,
                        type: docTemplates.type,
                        description: docTemplates.description,
                        content: docTemplates.content,
                        source: docTemplates.source,
                    })
                    .from(missionDocumentTemplates)
                    .innerJoin(docTemplates, eq(missionDocumentTemplates.documentTemplateId, docTemplates.id))
                    .where(eq(missionDocumentTemplates.missionId, resolvedMissionId));

                if (missionTemplates.length > 0) {
                    if (!templateAddition) {
                        templateAddition = "\n\n## REFERENCE TEMPLATES FOR OUTPUT\n";
                        templateAddition += "Use the following templates as reference for the expected format and structure of your outputs:\n\n";
                    }

                    const roleLabels: Record<string, string> = {
                        output_standard: "Output Standard",
                        tool: "Mission Tool",
                        reference: "Reference",
                    };

                    for (const t of missionTemplates) {
                        try {
                            const resolvedContent = await documentTemplateService.getResolvedContent(t as any);
                            templateAddition += `### Mission ${roleLabels[t.role] || "Template"}: ${t.name} (Type: ${t.type})\n`;
                            if (t.description) templateAddition += `Description: ${t.description}\n`;
                            templateAddition += `\`\`\`\n${resolvedContent}\n\`\`\`\n\n`;
                        } catch (e) {
                            templateAddition += `### Mission Template: ${t.name}\n[Content resolution failed]\n\n`;
                        }
                    }
                }

                // --- Direct Mission File Attachments ---
                const directAttachments = await db
                    .select()
                    .from(missionFileAttachments)
                    .where(eq(missionFileAttachments.missionId, resolvedMissionId));

                if (directAttachments.length > 0) {
                    missionContextAddition += "\n\n## DIRECT MISSION FILE ATTACHMENTS\n";
                    missionContextAddition += "The following files have been attached directly to this mission for your context:\n";

                    for (const file of directAttachments) {
                        missionContextAddition += `\n### Attached File: ${file.fileName} (Purpose: ${file.purpose})\n`;
                        if (file.textContent) {
                            missionContextAddition += `Content:\n${file.textContent}\n`;
                        } else if (file.contentType?.startsWith("text/") || file.fileName.endsWith(".md") || file.fileName.endsWith(".txt")) {
                            if (file.fileData) {
                                try {
                                    const decoded = Buffer.from(file.fileData, 'base64').toString('utf-8');
                                    missionContextAddition += `Content:\n${decoded}\n`;
                                } catch (e) {
                                    missionContextAddition += `[Content could not be decoded]\n`;
                                }
                            }
                        } else {
                            missionContextAddition += `[Binary file: ${file.contentType}]\n`;
                        }
                    }
                }
            } catch (err) {
                console.warn("[AiAgentExecutor] Failed to fetch mission-level assets/templates:", err);
            }
        }

        // 6. Build Dynamic Knowledge Context for System Prompt
        let knowledgeContextAddition = "";

        // Fetch Topic Names
        if (config.topicIds && config.topicIds.length > 0) {
            const allTopics = await topicService.listTopics(getSystemOrgContext(job.organizationId!));
            const topics = allTopics.filter(t => config.topicIds.includes(t.id));

            if (topics.length > 0) {
                knowledgeContextAddition += "\n\n## YOUR KNOWLEDGE BASE ACCESS\n";
                knowledgeContextAddition += "You have access to the following Knowledge Topics. Use `search_knowledge_base` to find documents within these topics:\n";
                topics.forEach(t => {
                    knowledgeContextAddition += `- **${t.name}**${t.description ? `: ${t.description}` : ''}\n`;
                });
            }
        }

        // Fetch Dataset Names
        if (config.datasetIds && config.datasetIds.length > 0) {
            const dsList = await datasetService.list(getSystemOrgContext(job.organizationId!), { datasetIds: config.datasetIds });

            if (dsList.length > 0) {
                knowledgeContextAddition += "\n\n## YOUR DATASET ACCESS\n";
                knowledgeContextAddition += "You have access to the following structured Datasets:\n";
                dsList.forEach(d => {
                    knowledgeContextAddition += `- **${d.name}** (ID: ${d.id})${d.description ? `: ${d.description}` : ''}\n`;
                });
            }
        }

        // Fetch Pipeline Names and Input Parameters
        if (config.pipelineIds && config.pipelineIds.length > 0) {
            const { pipelines, pipelineInputParams } = await import("@shared/schema/index.js");
            const { inArray } = await import("drizzle-orm");

            const pipelineList = await db
                .select({ id: pipelines.id, name: pipelines.name, description: pipelines.description })
                .from(pipelines)
                .where(inArray(pipelines.id, config.pipelineIds));

            if (pipelineList.length > 0) {
                knowledgeContextAddition += "\n\n## YOUR PIPELINE ACCESS\n";
                knowledgeContextAddition += "You can trigger the following Pipelines using `trigger_pipeline` or `show_pipeline_input_form`:\n";

                for (const p of pipelineList) {
                    knowledgeContextAddition += `- **${p.name}** (ID: ${p.id})${p.description ? `: ${p.description}` : ''}\n`;

                    // Fetch input params for this pipeline
                    const params = await db
                        .select({ name: pipelineInputParams.name, label: pipelineInputParams.label, isRequired: pipelineInputParams.isRequired })
                        .from(pipelineInputParams)
                        .where(eq(pipelineInputParams.pipelineId, p.id));

                    if (params.length > 0) {
                        const requiredParams = params.filter(param => param.isRequired);
                        if (requiredParams.length > 0) {
                            knowledgeContextAddition += `  Required inputs: ${requiredParams.map(param => param.label || param.name).join(', ')}\n`;
                        }
                    }
                }
            }
        }

        // Add knowledge types guidance
        if (config.knowledgeTypes && config.knowledgeTypes.length > 0) {
            knowledgeContextAddition += "\n\n## SEARCH GUIDANCE\n";
            knowledgeContextAddition += "When users ask about existing information, ALWAYS search first before saying you don't have data.\n";
            if (config.knowledgeTypes.includes('docs')) {
                knowledgeContextAddition += "- Use `search_knowledge_base` to find documents and their contents\n";
            }
            if (config.knowledgeTypes.includes('graph')) {
                knowledgeContextAddition += "- Use knowledge graph tools (`search_knowledge_graph`, `explore_relationships`) to explore entity relationships\n";
                knowledgeContextAddition += "- Use `get_documents_for_entity` to jump from a graph entity to its technical specifications or documentation\n";
                knowledgeContextAddition += "- Use `get_entity_details` with an ID to see full properties and linked document IDs\n";
            }
            if (config.knowledgeTypes.includes('datasets')) {
                knowledgeContextAddition += "- Use dataset tools to query structured data\n";
            }
        }

        // Add workflow patterns to teach tool combinations
        const hasTopics = config.topicIds && config.topicIds.length > 0;
        const hasDatasets = config.datasetIds && config.datasetIds.length > 0;
        const hasPipelines = config.pipelineIds && config.pipelineIds.length > 0;

        if (hasTopics || hasDatasets || hasPipelines) {
            knowledgeContextAddition += "\n\n## WORKFLOW PATTERNS\n";
            knowledgeContextAddition += "Combine your tools effectively to help users:\n\n";

            if (hasTopics && hasPipelines) {
                knowledgeContextAddition += "**Research → Action Pattern**:\n";
                knowledgeContextAddition += "1. Search the knowledge base for existing information\n";
                knowledgeContextAddition += "2. Summarize findings for the user\n";
                knowledgeContextAddition += "3. Offer to trigger a pipeline if action is needed\n\n";
            }

            if (hasTopics) {
                knowledgeContextAddition += "**Investigation Pattern**:\n";
                knowledgeContextAddition += "1. Search with broad keywords first\n";
                knowledgeContextAddition += "2. If results are sparse, try alternative terms or IDs\n";
                knowledgeContextAddition += "3. Get full document content for relevant matches\n\n";
            }

            if (hasPipelines) {
                knowledgeContextAddition += "**Guided Input Pattern**:\n";
                knowledgeContextAddition += "1. Show the pipeline input form to collect required data\n";
                knowledgeContextAddition += "2. Validate the inputs with the user\n";
                knowledgeContextAddition += "3. Trigger the pipeline with collected data\n";
                knowledgeContextAddition += "4. Report the execution status\n\n";
            }

            if (hasTopics && hasDatasets) {
                knowledgeContextAddition += "**Cross-Reference Pattern**:\n";
                knowledgeContextAddition += "1. Search documents for context\n";
                knowledgeContextAddition += "2. Query datasets for structured data\n";
                knowledgeContextAddition += "3. Combine insights from both sources\n\n";
            }

            knowledgeContextAddition += "**Always**: Explain what you found and ask if the user wants to take action.\n";
        }

        // Add Proof of Work requirement for missions
        if (resolvedMissionId) {
            knowledgeContextAddition += "\n\n## PROOF OF WORK\n";
            knowledgeContextAddition += "When you complete your task, your `final_answer` MUST include a summary of the accomplishments and, if you generated any content or files, you MUST provide a significant snippet of that content. This helps the mission supervisor verify your results.\n";
        }

        // Combine all additions
        const fullSystemPromptAddition = (templateAddition || "") + (missionContextAddition || "") + (knowledgeContextAddition || "");

        // Base config for LLM calls with augmented prompt (normalize model to avoid 404 from deprecated names)
        const baseConfig: AIApiCallConfig = {
            credentialId: config.credentialId,
            model: (() => {
                const m = config.model ? normalizeGeminiModel(config.model) : "gemini-2.0-flash";
                console.log(`[AiAgentExecutor] Normalized model: ${config.model} -> ${m}`);
                return m;
            })(),
            temperature: 0,
            systemPrompt: augmentedPrompt,
            systemPromptAddition: fullSystemPromptAddition || undefined,
            userPrompt: "", // Will be filled by agent runner
            useCache: false,
            enableQueryExpansion: false,
            saveOutputToFile: false, // The agent executor handles the final output saving
            // Financial Guardrails (Phase 1)
            organizationId: job.organizationId || context.orgId || null,
            missionId: resolvedMissionId || context.missionId || null
        };


        const { runAgentLoop } = await import("@domain/agents/agent-runner.js");
        const transaction = transactionLogService.startTransaction(context.executionId);

        // --- App Settings Resolution ---
        let appDeployment: any = null;

        if (resolvedMissionId) {
            try {
                const [mission] = await db.select().from(missions).where(eq(missions.id, resolvedMissionId)).limit(1);
                if (mission && mission.blackboard) {
                    const blackboard = mission.blackboard as any;
                    const viaAppSlug = blackboard._viaApp;
                    if (viaAppSlug) {
                        const [deployment] = await db.select()
                            .from(appDeployments)
                            .where(and(
                                eq(appDeployments.publicSlug, viaAppSlug),
                                eq(appDeployments.organizationId, job.organizationId!)
                            ))
                            .limit(1);
                        if (deployment) {
                            appDeployment = deployment;
                            // 1. Override Model if set
                            if (appDeployment.defaultModel) {
                                baseConfig.model = normalizeGeminiModel(appDeployment.defaultModel);
                            }
                            // 2. Prepend System Prompt if set
                            if (appDeployment.systemPrompt) {
                                baseConfig.systemPrompt = `${appDeployment.systemPrompt}\n\n${baseConfig.systemPrompt}`;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("[AiAgentExecutor] Failed to resolve app settings:", e);
            }
        }

        // --- Expertise Syncing & Advanced Hub features (Phase 2) ---
        const expertiseJobId = config.expertiseJobId || (appDeployment?.expertiseJobId);
        let reasoningProtocol: any = appDeployment?.reasoningProtocol || "json_manifest";

        if (expertiseJobId) {
            try {
                const [expertiseJob] = await db.select().from(jobs).where(eq(jobs.id, expertiseJobId)).limit(1);
                if (expertiseJob) {
                    const expertisePrompt = expertiseJob.description || "";
                    const expertiseConfig = expertiseJob.config as any;
                    const expertiseSystemPrompt = expertiseConfig?.systemPrompt || "";
                    
                    // Prepend expertise to the loop context
                    baseConfig.systemPrompt = `## BACKING EXPERTISE: ${expertiseJob.name}\n${expertisePrompt}\n${expertiseSystemPrompt}\n\n${baseConfig.systemPrompt}`;
                    
                    // Inherit Tools from Expertise Job if scoped
                    if (appDeployment?.allowedTools && appDeployment.allowedTools.length > 0) {
                        const inheritedTools = (expertiseConfig?.allowedTools || []) as string[];
                        finalAllowedTools = [...new Set([...finalAllowedTools, ...inheritedTools])].filter(t => 
                            appDeployment!.allowedTools!.includes(t)
                        );
                    }

                    console.log(`[AiAgentExecutor] Hybrid brain active. Linked to Expertise Job: ${expertiseJobId} (Protocol: ${reasoningProtocol})`);
                }
            } catch (e) {
                console.warn(`[AiAgentExecutor] Failed to hydrate expertise from job ${expertiseJobId}:`, e);
            }
        }

        // --- Intelligence Categories (Dynamic Discovery) ---
        if (appDeployment?.intelligenceCategory) {
            baseConfig.systemPrompt = `## INTELLIGENCE CATEGORY: ${appDeployment.intelligenceCategory}\nYou are optimized for this conceptual domain. Draw upon the Knowledge Graph's "Expertise Hub" for deep relational context.\n\n${baseConfig.systemPrompt}`;
        }

        // --- Budget Resolution ---
        let remainingBudgetUsd: number | undefined;
        let stepBudgetLimitUsd: number | undefined;

        if (resolvedMissionId) {
            try {
                const [mission] = await db.select().from(missions).where(eq(missions.id, resolvedMissionId)).limit(1);
                if (mission) {
                    const limit = Number(mission.budgetLimitUsd) || 0;
                    const spend = Number(mission.currentSpendUsd) || 0;
                    remainingBudgetUsd = Math.max(0, limit - spend);
                    stepBudgetLimitUsd = Number(mission.dynamicCycleBudgetLimitUsd) || 1.00;
                }
            } catch (e) {
                console.warn("[AiAgentExecutor] Failed to resolve mission budget:", e);
            }
        }
        // ----------------------------

        try {
            // Execute Autonomous Loop
            const rawGoal = config.goal || job.description || job.name;
            const resolvedGoal = resolveVariables(rawGoal, resolutionContext);
            let result: any;

            if (appDeployment?.deploymentMode === 'browser_autopilot') {
                const { seleniumAgentService } = await import("@domain/agents/core/selenium-agent.service.js");
                const startUrl = appDeployment.browserStartUrl || "https://google.com";
                const autoGoal = resolvedGoal || appDeployment.browserGoal || "Navigate and find information.";
                
                console.log(`[AiAgentExecutor] Launching Browser Auto-Pilot: ${startUrl} -> ${autoGoal}`);
                
                const steps = await seleniumAgentService.runAutoPilot(
                    startUrl, 
                    autoGoal, 
                    { 
                        organizationId: job.organizationId!, 
                        userId: (context as any).userId || (context as any).data?.userId || 'system',
                        isAdmin: false,
                        isSuperAdmin: false,
                        isOrgAdmin: false
                    },
                    (config as any).datasetId,
                    appDeployment as any
                );

                result = {
                    output: `Autonomous Browser session completed with ${steps.length} steps.`,
                    usage: { totalTokens: 0 }, // Browser loop handles its own billing/usage eventually
                    history: steps.map(s => ({
                        type: 'action',
                        content: `Browser Action: ${s.action} ${s.selector || ''} ${s.value || ''}`
                    }))
                };
            } else {
                const { runAgentLoop } = await import("@domain/agents/agent-runner.js");

                // Respect per-agent token budget from execution strategy
                const agentTokenBudget = config.tokenBudget ?? null;
                const effectiveStepBudget = agentTokenBudget
                    ? Math.min(stepBudgetLimitUsd ?? Infinity, agentTokenBudget / 1000)
                    : stepBudgetLimitUsd;

                // Execution strategy: detect stalls and pause for re-planning
                const executionStrategy = config.executionStrategy ?? null;
                const maxConsecutiveFailures = executionStrategy?.max_consecutive_failures ?? null;
                const checkpointInterval = executionStrategy?.checkpoint_every_n_iterations ?? null;

                result = await runAgentLoop(
                    client,
                    baseConfig,
                    resolvedGoal,
                    finalAllowedTools,
                    config.maxIterations || 10,
                    apiKey!,
                    {
                        ...context,
                        jobId: expertiseJobId || job.id, // Link memory/training to expertise agent
                        transaction, // Inject transaction into context
                        resolvedMissionId,
                        appDeploymentId: appDeployment?.id,
                        appMemoryEnabled: appDeployment?.appMemoryEnabled,
                        allowedTopicIds: config.topicIds || config.allowedTopicIds,
                        allowedDatasetIds: config.datasetIds,
                        allowedPipelineIds: config.pipelineIds,
                        remainingBudgetUsd,
                        stepBudgetLimitUsd: effectiveStepBudget,
                        reasoningProtocol, // PROXY: Pass protocol to orchestrator
                        // Execution strategy context for agent loop stall detection
                        executionStrategy,
                        maxConsecutiveFailures,
                        checkpointInterval,
                    },
                    context.traceContext,
                    config.dryRun || false,
                    undefined, // governorConfig
                    (config as any).supervision || "advisory"
                );
            }

            // 1. Commit primary execution
            await transaction.commit();

            // 2. Post-Run Memory Compaction (Expertise Hub Transition)
            if (appDeployment?.enableRunMemory && expertiseJobId) {
                const { compactionService } = await import("@domain/agents/core/compaction.service.js");
                // Trigger asynchronously to avoid blocking the user response
                compactionService.compactSession(job.id, expertiseJobId, job.organizationId).catch(err => {
                    console.warn("[AiAgentExecutor] Compaction background task failed:", err);
                });
            }

            const { persistAgentHistory } = await import("@domain/agents/core/persistence.js");
            await persistAgentHistory(result.history, {
                jobId: expertiseJobId || job.id, 
                userId: (context as any).userId || context.data?.userId || 'system',
                organizationId: job.organizationId,
                missionId: resolvedMissionId
            });

            const output = result.output;
            const usage = result.usage;

            const telemetry = {
                agent_goal: config.goal,
                max_iterations: config.maxIterations,
                tools_available: finalAllowedTools.length,
                tokenUsage: usage, // Pass usage up
                provider: (metadata as any).provider || 'unknown',
                model: baseConfig.model
            };

            await saveJobOutput(job, config, output);

            // NEW: Check if this was an HIL request (mode switch or input request)
            let status = "success";
            let suspensionMetadata = undefined;

            if (typeof output === 'string') {
                try {
                    const parsed = JSON.parse(output);
                    if (parsed && (parsed.type === 'input_request' || parsed.type === 'mode_switch_request')) {
                        console.log(`[AiAgentExecutor] Agent for Job ${job.id} requested HIL: ${parsed.type}`);
                        status = "waiting_external_input";
                        suspensionMetadata = {
                            waitReason: "external_interaction",
                            ...parsed
                        };
                    }
                } catch {
                    // Not JSON, ignore
                }
            }

            return {
                success: true,
                output,
                status,
                telemetry,
                suspensionMetadata,
                __aiUsageMetadata: {
                    provider: (metadata as any).provider || 'unknown',
                    model: baseConfig.model,
                    metadata: usage
                },
                data: {
                    usage,
                    runId: job.id,
                    attributedJobId: expertiseJobId || job.id
                }
            } as any;
        } catch (error: any) {
            console.error(`[AiAgentExecutor] Agent loop crashed, rolling back transaction ${transaction.transactionId}`, error);
            await transaction.rollback();
            throw error;
        }
    }
}


