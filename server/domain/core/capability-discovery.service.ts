
import { db } from "@server/database_service.js";
import { pipelines, pipelineSteps, jobs, knowledgeTopics, datasets, type Pipeline } from "@shared/schema/index.js";
import { eq, inArray, asc, and, sql } from "drizzle-orm";
import { InputValidationService } from "./input-validation.service.js"; // Assume it's here
import { createLogger } from "@server/utils/logger.js";
import { AGENT_TOOLS } from "../tools/v1/tool-registry.service.js";
import { AgentPersonaService } from "../agents/agent-persona.service.js";
import { type AgentPersona } from "@shared/schema/index.js";

const logger = createLogger("CapabilityDiscoveryService");

export interface DiscoveredCapability {
    name: string;
    description: string;
    id: number;
    parameters: string;
    specialties: string[];
    knowledgeTopics: string[];
    datasets: string[];
    credentials: string[];
    tools: { name: string; description: string }[];
    personaLabel?: string;
}

export class CapabilityDiscoveryService {
    /**
     * Discover capabilities for a set of pipelines.
     */
    static async discoverCapabilities(pipelineIds: number[], orgId: number): Promise<DiscoveredCapability[]> {
        if (!pipelineIds || pipelineIds.length === 0) return [];

        const results: DiscoveredCapability[] = [];

        // 1. Fetch Pipelines
        const targetPipelines = await db.query.pipelines.findMany({
            where: and(
                inArray(pipelines.id, pipelineIds),
                orgId ? eq(pipelines.organizationId, orgId) : undefined
            )
        });

        for (const pipeline of targetPipelines) {
            try {
                // 2. Discover Parameters
                const paramPrompt = await InputValidationService.generateAgentPrompt(pipeline.id);

                // 3. Discover Knowledge (Topics/Datasets) from steps
                const steps = await db.select({
                    jobId: pipelineSteps.jobId,
                    jobConfig: jobs.config,
                    jobType: jobs.type
                })
                    .from(pipelineSteps)
                    .leftJoin(jobs, eq(pipelineSteps.jobId, jobs.id))
                    .where(eq(pipelineSteps.pipelineId, pipeline.id))
                    .orderBy(asc(pipelineSteps.order));

                const topicIds = new Set<number>();
                const datasetIds = new Set<number>();
                const credentialNames = new Set<string>();
                const specialties = new Set<string>();
                const toolNames = new Set<string>();

                for (const step of steps) {
                    const config = step.jobConfig as any;
                    if (!config) continue;

                    // Extract from AI Agents
                    if (step.jobType === 'ai_agent') {
                        const persona = (config.persona as AgentPersona) || 'generic';
                        const template = AgentPersonaService.getTemplate(persona);

                        if (config.topicIds && Array.isArray(config.topicIds)) {
                            config.topicIds.forEach((id: number) => topicIds.add(id));
                        }
                        if (config.datasetIds && Array.isArray(config.datasetIds)) {
                            config.datasetIds.forEach((id: number) => datasetIds.add(id));
                        }

                        // Specialties from config OR persona template
                        const specs = (config.specialties && Array.isArray(config.specialties) && config.specialties.length > 0)
                            ? config.specialties
                            : template.defaultSpecialties;
                        specs.forEach((s: string) => specialties.add(s));

                        // Tools from config AND suggested by persona
                        const tools = [...(config.allowedTools || []), ...template.suggestedTools];
                        tools.forEach((t: string) => toolNames.add(t));
                    }

                    // Extract Credentials
                    if (config?.credentialId) {
                        try {
                            const [cred] = await db.select({ name: sql<string>`name` }).from(sql`credentials`).where(sql`id = ${config.credentialId}`).limit(1);
                            if (cred) credentialNames.add(cred.name as string);
                        } catch (e) {
                            // Ignore if credentials table not accessible
                        }
                    }

                    // Extract from RAG steps in generic jobs
                    if (config.ragConfig?.sources) {
                        config.ragConfig.sources.forEach((s: any) => {
                            if (s.type === 'topic' && s.id) topicIds.add(Number(s.id));
                        });
                    }
                }

                // 4. Resolve Topic/Dataset Names
                let topicNames: string[] = [];
                if (topicIds.size > 0) {
                    const resolvedTopics = await db.query.knowledgeTopics.findMany({
                        where: inArray(knowledgeTopics.id, Array.from(topicIds))
                    });
                    topicNames = resolvedTopics.map(t => t.name);
                }

                let datasetNames: string[] = [];
                if (datasetIds.size > 0) {
                    const resolvedDatasets = await db.query.datasets.findMany({
                        where: inArray(datasets.id, Array.from(datasetIds))
                    });
                    datasetNames = resolvedDatasets.map(d => d.name);
                }

                const firstAiAgent = steps.find(s => s.jobType === 'ai_agent');
                const persona = firstAiAgent ? (firstAiAgent.jobConfig as any).persona : undefined;
                const personaLabel = persona ? AgentPersonaService.getTemplate(persona as AgentPersona).name : undefined;

                results.push({
                    name: pipeline.name,
                    description: pipeline.description || "No description provided.",
                    id: pipeline.id,
                    parameters: paramPrompt,
                    specialties: Array.from(specialties),
                    knowledgeTopics: topicNames,
                    datasets: datasetNames,
                    credentials: Array.from(credentialNames),
                    tools: Array.from(toolNames).map(name => ({
                        name,
                        description: AGENT_TOOLS[name]?.description || "No description available."
                    })),
                    personaLabel
                });

            } catch (err) {
                logger.error(`Failed to discover capabilities for pipeline ${pipeline.id}`, err);
            }
        }

        return results;
    }

