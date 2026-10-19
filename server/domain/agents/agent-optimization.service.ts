
import { db } from "@server/database_service.js";
import { optimizationSuggestions, agentRunSteps, type InsertOptimizationSuggestion, agentChatMessages } from "@shared/schema/agent/index.js";
import { jobs, pipelines, datasets, knowledgeTopics, documentTemplates } from "@shared/schema/index.js";
import { eq, desc, inArray, and, isNotNull } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { AGENT_TOOLS } from "../tools/v1/tool-registry.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "../ai/core/system-ai.service.js";
import { NotFoundError, BadRequestError, JobNotFoundError } from "@server/utils/errors.js";
import { CircuitBreaker } from "../../utils/circuit-breaker.js";
import { auditService } from "@domain/audit/index.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger('AgentOptimization');

/**
 * Context about the agent's available tools and resources
 */
interface AgentContext {
    jobConfig: any;
    availableTools: { name: string; description: string; group?: string }[];
    allowedPipelines: { id: number; name: string; description: string | null }[];
    allowedDatasets: { id: number; name: string; description: string | null }[];
    allowedTopics: { id: number; name: string }[];
    documentTemplates: { id: number; name: string; type: string; description: string | null }[];
}

export class AgentOptimizationService {
    /**
     * Fetch the agent's full context including tools, pipelines, datasets, and templates
     */
    async getAgentContext(jobId: number | null): Promise<AgentContext | null> {
        try {
            // Handle missing or invalid jobId
            if (!jobId || jobId <= 0) {
                logger.info(`[AgentOptimization] No valid jobId (${jobId}), returning base tools context`);
                // Return minimal context with just base tools
                const availableTools = Object.entries(AGENT_TOOLS).map(([name, tool]) => ({
                    name,
                    description: tool.description,
                    group: tool.group || 'general'
                }));
                return {
                    jobConfig: {},
                    availableTools,
                    allowedPipelines: [],
                    allowedDatasets: [],
                    allowedTopics: [],
                    documentTemplates: []
                };
            }

            // Fetch job configuration
            const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId!)).limit(1);
            if (!job) {
                logger.warn(`[AgentOptimization] Job ${jobId} not found`);
                // Return minimal context with just base tools
                const availableTools = Object.entries(AGENT_TOOLS).map(([name, tool]) => ({
                    name,
                    description: tool.description,
                    group: tool.group || 'general'
                }));
                return {
                    jobConfig: {},
                    availableTools,
                    allowedPipelines: [],
                    allowedDatasets: [],
                    allowedTopics: [],
                    documentTemplates: []
                };
            }

            const config = job.config as any || {};
            const orgId = job.organizationId;

            // Get all available tools with descriptions
            const availableTools = Object.entries(AGENT_TOOLS).map(([name, tool]) => ({
                name,
                description: tool.description,
                group: tool.group || 'general'
            }));

            // Fetch allowed pipelines
            let allowedPipelines: { id: number; name: string; description: string | null }[] = [];
            const pipelineIds = config.pipelineIds as number[] | undefined;
            if (pipelineIds && pipelineIds.length > 0) {
                allowedPipelines = await db.select({
                    id: pipelines.id,
                    name: pipelines.name,
                    description: pipelines.description
                }).from(pipelines).where(inArray(pipelines.id, pipelineIds));
            }

            // Fetch allowed datasets
            let allowedDatasets: { id: number; name: string; description: string | null }[] = [];
            const datasetIds = config.datasetIds as number[] | undefined;
            if (datasetIds && datasetIds.length > 0) {
                allowedDatasets = await db.select({
                    id: datasets.id,
                    name: datasets.name,
                    description: datasets.description
                }).from(datasets).where(inArray(datasets.id, datasetIds));
            }

            // Fetch allowed knowledge topics
            let allowedTopics: { id: number; name: string }[] = [];
            const topicIds = config.topicIds as number[] | undefined;
            if (topicIds && topicIds.length > 0) {
                allowedTopics = await db.select({
                    id: knowledgeTopics.id,
                    name: knowledgeTopics.name
                }).from(knowledgeTopics).where(inArray(knowledgeTopics.id, topicIds));
            }

