import { db } from "@server/database_service.js";
import { jobs, credentials, jobCollections, jobCollectionItems, approvalRequests } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { systemAiService } from "../ai/core/system-ai.service.js";
import { createLogger } from "@server/utils/logger.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("JobSynthesisService");

export interface SynthesisConversation {
  id: string;
  userId: string;
  organizationId: number;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
  currentJobDefinition: any;
  status: 'in_progress' | 'completed' | 'abandoned';
  createdAt: Date;
  updatedAt: Date;
}

const conversations = new Map<string, SynthesisConversation>();
export const jobSynthesisService = {
    /**
     * Synthesize a new Job definition based on a role description.
     */
    async synthesizeJob(role: string, organizationId: number, userId: string, context?: string, suggestedConfig?: any, options: { requireReview?: boolean } = {}): Promise<any> {
        logger.info(`Synthesizing new job for role: ${role}`);

        // Try to find a default credential for this org
        const [defaultCred] = await db.select({ id: credentials.id })
            .from(credentials)
            .where(
                and(
                    eq(credentials.organizationId, organizationId),
                    eq(credentials.type, "ai_provider")
                )
            )
            .limit(1);

        const aiConfig = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-2.0-flash' };

        let apiKey = aiConfig.apiKey || "";
        if (!apiKey) {
            if (aiConfig.provider === 'google') apiKey = developmentProviderKey();
            else if (aiConfig.provider === 'anthropic') apiKey = developmentProviderKey("anthropic");
            else if (aiConfig.provider === 'openai') apiKey = developmentProviderKey("openai");
            else if (aiConfig.provider === 'ollama') apiKey = ""; // Ollama needs no API key
        }

        const aiClient = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: aiConfig.baseUrl } as any);

        const systemPrompt = `You are a Senior Agent Architect.
Your task is to define a new "Job" (an agent template) for a specific role.

INSTRUCTIONS:
1. Generate a descriptive name based specifically on the core function or task the agent performs (e.g., 'Github PR Reviewer', 'SQL Vulnerability Tester', or 'Slack Alert Sender' rather than generic role titles like 'Engineer' or 'Admin'), and a concise, technical description.
2. Select the most appropriate Job Type from: shell, python, ai_agent, curl, human_approval.
3. If 'ai_agent' is selected (recommended for complex roles), provide a comprehensive configuration:
   - 'systemPrompt': A detailed persona instructions and operational constraints.
   - 'goal': A clear, specific objective the agent aims to achieve.
   - 'model': Suggested LLM (default: 'gemini-2.0-flash').
   - 'allowedTools': List of core tool names.

4. DYNAMIC PARAMETERIZATION:
   - Identify static values in the role description (e.g., domain names, targets, specific identifiers) and replace them with {{variable_name}} placeholders in the 'systemPrompt' and 'goal'.
   - Define a 'parameterSchema' (JSON Schema) for these variables.
   - Any variables identified should also be listed in 'config.inputParameters' if appropriate.

5. OUTPUT SCHEMA:
   - Define an 'outputSchema' (JSON Schema) that describes the structured data this agent is expected to produce in its final response.

6. Choose a symbolic Job Tool name (e.g. "Selenium", "Boto3", "NLP-Core").
7. Return a JSON object strictly matching this schema:
{
  "name": "Professional Role Name",
  "description": "Technical description of what this agent does...",
  "type": "ai_agent | shell | python | curl | human_approval",
  "tool": "Tool Name",
  "config": {
     "goal": "Description of the goal (use {{vars}} for dynamic values)",
     "systemPrompt": "Persona and instructions (use {{vars}} for dynamic values)",
     "provider": "google",
     "model": "gemini-2.0-flash",
     "allowedTools": [],
     "rbac": {
       "topicIds": [],
       "datasetIds": [],
       "pipelineIds": []
     },
     "inputParameters": {} 
  },
  "parameterSchema": {},
  "outputSchema": {}
}

CONTEXT:
${context || "No additional context provided."}

CRITICAL: Return ONLY valid JSON. No markdown.`;

        const response = await aiClient.execute({
            userPrompt: `Role to synthesize: ${role}${suggestedConfig ? `\n\nSuggested configuration from architect: ${JSON.stringify(suggestedConfig)}` : ""}`,
            systemPrompt,
            model: aiConfig.model,
            requestType: "json",
            temperature: 0.7,
            useCache: false,
            saveOutputToFile: false
        }, role, apiKey);

        if (!response.success) {
            throw new Error(`Job Synthesis failed: ${response.error}`);
        }

        try {
            const raw = response.output || "{}";

            // Strategy 1: Try direct parse
            let jobDef: any;
            try {
                jobDef = JSON.parse(raw);
            } catch {
                // Strategy 2: Strip markdown code fences
                const stripped = raw.replace(/```(?:json)?\n?/g, "").replace(/\n?```/g, "").trim();
                try {
                    jobDef = JSON.parse(stripped);
                } catch {
                    // Strategy 3: Extract first JSON object via brace matching
                    const startIdx = stripped.indexOf("{");
                    if (startIdx === -1) throw new Error("No JSON object found in synthesis response");
                    let depth = 0;
                    let endIdx = -1;
                    for (let i = startIdx; i < stripped.length; i++) {
                        if (stripped[i] === "{") depth++;
                        else if (stripped[i] === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
                    }
                    if (endIdx === -1) throw new Error("Unbalanced braces in synthesis response");
                    jobDef = JSON.parse(stripped.substring(startIdx, endIdx + 1));
                }
            }

            const parsedName = suggestedConfig?.name || jobDef.name;
            const parsedDescription = suggestedConfig?.description || jobDef.description;
            const parsedType = suggestedConfig?.type || jobDef.type;
            const parsedTool = suggestedConfig?.tool || jobDef.tool;

            // Merge suggested config if provided, incorporating synthesized job config and default credential
            let suggestedJobConfig = {};
            if (suggestedConfig) {
                if (typeof suggestedConfig === "object" && "config" in suggestedConfig) {
                    suggestedJobConfig = suggestedConfig.config || {};
                } else if (typeof suggestedConfig === "object" && ("name" in suggestedConfig || "type" in suggestedConfig || "description" in suggestedConfig)) {
                    // It is a job definition but has no config property
                    suggestedJobConfig = {};
                } else {
                    // It is a plain config object
                    suggestedJobConfig = suggestedConfig;
                }
            }

            const finalConfig = {
                ...(jobDef.config || {}),
                ...(defaultCred ? { credentialId: defaultCred.id } : {}),
                ...suggestedJobConfig
            };

            // If review is required, save as a proposal instead of creating the job
            if (options.requireReview) {
                const [proposal] = await db.insert(approvalRequests).values({
                    executionId: `synthesis-${randomUUID()}`,
                    approverType: "internal",
                    approverId: userId,
                    approverEmail: "system@oddjob.ai", // Placeholder for internal review
                    status: "pending",
                    organizationId,
                    token: randomUUID(),
                    modifiedOutput: {
                        type: "SKILL_PROPOSAL",
                        action: "SKILL_PROPOSAL",
                        role,
                        jobDefinition: jobDef,
                        organizationId,
                        userId
                    }
                }).returning();

                logger.info(`Job synthesis pending review: Proposal ${proposal.id}`);
                return { status: "pending_review", proposalId: proposal.id };
            }

            // Ensure the job name is unique within the organization
            let finalName = parsedName;
            let counter = 1;
            let isUnique = false;

            while (!isUnique) {
                const [existing] = await db.select({ id: jobs.id })
                    .from(jobs)
                    .where(
                        and(
                            eq(jobs.organizationId, organizationId),
                            eq(jobs.name, finalName)
                        )
                    )
                    .limit(1);

                if (existing) {
                    counter++;
                    finalName = `${parsedName} (${counter})`;
                } else {
                    isUnique = true;
                }
            }

            // Create the job in the database
            const [newJob] = await db.insert(jobs).values({
                name: finalName,
                description: parsedDescription,
                type: parsedType,
                tool: parsedTool,
                config: finalConfig,
                parameterSchema: suggestedConfig?.parameterSchema || jobDef.parameterSchema || {},
                outputSchema: suggestedConfig?.outputSchema || jobDef.outputSchema || {},
                organizationId,
                createdBy: userId,
                isActive: true,
                lifecycleStatus: "active"
            }).returning();

            // Create a dedicated collection for this newly synthesized agent
            const [collection] = await db.insert(jobCollections).values({
                name: `Agent: ${newJob.name}`,
                organizationId,
                createdBy: userId,
            }).returning();

            // Link the new agent to its collection
            await db.insert(jobCollectionItems).values({
                collectionId: collection.id,
                jobId: newJob.id,
            });

            logger.info(`Successfully synthesized and saved job: ${newJob.name} (${newJob.id})`);
            return newJob;
        } catch (e: any) {
            const rawPreview = (response.output || "").substring(0, 500);
            logger.error(`Failed to parse synthesized job. Raw output (${(response.output || "").length} chars): ${rawPreview}`, e);
            throw new Error(`Failed to synthesize valid job definition: ${e.message}`);
        }
    },

    /**
     * Finalize job synthesis after approval.
     */
    async finalizeSynthesis(proposalId: number, userId: string): Promise<any> {
        const [proposal] = await db.select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, proposalId))
            .limit(1);

        if (!proposal) throw new NotFoundError("Synthesis proposal not found");
        if (proposal.status !== "approved") throw new BadRequestError("Proposal must be approved before finalization");

        const data = proposal.modifiedOutput as any;
        if (!data || data.action !== "SKILL_PROPOSAL") {
            throw new BadRequestError("Invalid proposal data format");
        }

        logger.info(`Finalizing synthesis for proposal ${proposalId}`);
        return this.synthesizeJob(
            data.role,
            data.organizationId,
            data.userId,
            undefined,
            data.jobDefinition,
            { requireReview: false }
        );
    },

    async startConversation(userId: string, organizationId: number, initialPrompt: string): Promise<string> {
        const conversationId = randomUUID();
        const conversation: SynthesisConversation = {
            id: conversationId,
            userId,
            organizationId,
            messages: [{ role: 'user', content: initialPrompt, timestamp: new Date() }],
            currentJobDefinition: null,
            status: 'in_progress',
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        
        conversations.set(conversationId, conversation);
        
        const jobDef = await this.synthesizeJob(initialPrompt, organizationId, userId);
        conversation.currentJobDefinition = jobDef;
        conversation.messages.push({
            role: 'assistant',
            content: JSON.stringify(jobDef, null, 2),
            timestamp: new Date(),
        });
        
        return conversationId;
    },

    async continueConversation(conversationId: string, userMessage: string): Promise<any> {
        const conversation = conversations.get(conversationId);
        if (!conversation) throw new Error('Conversation not found');
        
        conversation.messages.push({ role: 'user', content: userMessage, timestamp: new Date() });
        
        const refinedDef = await this.refineJobDefinition(
            conversation.currentJobDefinition,
            userMessage,
            conversation.organizationId,
            conversation.userId
        );
        
        conversation.currentJobDefinition = refinedDef;
        conversation.messages.push({ role: 'assistant', content: JSON.stringify(refinedDef, null, 2), timestamp: new Date() });
        conversation.updatedAt = new Date();
        
        return refinedDef;
    },

    async completeConversation(conversationId: string): Promise<any> {
        const conversation = conversations.get(conversationId);
        if (!conversation) throw new Error('Conversation not found');
        
        conversation.status = 'completed';
        
        const job = await this.synthesizeJob(
            "Finalizing conversation based on definition",
            conversation.organizationId,
            conversation.userId,
            undefined,
            conversation.currentJobDefinition,
            { requireReview: false }
        );
        
        setTimeout(() => { conversations.delete(conversationId); }, 24 * 60 * 60 * 1000);
        return job;
    },

    async refineJobDefinition(currentDef: any, userFeedback: string, organizationId: number, userId: string): Promise<any> {
        const aiConfig = await systemAiService.getAiConfig('copilot') || { provider: 'google', model: 'gemini-2.0-flash' };
        let apiKey = aiConfig.apiKey || "";
        if (!apiKey) {
            if (aiConfig.provider === 'google') apiKey = developmentProviderKey();
            else if (aiConfig.provider === 'anthropic') apiKey = developmentProviderKey("anthropic");
            else if (aiConfig.provider === 'openai') apiKey = developmentProviderKey("openai");
        }
        
        const aiClient = AIClientFactory.getClient({ provider: aiConfig.provider, baseUrl: aiConfig.baseUrl } as any);
        
        const systemPrompt = `You are a Job Refinement Specialist.
Your task is to refine an existing job definition based on user feedback.

CURRENT JOB DEFINITION:
${JSON.stringify(currentDef, null, 2)}

USER FEEDBACK:
${userFeedback}

INSTRUCTIONS:
1. Analyze the user feedback and identify what needs to be changed
2. Modify the job definition accordingly
3. Ensure the modified definition is still valid
4. Return ONLY the modified job definition as JSON
5. Ensure the agent name and any sub-components continue to be named dynamically based specifically on the core function or task the agent performs (e.g. 'Github PR Reviewer', 'SQL Vulnerability Tester', or 'Slack Alert Sender' rather than generic role titles like 'Engineer' or 'Admin').

Return valid JSON only, no markdown.`;

        const response = await aiClient.execute({
            userPrompt: 'Refine the job definition based on the feedback',
            systemPrompt,
            model: aiConfig.model,
            requestType: 'json',
            temperature: 0.5,
            useCache: false,
            saveOutputToFile: false,
        } as any, 'job-refinement', apiKey);

        if (!response.success) {
            throw new Error(`Refinement failed: ${response.error}`);
        }

        let jobDef;
        const raw = response.output || "{}";
        try {
            const stripped = raw.replace(/```(?:json)?\n?/g, "").replace(/\n?```/g, "").trim();
            const startIdx = stripped.indexOf("{");
            if (startIdx === -1) throw new Error("No JSON object found");
            let depth = 0, endIdx = -1;
            for (let i = startIdx; i < stripped.length; i++) {
                if (stripped[i] === "{") depth++;
                else if (stripped[i] === "}") { depth--; if (depth === 0) { endIdx = i; break; } }
            }
            jobDef = JSON.parse(stripped.substring(startIdx, endIdx + 1));
        } catch(e) {
            throw new Error("Failed to parse refined definition");
        }
        return jobDef;
    }
};