    /**
     * Discover capabilities for a set of individual Jobs.
     */
    static async discoverJobCapabilities(jobIds: number[], orgId: number): Promise<DiscoveredCapability[]> {
        if (!jobIds || jobIds.length === 0) return [];

        const results: DiscoveredCapability[] = [];

        const targetJobs = await db.query.jobs.findMany({
            where: and(
                inArray(jobs.id, jobIds),
                orgId ? eq(jobs.organizationId, orgId) : undefined
            )
        });

        for (const job of targetJobs) {
            try {
                const config = job.config as any;
                const topicIds = new Set<number>();
                const datasetIds = new Set<number>();
                const credentialNames = new Set<string>();
                const specialties = new Set<string>();
                const toolNames = new Set<string>();
                let personaLabel: string | undefined;

                if (job.type === 'ai_agent') {
                    const persona = (config?.persona as AgentPersona) || 'generic';
                    const template = AgentPersonaService.getTemplate(persona);
                    personaLabel = template.name;

                    if (config?.topicIds && Array.isArray(config.topicIds)) {
                        config.topicIds.forEach((id: number) => topicIds.add(id));
                    }
                    if (config?.datasetIds && Array.isArray(config.datasetIds)) {
                        config.datasetIds.forEach((id: number) => datasetIds.add(id));
                    }

                    const specs = (config?.specialties && Array.isArray(config.specialties) && config.specialties.length > 0)
                        ? config.specialties
                        : template.defaultSpecialties;
                    specs.forEach((s: string) => specialties.add(s));

                    const tools = [...(config?.allowedTools || []), ...template.suggestedTools];
                    tools.forEach((t: string) => toolNames.add(t));
                }

                if (config?.ragConfig?.sources) {
                    config.ragConfig.sources.forEach((s: any) => {
                        if (s.type === 'topic' && s.id) topicIds.add(Number(s.id));
                    });
                }

                // Extract Credentials
                if (config?.credentialId) {
                    try {
                        const [cred] = await db.select({ name: sql<string>`name` }).from(sql`credentials`).where(sql`id = ${config.credentialId}`).limit(1);
                        if (cred) credentialNames.add(cred.name as string);
                    } catch (e) {
                        // Ignore
                    }
                }

                let topicNames: string[] = [];
                if (topicIds.size > 0) {
                    const resolvedTopics = await db.query.knowledgeTopics.findMany({
                        where: inArray(knowledgeTopics.id, Array.from(topicIds))
                    });
                    topicNames = resolvedTopics.map(t => t.name);
                }

                let datasetNames: string[] = [];
                if (datasetIds.size > 0) {
                    const resolvedDatasets = await db.query.datasets.findMany({
                        where: inArray(datasets.id, Array.from(datasetIds))
                    });
                    datasetNames = resolvedDatasets.map(d => d.name);
                }

                results.push({
                    name: job.name,
                    description: job.description || "No description provided.",
                    id: job.id,
                    parameters: InputValidationService.generateJobParameterPrompt(job.parameterSchema),
                    specialties: Array.from(specialties),
                    knowledgeTopics: topicNames,
                    datasets: datasetNames,
                    credentials: Array.from(credentialNames),
                    tools: Array.from(toolNames).map(name => ({
                        name,
                        description: AGENT_TOOLS[name]?.description || "No description available."
                    })),
                    personaLabel
                });
            } catch (err) {
                logger.error(`Failed to discover capabilities for job ${job.id}`, err);
            }
        }

        return results;
    }

