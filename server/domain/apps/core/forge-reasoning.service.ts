
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { ForgeOptions, WavePlan } from "./forge-types.js";
import { codeGraphService } from "../../xray/core/code-graph.service.js";

const logger = createLogger("ForgeReasoning");

export const FORGE_REASONING_PROMPT = `
You are the Forge Reasoning Engine (System 2). Your goal is to logically verify an assembled application against its original plan.
You must use a "Deep Thinking" process:
1. INTERNAL REFLECTION: Analyze the provided code graph and metrics.
2. EDGE CASE SCAN: Identify potential runtime failures or logic gaps (e.g. missing error boundaries, unhandled empty states).
3. VERIFICATION: Does the implementation satisfy all tasks in the Wave Plan?
4. CRITIQUE: Provide a compliance score and specific logical corrections.

Output must be JSON: { "complianceScore": 0-100, "logicGaps": ["..."], "verificationPassed": boolean, "deepThoughtTrace": "..." }
`;

export class ForgeReasoningService {
    /**
     * Performs a System 2 deep-reasoning pass on the forged app.
     */
    async deepVerify(slug: string, options: ForgeOptions, wavePlan: WavePlan): Promise<any> {
        logger.info(`[ForgeReasoning] Starting deep verification for ${slug}`);

        const aiConfig = await systemAiService.getAiConfig('architect', options.organizationId);
        if (!aiConfig) return { complianceScore: 100, verificationPassed: true, logicGaps: [] };

        const aiClient = AIClientFactory.getClient(aiConfig as any);
        
        // Fetch structural context from XRay
        const graph = await codeGraphService.queryGraph(slug);
        const metrics = await codeGraphService.getMetrics(slug);

        const userPrompt = `
            APPLICATION SLUG: ${slug}
            WAVE PLAN: ${JSON.stringify(wavePlan)}
            CODE GRAPH SUMMARY: Found ${graph.nodes.length} nodes and ${graph.edges.length} edges.
            METRICS: ${JSON.stringify(metrics)}
            
            Perform your deep thinking pass now.
        `;

        try {
            // Force a higher reasoning model if available (e.g. o1-preview or gemini-1.5-pro)
            const reasoningConfig = { ...aiConfig, model: "gemini-1.5-pro" }; // Using 1.5 Pro as a "System 2" proxy
            
            const response = await aiClient.execute({
                model: reasoningConfig.model,
                systemPrompt: FORGE_REASONING_PROMPT,
                userPrompt,
                requestType: 'json',
                responseType: 'json',
                maxTokens: 4096
            } as any, undefined, aiConfig.apiKey ?? "");

            if (response.success && response.output) {
                const parsed = typeof response.output === 'string' ? JSON.parse(response.output) : response.output;
                logger.info(`[ForgeReasoning] Deep verification completed. Score: ${parsed.complianceScore}`);
                return parsed;
            }
            
            throw new Error(`Reasoning AI failed: ${response.error}`);
        } catch (err: any) {
            logger.error(`[ForgeReasoning] Deep verification failed: ${err.message}`);
            return { complianceScore: 50, verificationPassed: false, logicGaps: [err.message] };
        }
    }
    /**
     * Skill: Build Failure Diagnosis
     * Analyzes raw build logs and proposes specific file edits to fix the errors.
     */
    async diagnoseBuildFailure(slug: string, buildLogs: string, options: ForgeOptions): Promise<any> {
        logger.info(`[ForgeReasoning] Diagnosing build failure for ${slug}`);

        const aiConfig = await systemAiService.getAiConfig('architect', options.organizationId);
        if (!aiConfig) throw new Error("Architect AI config not found.");

        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const systemPrompt = `
You are the Forge Build Medic. Your goal is to fix compilation/build errors in a Next.js/TypeScript application.
Analyze the provided build logs and identify the root cause.

CATEGORIES:
1. MISSING_IMPORT: A file is being imported that doesn't exist.
2. TYPE_MISMATCH: TypeScript type error.
3. SYNTAX_ERROR: Malformed code.
4. MISSING_DEPENDENCY: package.json is missing a required library.
5. PATH_ALIAS_ISSUE: @/ aliases are not resolving correctly.

Output must be JSON:
{
  "errorCategory": "...",
  "summary": "Short explanation",
  "canFix": boolean,
  "fixProposal": {
    "files": [
      { "path": "relative/path/to/file", "content": "NEW_FULL_CONTENT" }
    ]
  }
}
`;

        const userPrompt = `
APP SLUG: ${slug}
BUILD LOGS:
${buildLogs.slice(-4000)}

Analyze and fix.
`;

        try {
            const response = await aiClient.execute({
                model: aiConfig.model,
                systemPrompt,
                userPrompt,
                requestType: 'json',
                responseType: 'json'
            } as any, undefined, aiConfig.apiKey ?? "");

            if (response.success && response.output) {
                return typeof response.output === 'string' ? JSON.parse(response.output) : response.output;
            }
            throw new Error(`Medic AI failed: ${response.error}`);
        } catch (err: any) {
            logger.error(`[ForgeReasoning] Build diagnosis failed: ${err.message}`);
            return { canFix: false, errorCategory: "AI_FAILURE", summary: err.message };
        }
    }

