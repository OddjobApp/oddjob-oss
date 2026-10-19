import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { withResilience } from "../../ai/core/resilience-proxy.js";
import type { ForgeOptions } from "../app-forge.service.js";
import { tryFixJson, getErrorContext } from "../../../../shared/utils/jsonUtils.js";
import { memeticLearningService } from "../../learning/core/memetic-learning.service.js";
import type { AIClient } from "@domain/ai/core/ai-client.service.js";
import type { AiConfig } from "@domain/ai/core/ai-config-resolver.js";

const logger = createLogger("ForgePlanService");
type ForgeAiConfig = Pick<AiConfig, "model"> & Partial<Omit<AiConfig, "model">>;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Per-call AI timeout for planning operations.
 */
const AI_CALL_TIMEOUT_MS = 1_200_000; // Increased to 1200s (20m) for local LLM stability
const withAiTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
    Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`AI planning call timed out after ${AI_CALL_TIMEOUT_MS / 1000}s [${label}]`)), AI_CALL_TIMEOUT_MS)
        )
    ]);

export interface DevelopmentPlan {
    overview: string;
    phases: {
        name: string;
        description: string;
        tasks: string[];
    }[];
    techStack: string[];
    integrationStrategy: string;
    uxDescription: string;
    mockStrategy: Record<string, string>;
}

export interface ClarifyingQuestion {
    id: string;
    question: string;
    context: string;
    suggestedAnswers?: string[];
}

export interface ArchitectureProposal {
    services: {
        name: string;
        purpose: string;
        endpoints: { path: string; method: string; description: string }[];
    }[];
    components: {
        name: string;
        type: 'page' | 'shared' | 'module';
        description: string;
        dependencies: string[];
        platformBlockId?: string; // ID from block-registry.json if applicable
    }[];
    dataModels: {
        name: string;
        fields: { name: string; type: string; required: boolean }[];
    }[];
    capabilityMapping: {
        requirement: string;
        oddjobCapability: 'missions' | 'pipelines' | 'datasets' | 'forms' | 'agents' | 'knowledge' | 'hil' | 'custom';
        platformBlockId?: string;
        rationale: string;
    }[];
}

export interface BuildTask {
    id: string;
    waveId: number;
    title: string;
    description: string;
    files: string[];
    dependencies: string[];
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
}

export interface Wave {
    id: number;
    title: string;
    description: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    tasks: BuildTask[];
    costEstimate?: string;
    timeEstimate?: string;
}

export interface WavePlan {
    overview: string;
    waves: Wave[];
    strategyHypothesis?: string; // Which branch this plan represents
    critiqueScore?: number;
}