            // Fetch document templates (from config or org-wide)
            let templates: { id: number; name: string; type: string; description: string | null }[] = [];
            const templateIds = config.documentTemplateIds as number[] | undefined;
            if (templateIds && templateIds.length > 0) {
                templates = await db.select({
                    id: documentTemplates.id,
                    name: documentTemplates.name,
                    type: documentTemplates.type,
                    description: documentTemplates.description
                }).from(documentTemplates).where(inArray(documentTemplates.id, templateIds));
            } else if (orgId) {
                templates = await db.select({
                    id: documentTemplates.id,
                    name: documentTemplates.name,
                    type: documentTemplates.type,
                    description: documentTemplates.description
                }).from(documentTemplates).where(eq(documentTemplates.organizationId, orgId)).limit(20);
            }

            return {
                jobConfig: config,
                availableTools,
                allowedPipelines,
                allowedDatasets,
                allowedTopics,
                documentTemplates: templates
            };
        } catch (err) {
            logger.error(`[AgentOptimization] Failed to fetch agent context:`, err);
            return null;
        }
    }

    /**
     * Format execution trace for AI analysis
     */
    formatTraceForAnalysis(steps: any[]): string {
        return steps.map((s, idx) => {
            let line = `[${idx + 1}] ${s.type.toUpperCase()}`;
            if (s.toolName) line += ` (${s.toolName})`;
            line += `: ${(s.content || '').substring(0, 2000)}`;
            if (s.toolArgs) {
                try {
                    line += `\n    Args: ${JSON.stringify(s.toolArgs).substring(0, 1000)}`;
                } catch { }
            }
            return line;
        }).join('\n\n');
    }

    /**
     * Format agent context for AI analysis prompt
     */
    formatContextForPrompt(context: AgentContext): string {
        let result = `## AGENT CONFIGURATION\n`;

        // System prompt / goal
        if (context.jobConfig.systemPrompt) {
            result += `**System Prompt:** ${context.jobConfig.systemPrompt}\n`;
        }
        if (context.jobConfig.goal) {
            result += `**Goal:** ${context.jobConfig.goal}\n`;
        }

        // Available Pipelines
        if (context.allowedPipelines.length > 0) {
            result += `\n**Available Pipelines (Tools the agent can trigger):**\n`;
            context.allowedPipelines.forEach(p => {
                result += `- ${p.name} (ID: ${p.id}): ${p.description || 'No description'}\n`;
            });
        }

        // Available Datasets
        if (context.allowedDatasets.length > 0) {
            result += `\n**Available Datasets:**\n`;
            context.allowedDatasets.forEach(d => {
                result += `- ${d.name} (ID: ${d.id}): ${d.description || 'No description'}\n`;
            });
        }

        // Knowledge Topics
        if (context.allowedTopics.length > 0) {
            result += `\n**Knowledge Topics (for search_documents):**\n`;
            context.allowedTopics.forEach(t => {
                result += `- ${t.name} (ID: ${t.id})\n`;
            });
        }

        // Document Templates
        if (context.documentTemplates.length > 0) {
            result += `\n**Document Templates:**\n`;
            context.documentTemplates.forEach(t => {
                result += `- ${t.name} (Type: ${t.type}): ${t.description || 'Output template'}\n`;
            });
        }

        // Available Tools (grouped)
        const toolsByGroup = new Map<string, typeof context.availableTools>();
        context.availableTools.forEach(t => {
            const group = t.group || 'general';
            if (!toolsByGroup.has(group)) toolsByGroup.set(group, []);
            toolsByGroup.get(group)!.push(t);
        });

        result += `\n**Available Agent Tools:**\n`;
        for (const [group, tools] of toolsByGroup) {
            result += `*${group}:* ${tools.map(t => t.name).join(', ')}\n`;
        }

        return result;
    }

    async analyzeRun(runId: string, jobId: number | null): Promise<InsertOptimizationSuggestion[]> {
        logger.info(`[AgentOptimization] Analyzing run ${runId} for job ${jobId} with full context...`);

        // 1. Clear existing pending suggestions for this run before fresh analysis
        // This prevents the "same recommendation" from accumulating in the UI
        await db.delete(optimizationSuggestions).where(
            and(
                eq(optimizationSuggestions.runId, runId),
                eq(optimizationSuggestions.status, 'pending')
            )
        );

        // 2. Fetch run steps
        const steps = await db.select().from(agentRunSteps).where(eq(agentRunSteps.runId, runId)).orderBy(agentRunSteps.createdAt);

        if (steps.length === 0) {
            return [];
        }

        // Recover jobId from steps if missing
        if (!jobId) {
            const stepWithJobId = steps.find(s => s.jobId);
            if (stepWithJobId) {
                jobId = stepWithJobId.jobId;
                logger.info(`[AgentOptimization] Recovered jobId ${jobId} from steps for run ${runId}`);
            }
        }

        // 2. Fetch agent context (tools, resources)
        const agentContext = await this.getAgentContext(jobId);

        const suggestions: InsertOptimizationSuggestion[] = [];

        // 3. Heuristic Analysis
        // Check for error outputs in tool calls
        const errorSteps = steps.filter(s => s.type === 'tool_error' || (s.content && s.content.includes("Error:")));

        if (errorSteps.length > 0) {
            suggestions.push({
                jobId,
                runId,
                type: 'tool_suggestion',
                content: `Detected ${errorSteps.length} tool errors. Check tool arguments for correct types and required fields.`,
                reasoning: `Steps [${errorSteps.map(s => s.id).join(', ')}] returned errors.`,
                status: 'pending'
            });
        }

        // Check for high step count
        if (steps.length > 10) {
            suggestions.push({
                jobId,
                runId,
                type: 'prompt_improvement',
                content: "The agent took 10+ steps. Consider adding specific constraints to the system prompt to guide it faster.",
                reasoning: "High step count indicates potential wandering.",
                status: 'pending'
            });
        }

        // 4. AI-Powered Analysis with Full Context
        if (agentContext) {
            try {
                const aiSuggestions = await this.performAIAnalysis(runId, jobId, steps, agentContext);
                suggestions.push(...aiSuggestions);
            } catch (err) {
                logger.error(`[AgentOptimization] AI analysis failed:`, err);
                // Continue with heuristic suggestions only
            }
        }

        // 5. Resource Usage Analysis (check for missed opportunities)
        if (agentContext && agentContext.allowedPipelines.length > 0) {
            const usedTools = new Set(steps.filter(s => s.toolName).map(s => s.toolName));
            const usedTriggerPipeline = usedTools.has('trigger_pipeline') || usedTools.has('run_pipeline');

            if (!usedTriggerPipeline && agentContext.allowedPipelines.length > 0) {
                // User has pipelines configured but none were triggered
                const pipelineNames = agentContext.allowedPipelines.map(p => p.name).join(', ');
                suggestions.push({
                    jobId,
                    runId,
                    type: 'tool_suggestion',
                    content: `The agent has access to pipelines (${pipelineNames}) but didn't use them. Consider adding tool hints to guide the agent when these pipelines are relevant.`,
                    reasoning: `Available pipelines were not utilized in this run.`,
                    status: 'pending'
                });
            }
        }

        // 6. Save suggestions
        if (suggestions.length > 0) {
            // Filter out exact duplicates of suggestions already applied/dismissed
            const existing = await db.select().from(optimizationSuggestions).where(eq(optimizationSuggestions.runId, runId));
            const filteredSuggestions = suggestions.filter(s =>
                !existing.some(e => e.type === s.type && e.content === s.content)
            );

            if (filteredSuggestions.length > 0) {
                const inserted = await db.insert(optimizationSuggestions).values(filteredSuggestions).returning();
                return inserted as any[];
            }
        }

        return [];
    }

    async getSuggestions(runId: string) {
        return db.select()
            .from(optimizationSuggestions)
            .where(eq(optimizationSuggestions.runId, runId))
            .orderBy(desc(optimizationSuggestions.createdAt));
    }
    /**
     * Perform AI-powered analysis of the execution trace with agent context
     */
    async performAIAnalysis(runId: string, jobId: number | null, steps: any[], context: AgentContext): Promise<InsertOptimizationSuggestion[]> {
        logger.info(`[AgentOptimization] Starting AI analysis for run ${runId}...`);

        // 1. Fetch user/session info from the run steps to link to chat history
        const [firstStep] = steps;
        const userId = firstStep?.userId;
        let conversationContext = "";

        if (userId) {
            try {
                const history = await db.select()
                    .from(agentChatMessages)
                    .where(eq(agentChatMessages.userId, userId))
                    .orderBy(desc(agentChatMessages.createdAt))
                    .limit(5);

                if (history.length > 0) {
                    conversationContext = "\n## RECENT CONVERSATION HISTORY (Previous Turns)\n";
                    // Reverse to get chronological order
                    conversationContext += history.reverse().map(m => `[${m.role.toUpperCase()}]: ${m.content.substring(0, 300)}`).join("\n");
                    conversationContext += "\n";
                }
            } catch (err) {
                logger.warn(`[AgentOptimization] Failed to fetch chat history for context:`, undefined, err);
            }
        }

        const aiConfig = await systemAiService.getAiConfig('copilot');
        if (!aiConfig) {
            logger.warn(`[AgentOptimization] No AI config available for analysis`);
            return [];
        }

        if (CircuitBreaker.isOpen('agent-optimization-ai')) {
            logger.warn(`[AgentOptimization] Circuit breaker OPEN for AI analysis. Skipping.`);
            return [];
        }

        const aiClient = AIClientFactory.getClient(aiConfig as any);
        const apiKey = (aiConfig as any).apiKey || developmentProviderKey();

        const traceText = this.formatTraceForAnalysis(steps);
        const contextText = this.formatContextForPrompt(context);

        logger.info(`[AgentOptimization] Sending trace (${steps.length} steps) to AI for analysis...`);
        logger.debug(`[AgentOptimization] Context for prompt:\n${contextText}`, context as any);

        const systemPrompt = `You are an expert AI agent optimization analyst. 
Your job is to analyze agent execution traces and suggest improvements.

${contextText}
${conversationContext}

Analyze the execution trace below and provide 1-3 specific, actionable suggestions.
Focus on:
1. **Missed Tool Opportunities**: Did the agent fail to use an appropriate tool from its available set?
2. **Resource Utilization**: Could the agent have used its datasets, knowledge topics, or document templates more effectively?
3. **Prompt Improvements**: How could the system prompt be refined to improve performance?
4. **Error Patterns**: What caused any errors and how can they be prevented?

Be specific. 

If type is "prompt_improvement", the "content" field MUST contain the FULL, IMPROVED System Prompt text that should replace the existing one.
If type is "tool_suggestion", the "content" field should describe which tool to add or how to use it better.

Output your response as a JSON array of suggestions:
[
  {
    "type": "tool_suggestion" | "prompt_improvement" | "resource_usage",
    "content": "Specific suggestion text OR the FULL improved system prompt",
    "reasoning": "Why this would help"
  }
]
`;

        const userPrompt = `## EXECUTION TRACE (${steps.length} steps)

${traceText}

---
Provide your analysis as a JSON array.`;

        try {
            // 60s Timeout Race
            const timeoutPromise = new Promise<{ success: boolean; output?: string; error?: string }>((_, reject) => {
                setTimeout(() => reject(new Error("AI Analysis timed out after 60s")), 60000);
            });

            const executionPromise = aiClient.execute({
                model: (aiConfig as any).model,
                systemPrompt,
                userPrompt,
                temperature: 0.3
            } as any, undefined, apiKey);

            const result = await Promise.race([executionPromise, timeoutPromise]);

            CircuitBreaker.recordSuccess('agent-optimization-ai');

            if (!result.success || !result.output) {
                logger.warn(`[AgentOptimization] AI analysis returned unsuccessful result or empty output: ${result.error || 'Empty output'}`);
                return [];
            }

            logger.info(`[AgentOptimization] AI analysis successful. Parsing results...`);

            // Clean up DeepSeek/Reasoning models output (remove <think>...</think>)
            let cleanOutput = result.output.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
            // Also remove markdown code fences if present
            cleanOutput = cleanOutput.replace(/```json/g, '').replace(/```/g, '').trim();

            // Find JSON array structure
            const jsonMatch = cleanOutput.match(/\[[\s\S]*\]/);
            if (!jsonMatch) {
                logger.warn(`[AgentOptimization] Could not parse JSON from AI response: ${cleanOutput.substring(0, 200)}...`);
                return [];
            }

            const parsed = JSON.parse(jsonMatch[0]) as { type: string; content: string; reasoning: string }[];
            logger.info(`[AgentOptimization] Parsed ${parsed.length} suggestions from AI.`);

            return parsed.map(s => ({
                jobId: jobId || null,
                runId,
                type: s.type as any,
                content: s.content,
                reasoning: s.reasoning,
                status: 'pending' as const
            }));
        } catch (err) {
            CircuitBreaker.recordFailure('agent-optimization-ai');
            logger.error(`[AgentOptimization] AI analysis failed or timed out:`, err);
            return [];
        }
    }



    async applySuggestion(suggestionId: number) {
        logger.info(`[AgentOptimization] Applying suggestion ${suggestionId}`);

        const [suggestion] = await db.select().from(optimizationSuggestions).where(eq(optimizationSuggestions.id, suggestionId)).limit(1);
        if (!suggestion) throw new NotFoundError("Suggestion not found");

        if (suggestion.status === 'applied') {
            return { success: true, message: "Already applied" };
        }

        let jobId = suggestion.jobId;

        // Attempt to recover jobId from the runId if missing
        if (!jobId) {
            const [step] = await db.select({ jobId: agentRunSteps.jobId })
                .from(agentRunSteps)
                .where(
                    and(
                        eq(agentRunSteps.runId, suggestion.runId),
                        isNotNull(agentRunSteps.jobId)
                    )
                )
                .limit(1);

            if (step?.jobId) {
                jobId = step.jobId;
                // Update suggestion for consistency
                await db.update(optimizationSuggestions).set({ jobId }).where(eq(optimizationSuggestions.id, suggestionId));
                logger.info(`[AgentOptimization] Recovered jobId ${jobId} for suggestion ${suggestionId}`);
            }
        }

        // For prompt improvements, we ABSOLUTELY need a job to update
        if (!jobId && suggestion.type === 'prompt_improvement') {
            throw new BadRequestError("Suggestion not linked to a job (Ad-hoc runs cannot be automatically optimized)");
        }

        // If we have a job, fetch it to ensure it exists (and for config updates)
        let job = null;
        let config: any = {};

        if (jobId) {
            const [foundJob] = await db.select().from(jobs).where(eq(jobs.id, jobId!)).limit(1);
            if (!foundJob) {
                // If the job ID exists but job is missing, that's a data consistency issue
                if (suggestion.type === 'prompt_improvement') {
                    throw new JobNotFoundError(jobId);
                }
                logger.warn(`[AgentOptimization] Job ${jobId} not found, but proceeding with non-critical update`);
            } else {
                job = foundJob;
                config = job.config as any || {};
                console.log("[DEBUG] JOB OBJECT:", JSON.stringify(job, null, 2));
            }
        }

        if (suggestion.type === 'prompt_improvement') {
            if (!job) throw new BadRequestError("Cannot apply prompt improvement: Job context missing");

            // Update the system prompt
            config.systemPrompt = suggestion.content;
            logger.info(`[AgentOptimization] Preparing to update job ${jobId} with new config`);
            try {
                await db.update(jobs).set({
                    config,
                    updatedAt: new Date()
                }).where(eq(jobs.id, jobId!));
                logger.info(`[AgentOptimization] Updated system prompt for job ${jobId}`);
            } catch (err: any) {
                logger.error(`[AgentOptimization] UPDATE FAILED for job ${jobId}:`, err);
                if (err.detail) logger.error(`[AgentOptimization] ERROR DETAIL:`, err.detail);
                throw err;
            }
        } else if (suggestion.type === 'tool_suggestion') {
            // For now, just mark as applied. In future, could add tool hints.
            logger.info(`[AgentOptimization] Marking tool suggestion as applied (no automatic action yet)`);
        }

        await db.update(optimizationSuggestions).set({ status: 'applied' }).where(eq(optimizationSuggestions.id, suggestionId));

        // Audit Logging (Fire and forget, don't block response)
        auditService.log({
            action: 'agent_optimization_applied',
            entityType: 'optimization_suggestion',
            entityId: String(suggestionId),
            userId: '', // Optional: system-level action unless we pass req context
            metadata: {
                type: suggestion.type,
                jobId: jobId
            }
        }).catch(err => logger.error(`[AgentOptimization] Failed to log audit event:`, err));

        return { success: true };
    }

    async generateTestCase(runId: string, jobId: number | null) {
        const steps = await db.select().from(agentRunSteps).where(eq(agentRunSteps.runId, runId));

        if (steps.length === 0) return null;

        const userGoal = steps.find(s => s.type === 'user')?.content || "Unknown Goal";
        const finalResult = steps[steps.length - 1].content;

        const suggestion: InsertOptimizationSuggestion = {
            jobId,
            runId,
            type: 'test_case',
            content: JSON.stringify({
                name: `Test based on Run ${runId.substring(0, 8)}`,
                input: userGoal,
                expectedOutputMatches: finalResult ? finalResult.substring(0, 50) : "Success"
            }, null, 2),
            reasoning: "Generated from successful run history.",
            status: 'pending'
        };

        await db.insert(optimizationSuggestions).values(suggestion);
        return suggestion;
    }
}

export const agentOptimizationService = new AgentOptimizationService();