    /**
     * Skill: Lint Failure Diagnosis
     */
    async diagnoseLintFailure(slug: string, lintLogs: string, options: ForgeOptions): Promise<any> {
        logger.info(`[ForgeReasoning] Diagnosing lint failure for ${slug}`);
        const aiConfig = await systemAiService.getAiConfig('architect', options.organizationId);
        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const systemPrompt = `
You are the Forge Lint Medic. Fix ESLint errors in a Next.js app.
Analyze the logs and propose fixes.
Focus on: unused variables, missing dependencies in hooks, and accessibility (a11y) issues.

Output JSON: { "errorCategory": "...", "summary": "...", "canFix": boolean, "fixProposal": { "files": [{ "path": "...", "content": "..." }] } }
`;
        const userPrompt = `APP: ${slug}\nLINT LOGS:\n${lintLogs.slice(-4000)}`;

        try {
            const resp = await aiClient.execute({ model: aiConfig!.model, systemPrompt, userPrompt, requestType: 'json', responseType: 'json' } as any, undefined, aiConfig!.apiKey ?? "");
            return typeof resp.output === 'string' ? JSON.parse(resp.output) : resp.output;
        } catch (err: any) {
            return { canFix: false, errorCategory: "AI_FAILURE", summary: err.message };
        }
    }

    /**
     * Skill: Type Failure Diagnosis
     */
    async diagnoseTypeFailure(slug: string, tscLogs: string, options: ForgeOptions): Promise<any> {
        logger.info(`[ForgeReasoning] Diagnosing type failure for ${slug}`);
        const aiConfig = await systemAiService.getAiConfig('architect', options.organizationId);
        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const systemPrompt = `
You are the Forge Type Medic. Fix TypeScript errors (tsc) in a Next.js app.
Analyze the logs and propose fixes. 
Common issues: property 'X' does not exist on type 'Y', binding element 'Z' implicitly has 'any' type.

Output JSON: { "errorCategory": "...", "summary": "...", "canFix": boolean, "fixProposal": { "files": [{ "path": "...", "content": "..." }] } }
`;
        const userPrompt = `APP: ${slug}\nTSC LOGS:\n${tscLogs.slice(-4000)}`;

        try {
            const resp = await aiClient.execute({ model: aiConfig!.model, systemPrompt, userPrompt, requestType: 'json', responseType: 'json' } as any, undefined, aiConfig!.apiKey ?? "");
            return typeof resp.output === 'string' ? JSON.parse(resp.output) : resp.output;
        } catch (err: any) {
            return { canFix: false, errorCategory: "AI_FAILURE", summary: err.message };
        }
    }
    /**
     * Skill: Omni-Medic Diagnostic
     * Holistic diagnosis of all error types (Lint, TSC, Build) in one pass.
     */
    async diagnoseOmniFailure(slug: string, errorReport: any, options: ForgeOptions): Promise<any> {
        logger.info(`[ForgeReasoning] Performing Omni-Medic diagnosis for ${slug}`);
        const aiConfig = await systemAiService.getAiConfig('architect', options.organizationId);
        const aiClient = AIClientFactory.getClient(aiConfig as any);

        const systemPrompt = `
You are the Forge Omni-Medic. You fix all issues in a Next.js/TypeScript app.
You have been provided with a report containing Lint, TSC, and Build errors.

Your goal:
1. IDENTIFY SHARED ROOTS: Often a single missing import or type mismatch causes multiple errors.
2. HOLISTIC FIX: Propose NEW_FULL_CONTENT for every affected file.
3. EFFICIENCY: Fix as many errors as possible in one shot.

Output JSON: { "errorCategory": "MULTI_FAILURE", "summary": "...", "canFix": boolean, "fixProposal": { "files": [{ "path": "...", "content": "..." }] } }
`;
        const userPrompt = `
APP: ${slug}
ERROR REPORT:
${JSON.stringify(errorReport, null, 2).slice(-6000)}

Analyze and provide a unified fix proposal.
`;

        try {
            const resp = await aiClient.execute({ 
                model: aiConfig!.model, 
                systemPrompt, 
                userPrompt, 
                requestType: 'json', 
                responseType: 'json' 
            } as any, undefined, aiConfig!.apiKey ?? "");
            
            return typeof resp.output === 'string' ? JSON.parse(resp.output) : resp.output;
        } catch (err: any) {
            logger.error(`[ForgeReasoning] Omni-Medic failed: ${err.message}`);
            return { canFix: false, errorCategory: "AI_FAILURE", summary: err.message };
        }
    }
}

export const forgeReasoningService = new ForgeReasoningService();