export const forgePlanService = {
    /**
     * Requirements Decomposition
     *
     * Converts a freeform description into a concrete, numbered feature spec.
     */
    async decomposeRequirements(
        description: string,
        blueprintSlug: string,
        aiConfig: ForgeAiConfig,
        client: AIClient,
        ragContext?: string,
        visualDirectives?: string,
        granularity: number = 1.0,
        emitLog?: (m: string, l?: any) => Promise<void>,
        vNextManifest?: any,
        interactionModel?: string
    ): Promise<string> {
        try {
            const maxItems = Math.round(20 * granularity);
            const result = await withAiTimeout(client.execute({
                model: aiConfig.model,
                systemPrompt: `You are a senior product architect. Convert an app description into a structured, numbered feature specification.
Be specific and concrete. Each item should describe one tangible feature or UI component the developer MUST build.
Include: chart types with their axes/data, specific interactive controls, API endpoints, component names, and visual elements.
Output: a numbered list only. No prose, no headers, no markdown formatting. ${maxItems} items maximum.`,
                userPrompt: `Blueprint type: ${blueprintSlug}
App description: ${description}
Primary interaction model: ${interactionModel || "unspecified"}

${interactionModel === "form-workbench" ? `FORM-FIRST DIRECTIVE:
This app is an operational workbench. The primary UI MUST be structured forms, review tables, approval/signoff panels, validation states, and mission-routing actions. Chat may appear only as a secondary copilot/helper surface, never as the main experience.
` : ""}

${ragContext ? `FUNCTIONAL SPECIFICATIONS (Source: User Documents):\n${ragContext}\n` : ""}
${visualDirectives ? `VISUAL DESIGN DIRECTIVES (Source: User Mockups):\n${visualDirectives}\n` : ""}
${vNextManifest ? `BLUEPRINT MANIFEST OVERRIDE:\nThe following JSON manifest explicitly defines the expected screens, slugs, and structure of this app. YOU MUST ensure your generated feature list strictly implements every screen and capability defined in this JSON:\n${JSON.stringify(vNextManifest)}\n` : ""}

Use the provided source documents, mockups, and blueprint manifest as the PRIMARY source of truth. If they conflict with the general description, follow the specific assets.`,
                requestType: "text",
                responseType: "text",
                maxTokens: 800,
            } as any, undefined, aiConfig.apiKey ?? "", undefined, undefined, (m: any) => {
                if (emitLog) emitLog(`[Reasoning] Heartbeat: ${Math.round(m.elapsedMs / 1000)}s elapsed...`, 'info');
            }), "decompose-requirements") as any;

            if (result.success && result.output) {
                let output = result.output.trim();
                // Ensure we have a numbered list
                if (output.includes("\n1.") || output.includes("\n-") || output.includes("\n*")) {
                    const listStart = output.search(/(?:^|\n)(?:\d+\.|\*|-|\[\d+\])\s/m);
                    if (listStart !== -1) {
                        output = output.substring(listStart).trim();
                    }
                }
                
                // Quality check: if AI returned too little, it likely failed to decompose properly
                const itemCount = (output.match(/(?:^|\n)(?:\d+\.|\*|-|\[\d+\])\s/g) || []).length;
                if (itemCount < 3 && description.length > 50) {
                    logger.warn(`[Decompose] AI returned only ${itemCount} items for a ${description.length} char description. Using raw description as fallback.`);
                    return `1. ${description.replace(/\n/g, ' ')}`;
                }

                return output;
            }
            return description; // Fallback to raw description
        } catch (err: any) {
            logger.warn(`[Decompose] Failed: ${err.message}. Using raw description.`);
            return description;
        }
    },

    /**
     * Tree Search Planning (Pillar 3): Branching Strategy Generation.
     * Evaluates candidate strategies via competitive critique and selects the winner.
     */
    async critiqueCandidatePlans(
        candidatePlans: WavePlan[],
        features: string,
        aiConfig: ForgeAiConfig,
        client: AIClient,
        emitLog?: (m: string, l?: any) => Promise<void>
    ): Promise<WavePlan> {
        if (candidatePlans.length === 0) {
            throw new Error("critiqueCandidatePlans requires at least one candidate plan");
        }
        await emitLog?.("Competitive Critique: Evaluating candidate strategies...", 'info');
        
        const critiquePrompt = `
            Evaluate the following build strategies for an app with these features: ${features.substring(0, 500)}
            
            CANDIDATES:
            ${candidatePlans.map((p, i) => `[${i}] Strategy: ${p.strategyHypothesis}\nOverview: ${p.overview}`).join('\n\n')}
            
            Select the index of the winner based on:
            1. Risk/Reward ratio.
            2. Speed to initial deployment.
            3. Alignment with premium industrial standards.
            
            Return JSON: { "winnerIndex": number, "rationale": "..." }
        `;

        try {
            const critiqueResult = await client.execute({
                model: aiConfig.model,
                systemPrompt: "You are the Strategic Auditor.",
                userPrompt: critiquePrompt,
                requestType: "json",
                responseType: "json"
            } as any, undefined, aiConfig.apiKey ?? "", undefined, undefined, (m: any) => {
                if (emitLog) emitLog(`[Reasoning] Heartbeat: ${Math.round(m.elapsedMs / 1000)}s elapsed...`, 'info');
            }) as any;

            if (critiqueResult.success && critiqueResult.output) {
                const { winnerIndex, rationale } = typeof critiqueResult.output === 'string' ? JSON.parse(critiqueResult.output) : critiqueResult.output;
                const winner = candidatePlans[winnerIndex] || candidatePlans[0];
                await emitLog?.(`Winner Selected: ${winner.strategyHypothesis}. Rationale: ${rationale}`, 'success');
                
                // Ensure waves/tasks are hydrated
                winner.waves = (winner.waves || []).map((w: any) => ({
                    ...w,
                    status: 'pending',
                    tasks: (w.tasks || []).map((t: any) => ({ ...t, waveId: w.id, status: 'pending' }))
                }));

                return winner;
            }
        } catch (err) {
            logger.warn("Critique pass failed, falling back to first candidate.");
        }

        return candidatePlans[0];
    },

    /**
     * Tree Search Planning (Pillar 3): Branching Strategy Generation.
     * Generates multiple build hypotheses and selects the winner via competitive critique.
     */
    async generateBranchingWavePlan(
        features: string,
        aiConfig: ForgeAiConfig,
        client: AIClient,
        granularity: number = 1.0,
        emitLog?: (m: string, l?: any) => Promise<void>,
        organizationId?: number,
        blueprintSlug?: string
    ): Promise<WavePlan> {
        await emitLog?.("Strategic Sentinel: Generating branching assembly hypotheses (Tree Search)...", 'info');
        
        const relevantMemes = await memeticLearningService.getRelevantMemes({ features }, organizationId);

        const hypotheses = [
            { id: "industrial", focus: "Industrial Stability: Leverage platform blocks and standard routes." },
            { id: "bespoke", focus: "Bespoke Innovation: High custom UI and unique data flows." },
            { id: "lean", focus: "Lean Execution: Minimal Marketable Feature (MMF) first." }
        ];

        const candidatePlans: WavePlan[] = [];
        const isDockerApp = ["go-backend", "python-backend", "java-backend"].includes(blueprintSlug || "");

        for (const hyp of hypotheses) {
            await emitLog?.(`Rolling out hypothesis: ${hyp.id}...`, 'info');
            try {
                const result = await client.execute({
                    model: aiConfig.model,
                    systemPrompt: `You are a Lead Software Architect. Generate a build plan for the following hypothesis: ${hyp.focus}
                    ${isDockerApp ? `This project is a containerized backend template for: ${blueprintSlug}. Generate tasks with files suitable for this language/framework, not standard Next.js files.` : ''}
                    
                    ${relevantMemes ? `--- INSTITUTIONAL MEMORY ---\n${relevantMemes}\n---------------------------` : ''}
                    
Return exactly 3 Waves. Output ONLY valid JSON.`,
                    userPrompt: `Features: ${features}`,
                    requestType: "json",
                    responseType: "json"
                } as any, undefined, aiConfig.apiKey ?? "") as any;

                if (result.success && result.output) {
                    const plan = (typeof result.output === 'string' ? JSON.parse(result.output) : result.output) as WavePlan;
                    plan.strategyHypothesis = hyp.id;
                    candidatePlans.push(plan);
                }
            } catch (err: any) {
                logger.warn(`Hypothesis ${hyp.id} failed: ${err?.message || String(err)}`);
            }
        }

        if (candidatePlans.length === 0) {
            return this.generateWavePlan(features, aiConfig, client, granularity, emitLog, undefined, undefined, blueprintSlug);
        }

        return this.critiqueCandidatePlans(candidatePlans, features, aiConfig, client, emitLog);
    },

    /**
     * Generates a Wave-Based Build Plan (Linear).
     */
    async generateWavePlan(
        features: string,
        aiConfig: ForgeAiConfig,
        client: AIClient,
        granularity: number = 1.0,
        emitLog?: (m: string, l?: any) => Promise<void>,
        userAnswers?: string,
        architecture?: ArchitectureProposal,
        blueprintSlug?: string
    ): Promise<WavePlan> {
        await emitLog?.("Wave Architect: Designing progressive assembly plan...", 'info');
        
        const isDockerApp = ["go-backend", "python-backend", "java-backend"].includes(blueprintSlug || "");
        const retryInstruction = `
CRITICAL: Categorize tasks into exactly 3 Waves:
Wave 1: MMF (Minimum Marketable Feature) - Core logic, routes, and skeleton.
Wave 2: Functional Expansion - Secondary features, complex integrations.
Wave 3: Aesthetic & Polish - ${isDockerApp ? 'Internal tests, logging, telemetry, and self-documentation' : 'Premium design, animations, and UX refinement'}.`;

        const userAnswersContext = userAnswers ? `\n\nUSER CLARIFICATIONS:\n${userAnswers}` : '';
        const archContext = architecture ? `\n\nPROPOSED ARCHITECTURE:\n${JSON.stringify(architecture.components)}` : '';

        const result = await withAiTimeout(client.execute({
            model: aiConfig.model,
            systemPrompt: `You are a Lead Software Planner. Convert app features into a Wave-Based Build Plan.
${retryInstruction}
Return ONLY a valid JSON object. 
Schema: {
  "overview": "Summary of build strategy",
  "waves": [
    {
      "id": 1,
      "title": "...",
      "description": "...",
      "tasks": [{ "id": "task-N", "title": "...", "description": "...", "files": ["..."], "dependencies": ["..."] }]
    }
  ]
}`,
            userPrompt: `REQUIREMENTS/PLAN:\n${features}${userAnswersContext}${archContext}`,
            requestType: "json",
            responseType: "json",
            maxTokens: 4096,
        } as any, undefined, aiConfig.apiKey ?? "", undefined, undefined, (m: any) => {
            if (emitLog) emitLog(`[Reasoning] Heartbeat: ${Math.round(m.elapsedMs / 1000)}s elapsed...`, 'info');
        }), "generate-wave-plan") as any;

        if (result.success && result.output) {
            try {
                const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
                const fixResult = tryFixJson(raw);
                const plan = JSON.parse(fixResult ? fixResult.fixed : raw);
                // Ensure status is set for all tasks/waves
                plan.waves = (plan.waves || []).map((w: any) => ({
                    ...w,
                    status: 'pending',
                    tasks: (w.tasks || []).map((t: any) => ({ ...t, waveId: w.id, status: 'pending' }))
                }));
                return plan as WavePlan;
            } catch (err) {
                logger.error("[WavePlan] Failed to parse AI wave plan", { error: (err as any).message });
            }
        }

        // Fallback: Group flat tasks into waves manually if AI fails
        const flatTasks = await this.generateBuildPlan(features, aiConfig, client, granularity, emitLog, userAnswers, architecture, blueprintSlug);
        return {
            overview: "Sequential fallback plan (MMF Focused)",
            waves: [
                {
                    id: 1,
                    title: "MMF Foundation",
                    description: "Core assembly of primary features.",
                    status: 'pending',
                    tasks: flatTasks.map(t => ({ ...t, waveId: 1 }))
                }
            ]
        };
    },

    /**
     * Converts a feature specification into a structured build queue (Flat).
     */
    async generateBuildPlan(
        features: string,
        aiConfig: ForgeAiConfig,
        client: AIClient,
        granularity: number = 1.0,
        emitLog?: (m: string, l?: any) => Promise<void>,
        userAnswers?: string,
        architecture?: ArchitectureProposal,
        blueprintSlug?: string
    ): Promise<BuildTask[]> {
        const maxRetries = 2;
        const isDockerApp = ["go-backend", "python-backend", "java-backend"].includes(blueprintSlug || "");
        
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                // Calculate complexity score based on feature list and description length
                const featureLines = features.split('\n').filter(l => /^\d+\.\s+/.test(l.trim())).length;
                const descLength = features.length;
                const complexityScore = Math.max(1, Math.min(4, (featureLines * 0.8) + (descLength / 1000)));
                
                const targetTasks = Math.round(4 * granularity * complexityScore);
                const maxFiles = granularity > 1.5 ? 1 : 2;
                
                const retryInstruction = attempt > 0 
                    ? `\n\nCRITICAL RETRY: Your previous response was either malformed JSON or contained conversational text. 
DO NOT explain yourself. Start your response exactly with the character '[' and end exactly with the character ']'.` 
                    : '';
                
                const userAnswersContext = userAnswers ? `\n\nUSER CLARIFICATIONS:\n${userAnswers}` : '';
                const archContext = architecture ? `\n\nPROPOSED ARCHITECTURE:\n${JSON.stringify(architecture.components)}` : '';

                const fileSchemaHint = isDockerApp
                    ? `For ${blueprintSlug}, generate tasks targeting files appropriate for the backend language (e.g. main.go, main.py, requirements.txt, src/main/java/...). Do NOT use React/Next.js pages/index.tsx files.`
                    : `Schema: [{ "id": "task-N", "title": "...", "description": "...", "files": ["pages/index.tsx", ...], "dependencies": ["task-M"] }]`;

                const result = await withAiTimeout(client.execute({
                    model: aiConfig.model,
                    systemPrompt: `You are a Lead Software Planner. Convert a list of app features and requirements into a JSON build queue.
Break the work into ${targetTasks}-${targetTasks + 2} distinct logical tasks (chunks).
Each task should focus on ${maxFiles} file(s) maximum.
CRITICAL: Your response must be ONLY a valid JSON array. The response must start with '[' and end with ']'.
${fileSchemaHint}${retryInstruction}`,
                    userPrompt: `REQUIREMENTS/PLAN:\n${features}${userAnswersContext}${archContext}`,
                    requestType: "text",
                    responseType: "text",
                    maxTokens: 1000,
                } as any, undefined, aiConfig.apiKey ?? "", undefined, undefined, (m: any) => {
                    if (emitLog) emitLog(`[Reasoning] Heartbeat: ${Math.round(m.elapsedMs / 1000)}s elapsed...`, 'info');
                }), `build-plan-attempt-${attempt}`) as any;

                if (result.success && result.output) {
                    const raw = result.output.trim();
                    let jsonStr: string | null = null;
                    const arrayMatch = raw.match(/(\[\s*\{[\s\S]*\}\s*\])/);
                    if (arrayMatch) jsonStr = arrayMatch[1];
                    else if (raw.includes('```')) {
                        const blockMatch = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
                        if (blockMatch) jsonStr = blockMatch[1].trim();
                    }
                    if (!jsonStr) {
                        const fallbackMatch = raw.match(/(\[[\s\S]*\])/);
                        if (fallbackMatch) jsonStr = fallbackMatch[1];
                    }
                    
                    if (jsonStr) {
                        const fixed = tryFixJson(jsonStr);
                        if (fixed) {
                            try {
                                const tasks = JSON.parse(fixed.fixed) as BuildTask[];
                                if (tasks.length > 0) {
                                    return tasks.map(t => ({ ...t, status: 'pending', waveId: 1 }));
                                }
                            } catch {
                                if (attempt < maxRetries) continue;
                            }
                        }
                    }
                }
            } catch (err: any) {
                if (attempt < maxRetries) continue;
            }
        }

        // Emergency Plan B: If features didn't work, try to generate tasks directly from architecture
        if (architecture?.components && architecture.components.length > 0) {
            logger.info("[BuildPlan] AI planning failed, generating tasks from architecture components...");
            return architecture.components.map((comp, idx) => ({
                id: `task-arch-${idx}`,
                waveId: 1,
                title: comp.name,
                description: comp.description,
                files: comp.type === 'page' ? [`pages/${comp.name.toLowerCase()}.tsx`] : [`components/${comp.name.toLowerCase()}.tsx`],
                dependencies: comp.dependencies || [],
                status: 'pending'
            }));
        }

        return [];
    },

    /**
     * Generates a structured development plan based on requirements and assets.
     */
    async generateDevelopmentPlan(options: ForgeOptions, context: string): Promise<DevelopmentPlan> {
        logger.info(`Generating development plan for ${options.slug}...`);

        const aiConfig = await systemAiService.getAiConfig('architect', options.organizationId);
        if (!aiConfig) throw new Error("AI Configuration (architect) not found");

        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const systemPrompt = `You are the Oddjob Lead Architect. 
Your task is to translate high-level user requirements into a structured, autonomous development plan.
Oddjob uses a "Blueprint-First" approach.

RULES:
1. Adhere to Oddjob's design system (Glassmorphism, High-Fidelity, Premium).
2. Leverage Oddjob's internal services (Knowledge Graph, Mission Control, etc.).
3. Explicitly define which parts will be mocked and which will be real.
4. Be specific about the UI structure and UX flow.

RETURN JSON ONLY.`;

        const userPrompt = `
APP NAME: ${options.name}
SLUG: ${options.slug}
DESCRIPTION: ${options.description}

RESEARCH CONTEXT:
${context}

Generate a structured DevelopmentPlan JSON object:
{
  "overview": "Summary of the app purpose and vision",
  "phases": [
    { "name": "Phase Name", "description": "Goal", "tasks": ["Task 1", "Task 2"] }
  ],
  "techStack": ["Next.js", "Tailwind", "Oddjob UI", ...],
  "integrationStrategy": "Detailed explanation of how this app integrates with system services",
  "uxDescription": "Narrative of the user journey and visual aesthetic",
  "mockStrategy": { "ServiceName": "Reason for mocking" }
}
`;

        const result = await withResilience(() => withAiTimeout(aiClient.execute({
            model: aiConfig.model,
            systemPrompt,
            userPrompt,
            requestType: "json",
            responseType: "json",
            maxTokens: 4096
        } as any, undefined, aiConfig.apiKey ?? ""), "generate-development-plan"));

        if (!result.success || !result.output) {
            throw new Error(`Plan generation failed: ${result.error}`);
        }

        try {
            const plan = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
            return plan as DevelopmentPlan;
        } catch (err) {
            logger.error("Failed to parse AI plan output", { output: result.output });
            throw new Error("Malformed plan JSON returned from AI");
        }
    },

    /**
     * Identifies ambiguities in the request that require user clarification.
     */
    async extractClarifyingQuestions(options: ForgeOptions, context: string): Promise<ClarifyingQuestion[]> {
        logger.info(`Extracting clarifying questions for ${options.slug}...`);

        const aiConfig = await systemAiService.getAiConfig('architect', options.organizationId);
        if (!aiConfig) return [];

        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const systemPrompt = `You are the Oddjob Requirement Discovery Agent. 
Review the user request and research context. Identify critical ambiguities that would prevent an accurate build.
Return a list of ClarifyingQuestions.

Rules:
1. Only ask high-impact questions.
2. Provide context for why you are asking.
3. Suggest 2-3 possible answers.

RETURN JSON ONLY.`;

        const userPrompt = `
APP: ${options.name}
DESC: ${options.description}
CONTEXT: ${context}

Format: { "questions": [{ "id": "uuid", "question": "...", "context": "...", "suggestedAnswers": ["..."] }] }
`;

        const result = await withResilience(() => withAiTimeout(aiClient.execute({
            model: aiConfig.model,
            systemPrompt,
            userPrompt,
            requestType: "json",
            responseType: "json"
        } as any, undefined, aiConfig.apiKey ?? "", undefined, undefined, (m: any) => {
            // Clarification extraction doesn't usually have an emitLog passed, but we'll use a local logger if we wanted.
            // For now, let's assume we might pass it in the future.
        }), "extract-clarifying-questions"));

        if (!result.success || !result.output) return [];

        try {
            const data = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
            return data.questions || [];
        } catch {
            return [];
        }
    },
    /**
     * Generates a proposed technical architecture for the app.
     */
    async generateArchitectureProposal(
        options: ForgeOptions, 
        plan: DevelopmentPlan, 
        context: string, 
        emitLog?: (m: string, l?: any) => Promise<void>,
        blueprintSlug?: string
    ): Promise<ArchitectureProposal> {
        logger.info(`Generating architecture proposal for ${options.slug}...`);

        const aiConfig = await systemAiService.getAiConfig('architect', options.organizationId);
        if (!aiConfig) throw new Error("AI Configuration (architect) not found");

        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const { readFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const registryPath = join(process.cwd(), "server", "domain", "apps", "core", "block-registry.json");
        const blockRegistry = JSON.parse(readFileSync(registryPath, "utf-8"));

        const isDockerApp = ["go-backend", "python-backend", "java-backend"].includes(blueprintSlug || "");
        const techPrompt = isDockerApp
            ? `INDUSTRIAL ASSEMBLY: Map requirements to backend services, endpoints, data models, and logic files appropriate for ${blueprintSlug} (e.g. main.go, main.py, src/main/java/...). Do NOT use React/Next.js/HTML components.`
            : `INDUSTRIAL ASSEMBLY: Prioritize "Self-Wiring" Platform Blocks from the registry.
AVAILABLE BLOCKS: ${JSON.stringify(blockRegistry.blocks.map((b: any) => ({ id: b.id, name: b.name, cat: b.category })), null, 0)}`;

        const systemPrompt = `You are the Oddjob Lead Systems Architect. 
Your task is to define the specific technical architecture for a new application.
${isDockerApp ? `Oddjob uses containerized ${blueprintSlug} runtimes.` : `Oddjob uses Next.js with a modular domain-driven architecture.`}

${techPrompt}

Define:
1. Service Layer (API Routes / Endpoints)
2. Component Hierarchy (UI structure or file structure)
3. Data Models (Core schemas)
4. Capability Mapping

CRITICAL: Return ONLY valid JSON. No markdown, no "here is your JSON", no explanations. Your response MUST start with '{' and end with '}'.
`;

        const userPrompt = `You are a Principal Solutions Architect at Oddjob.
Generate a technical architecture proposal for an application based on these requirements:
APP: ${options.name} (${options.slug})
DESCRIPTION: ${options.description}
${plan ? `PLAN:\n${typeof plan === 'string' ? plan : JSON.stringify(plan)}` : ''}
CONTEXT: ${context}
${blueprintSlug ? `BLUEPRINT: ${blueprintSlug}` : ''}

Keep the architecture concise, highly structured, and focused:
- Define 2 core services with clean REST endpoints.
- Define 3 to 4 core UI components directly mapping to platform Component Gallery blocks: IndustrialDashboardHero, MetricGrid, StatusTimeline, MissionControlTable.
- Define 1 or 2 core data models with key fields.
- Define 2 to 3 capability mappings linking requirements to Oddjob platform capabilities.

Output ONLY a valid JSON object following this exact schema:
{
  "services": [{ "name": "...", "purpose": "...", "endpoints": [{ "path": "...", "method": "...", "description": "..." }] }],
  "components": [{ "name": "...", "type": "page|shared|module", "description": "...", "dependencies": ["..."], "platformBlockId": "..." }],
  "dataModels": [{ "name": "...", "fields": [{ "name": "...", "type": "...", "required": true }] }],
  "capabilityMapping": [{ "requirement": "...", "oddjobCapability": "missions|pipelines|datasets|forms|agents|knowledge|hil|custom", "platformBlockId": "...", "rationale": "..." }]
}
`;

        const result = await withResilience(() => withAiTimeout(aiClient.execute({
            model: aiConfig.model,
            systemPrompt,
            userPrompt,
            requestType: "json",
            responseType: "json",
            maxTokens: 16384
        } as any, undefined, aiConfig.apiKey ?? "", undefined, undefined, (m: any) => {
            if (emitLog) emitLog(`[Reasoning] Heartbeat: ${Math.round(m.elapsedMs / 1000)}s elapsed...`, 'info');
        }), "generate-architecture-proposal"));

        if (!result.success || !result.output) {
            throw new Error(`Architecture generation failed: ${result.error}`);
        }

        try {
            const raw = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
            
            // Robust JSON extraction
            let jsonStr = raw.trim();
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) jsonStr = jsonMatch[0];

            const fixed = tryFixJson(jsonStr);
            const proposal = JSON.parse(fixed ? fixed.fixed : jsonStr);
            if (proposal && Array.isArray(proposal.components) && proposal.components.length > 0) {
                return proposal as ArchitectureProposal;
            }
            throw new Error("Architecture proposal missing required component array");
        } catch (err) {
            logger.warn("Failed to parse architecture proposal output, constructing gallery-backed fallback proposal", { 
                error: (err as any).message,
                outputSnippet: typeof result.output === 'string' ? result.output.substring(0, 500) : "N/A"
            });
            // Resilient fallback mapping directly to Component Gallery blocks
            return {
                services: [
                    {
                        name: `${options.name} Service`,
                        purpose: "Core operational API service",
                        endpoints: [
                            { path: `/api/${options.slug}/records`, method: "GET", description: "List records" },
                            { path: `/api/${options.slug}/records`, method: "POST", description: "Create record" }
                        ]
                    }
                ],
                components: [
                    { name: "Executive KPI Summary", type: "module", description: "Industrial KPI header and metric cards", dependencies: [], platformBlockId: "IndustrialDashboardHero" },
                    { name: "Metric Grid", type: "module", description: "Real-time metric telemetry grid", dependencies: [], platformBlockId: "MetricGrid" },
                    { name: "Recent Activity Timeline", type: "module", description: "Status activity timeline", dependencies: [], platformBlockId: "StatusTimeline" },
                    { name: "Mission Control Table", type: "page", description: "Operational record management table", dependencies: [], platformBlockId: "MissionControlTable" }
                ],
                dataModels: [
                    {
                        name: "OperationalRecord",
                        fields: [
                            { name: "id", type: "string", required: true },
                            { name: "name", type: "string", required: true },
                            { name: "status", type: "string", required: true },
                            { name: "value", type: "string", required: false }
                        ]
                    }
                ],
                capabilityMapping: [
                    { requirement: "Real-time metrics", oddjobCapability: "telemetry", platformBlockId: "MetricGrid", rationale: "Telemetry streaming" },
                    { requirement: "Records management", oddjobCapability: "datasets", platformBlockId: "MissionControlTable", rationale: "Dataset CRUD management" }
                ]
            } as ArchitectureProposal;
        }
    },

    /**
     * Extracts technical review questions for the proposed architecture.
     */
    async extractArchitectureQuestions(options: ForgeOptions, proposal: ArchitectureProposal): Promise<ClarifyingQuestion[]> {
        logger.info(`Extracting architecture review questions for ${options.slug}...`);

        const aiConfig = await systemAiService.getAiConfig('architect', options.organizationId);
        if (!aiConfig) return [];

        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const systemPrompt = `You are the Oddjob Technical Auditor. 
Review the proposed architecture and identify technical risks or integration ambiguities.
Return a list of ClarifyingQuestions.

Rules:
1. Focus on technical implementation details (APIs, state management, data flow).
2. Suggest technical trade-offs.

RETURN JSON ONLY.`;

        const userPrompt = `
PROPOSAL: ${JSON.stringify(proposal)}

Format: { "questions": [{ "id": "uuid", "question": "...", "context": "...", "suggestedAnswers": ["..."] }] }
`;

        const result = await withResilience(() => withAiTimeout(aiClient.execute({
            model: aiConfig.model,
            systemPrompt,
            userPrompt,
            requestType: "json",
            responseType: "json"
        } as any, undefined, aiConfig.apiKey ?? ""), "extract-architecture-questions"));

        if (!result.success || !result.output) return [];

        try {
            const data = typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
            return data.questions || [];
        } catch {
            return [];
        }
    }
};