    /**
     * Format discovered capabilities into a string for LLM context.
     */
    static formatCapabilityCatalog(capabilities: DiscoveredCapability[]): string {
        if (capabilities.length === 0) return "No workers available.";

        return capabilities.map(c => {
            let info = `### WORKER: [${c.name}](#tool:${c.id})\n`;
            if (c.personaLabel) info += `**Role**: ${c.personaLabel}\n`;
            info += `**Description**: ${c.description}\n`;

            if (c.specialties.length > 0) {
                info += `**Specialties**: ${c.specialties.join(", ")}\n`;
            }

            if (c.knowledgeTopics.length > 0 || c.datasets.length > 0 || c.tools.length > 0 || c.credentials.length > 0) {
                info += `**Knowledge & Tools Access**:\n`;
                if (c.knowledgeTopics.length > 0) info += `- Topics: ${c.knowledgeTopics.join(", ")}\n`;
                if (c.datasets.length > 0) info += `- Datasets: ${c.datasets.join(", ")}\n`;
                if (c.credentials.length > 0) info += `- Working Credentials: ${c.credentials.join(", ")}\n`;
                if (c.tools.length > 0) info += `- Tools: ${c.tools.map(t => t.name).join(", ")}\n`;
            }

            if (c.parameters) {
                info += `\n**Required Inputs**:\n${c.parameters.replace("This pipeline requires the following input parameters:\n\n", "")}\n`;
            }

            return info;
        }).join("\n---\n");
    }

    /**
     * Rank and prune capabilities based on a target intent or prompt context.
     * This ensures the LLM context window is not overwhelmed.
     */
    static rankAndPruneCapabilities(capabilities: DiscoveredCapability[], intent: string, maxLimit = 10): DiscoveredCapability[] {
        if (!intent || capabilities.length <= maxLimit) return capabilities;

        const lowerIntent = intent.toLowerCase();

        // Simple heuristic: rank by keyword overlap with specialties, name, and description
        const scored = capabilities.map(c => {
            let score = 0;
            if (lowerIntent.includes(c.name.toLowerCase())) score += 10;

            c.specialties.forEach(s => {
                if (lowerIntent.includes(s.toLowerCase())) score += 5;
            });

            if (c.personaLabel && lowerIntent.includes(c.personaLabel.toLowerCase())) score += 5;

            // Add slight random jitter to break ties
            score += Math.random() * 0.1;

            return { capability: c, score };
        });

        // Sort descending by score
        scored.sort((a, b) => b.score - a.score);

        // Take top N
        return scored.slice(0, maxLimit).map(s => s.capability);
    }
}




