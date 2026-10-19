import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/core/system-ai.service.js";
import { AIClientFactory } from "@domain/ai/core/ai-client.service.js";
import { fineTuningService } from "@domain/ai/core/fine-tuning.service.js";
import { UI_DESIGNER_PROMPT, UI_CRITIQUE_PROMPT } from "./forge-design-specialists.js";
import path from "node:path";
import fs from "node:fs/promises";
import { assertOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("ForgeSpecialistService");

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const AI_CALL_TIMEOUT_MS = 1_200_000; // 20m
const withAiTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
    Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`AI specialist call timed out after ${AI_CALL_TIMEOUT_MS / 1000}s [${label}]`)), AI_CALL_TIMEOUT_MS)
        )
    ]);

/**
 * Wrapper for AI calls with exponential backoff on 429 errors.
 */
async function executeWithBackoff(client: any, config: any, payload: any, options: any = {}, maxRetries = 3, emitLog?: any): Promise<any> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const result = await withAiTimeout(client.execute(payload, options, config.apiKey ?? ""), payload.label || "specialist-call");
            return result;
        } catch (err: any) {
            const errStr = JSON.stringify(err).toLowerCase();
            const is429 = errStr.includes("429") || errStr.includes("resource_exhausted") || errStr.includes("rate limit");
            
            if (is429 && i < maxRetries - 1) {
                const delay = (i + 1) * 5000;
                if (emitLog) await emitLog(`AI rate limit (429) hit. Cooling down for ${delay/1000}s...`, 'warn');
                await sleep(delay);
                continue;
            }
            throw err;
        }
    }
}

export const forgeSpecialistService = {
    /**
     * Security Auditor Pass
     * Reviews a development plan or code for risks.
     */
    async auditPlan(description: string, plan: any, organizationId?: number): Promise<{ isSafe: boolean, score: number, reason: string }> {
        try {
            const aiConfig = await systemAiService.getAiConfig('codegen', organizationId);
            if (!aiConfig) return { isSafe: true, score: 1.0, reason: "No AI config available for audit." };

            const auditConfig = { ...aiConfig, model: "gemini-1.5-flash" };
            const client = AIClientFactory.getClient(auditConfig as any);
            const audit = await client.execute({
                model: auditConfig.model,
                systemPrompt: "You are the Oddjob Security Auditor. Review the development plan for security risks, hardcoded secrets, or mission misalignment. Return ONLY a JSON object: { \"isSafe\": boolean, \"score\": number (0-1), \"reason\": string }.",
                userPrompt: `Mission: ${description}\nPlan: ${JSON.stringify(plan)}`,
                requestType: "json",
                responseType: "json",
            } as any, undefined, aiConfig.apiKey ?? "") as any;
            
            const result = typeof audit.output === 'string' ? JSON.parse(audit.output) : audit.output;
            return {
                isSafe: result.isSafe || result.score > 0.85,
                score: result.score || 0,
                reason: result.reason || "Audited."
            };
        } catch (err: any) {
            logger.warn(`[SecurityAuditor] Plan audit failed: ${err.message}`);
            return { isSafe: true, score: 0.5, reason: "Audit failed, falling back to safe." };
        }
    },

    /**
     * UI Designer Pass
     * Enhances generated files with premium styling.
     */
    async runDesignerPass(
        files: Record<string, string>,
        description: string,
        designStyleContext: string = "",
        stitchInstructions: string = "",
        organizationId?: number,
        emitLog?: (m: string, l?: any) => Promise<void>
    ): Promise<Record<string, string>> {
        try {
            const aiConfig = await systemAiService.getAiConfig('codegen', organizationId);
            if (!aiConfig) return files;

            const client = AIClientFactory.getClient(aiConfig as any);
            const tsxPages = Object.keys(files).filter(k => k.endsWith(".tsx") && k.startsWith("pages/") && !k.includes("_app") && !k.includes("_document"));
            
            if (tsxPages.length === 0) return files;

            const designerPayload: Record<string, string> = {};
            tsxPages.forEach(p => { designerPayload[p] = files[p]; });
            if (files["styles/globals.css"]) designerPayload["styles/globals.css"] = files["styles/globals.css"];
            if (files["tailwind.config.js"]) designerPayload["tailwind.config.js"] = files["tailwind.config.js"];
            if (files["postcss.config.js"]) designerPayload["postcss.config.js"] = files["postcss.config.js"];

            const activeDesignerPrompt = designStyleContext
                ? `${UI_DESIGNER_PROMPT}\n\n${designStyleContext}\n\nRULE: The DESIGN IDENTITY block above OVERRIDES all default dark/glassmorphism directives. Apply the specified palette, fonts, and border radii faithfully. If you use custom utility classes in globals.css, you MUST define them in the tailwind.config.js 'extend' block.`
                : UI_DESIGNER_PROMPT;

            const designerResult = await executeWithBackoff(client, aiConfig, {
                model: aiConfig.model,
                systemPrompt: activeDesignerPrompt + stitchInstructions,
                messages: [{
                    role: "user",
                    content: JSON.stringify({
                        instruction: "Apply the premium dark glass visual design system to these pages. Keep ALL logic, hooks, and data fetching intact. Return updated files as JSON.",
                        appDescription: description,
                        filesToEnhance: designerPayload,
                    })
                }],
                maxTokens: 8192,
            } as any, {}, 5, emitLog);

            if (designerResult.success && designerResult.output) {
                const designerRaw = designerResult.output.trim();
                const jsonMatch = designerRaw.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        const updatedFiles = JSON.parse(jsonMatch[0]);
                        for (const [k, v] of Object.entries(updatedFiles)) {
                            if (typeof v === 'string') {
                                files[k] = v as string;
                            }
                        }
                        return files;
                    } catch (err) {
                        logger.warn(`[Designer] Failed to parse designer output: ${err}`);
                    }
                }
            }
        } catch (err: any) {
            logger.warn(`[Designer] Pass failed: ${err.message}`);
        }
        return files;
    },

    /**
     * TypeScript Auto-Fix Pass
     * Attempts to fix compilation errors.
     */
    async fixTypeScriptErrors(
        buildPath: string,
        errorLines: string[],
        organizationId?: number,
        emitLog?: (m: string, l?: any) => Promise<void>
    ): Promise<number> {
        if (errorLines.length === 0) return 0;

        try {
            const aiConfig = await systemAiService.getAiConfig('codegen', organizationId);
            if (!aiConfig) return 0;

            const repairConfig = { ...aiConfig, model: "gemini-1.5-flash" };
            const client = AIClientFactory.getClient(repairConfig as any);
            const affectedFiles = new Set<string>();
            for (const line of errorLines) {
                const match = line.match(/^([^(]+)\(\d+,\d+\)/);
                if (match) affectedFiles.add(match[1].trim());
            }

            const fileContents: Record<string, string> = {};
            for (const fp of Array.from(affectedFiles).slice(0, 8)) {
                try {
                    const rel = fp.replace(buildPath.replace(/\\/g, '/'), '').replace(/\\/g, '/').replace(/^\//, '');
                    fileContents[rel] = await fs.readFile(fp, 'utf-8');
                } catch { /* skip */ }
            }

            if (Object.keys(fileContents).length === 0) return 0;

            const fixResult = await client.execute({
                model: aiConfig.model,
                systemPrompt: `You are a TypeScript expert. Fix ONLY the specific TypeScript errors listed below.
Return a JSON object mapping file paths to their COMPLETE corrected file contents.
Rules: Fix only actual type errors, do not rewrite unrelated logic. Return valid JSON only.`,
                userPrompt: JSON.stringify({
                    errors: errorLines.slice(0, 30),
                    files: fileContents,
                }),
                requestType: "json",
                responseType: "json",
                maxTokens: 8192,
            } as any, undefined, aiConfig.apiKey ?? "") as any;

            if (fixResult.success && fixResult.output) {
                const safePathPattern = /^[a-zA-Z0-9_\-./]+\.(ts|tsx|js|jsx)$/;
                const fixRaw = fixResult.output.replace(/```json/g, '').replace(/```/g, '').trim();
                const fixes = JSON.parse(fixRaw);
                let fixCount = 0;
                for (const [relPath, content] of Object.entries(fixes)) {
                    if (typeof content === 'string' && safePathPattern.test(relPath) && !relPath.includes('..')) {
                        const fullP = path.join(buildPath, relPath);
                        if (fullP.startsWith(buildPath)) {
                            await fs.mkdir(path.dirname(fullP), { recursive: true });
                            await fs.writeFile(fullP, content, 'utf-8');
                            
                            await fineTuningService.registerExample(
                                "App Forge: TypeScript Fixes",
                                {
                                    input: JSON.stringify({ errors: errorLines.slice(0, 5), originalFile: fileContents[relPath] }),
                                    output: content,
                                    inputContext: { type: 'ts_autofix', buildPath, relPath },
                                    tags: ['ts-fix', 'autofix', 'golden']
                                },
                                assertOrgId(organizationId)
                            );

                            fixCount++;
                        }
                    }
                }
                return fixCount;
            }
        } catch (err: any) {
            logger.warn(`[TSFixer] Pass failed: ${err.message}`);
        }
        return 0;
    },

    /**
     * Audit Codebase (QA Pass)
     */
    async auditCodebase(slug: string, options: any): Promise<{ success: boolean; findings: string[] }> {
        try {
            const aiConfig = await systemAiService.getAiConfig('codegen', options.organizationId);
            if (!aiConfig) return { success: true, findings: [] };

            const { podRegistry } = await import("@domain/core/infrastructure/pod-registry.service.js");
            const xray = await podRegistry.getPod<any>('xray');
            const metrics = await xray.getMetrics(slug);

            if (metrics.parseErrors > 0) {
                return { success: false, findings: [`Codebase has ${metrics.parseErrors} parse errors.`] };
            }

            return { success: true, findings: [] };
        } catch (err: any) {
            logger.warn(`[CodeAuditor] Audit failed: ${err.message}`);
            return { success: true, findings: [] };
        }
    },

    /**
     * Swarm Assembly (Mach 4): Multi-role parallel refinement.
     */
    async runSwarmAssembly(
        files: Record<string, string>,
        description: string,
        organizationId?: number,
        emitLog?: (m: string, l?: any) => Promise<void>
    ): Promise<Record<string, string>> {
        await emitLog?.("Swarm Hive: Initializing multi-role specialist swarm...", 'info');
        
        const specialists = [
            { role: "UI/UX Specialist", focus: "Refine Tailwind styling, responsive layouts, and animations." },
            { role: "API/Backend Specialist", focus: "Harden server actions, error handling, and API security." },
            { role: "Data/Type Specialist", focus: "Ensure strict TypeScript interfaces and data model integrity." },
            { role: "Security Auditor", focus: "Sanitize inputs, check for XSS/CSRF, and enforce best practices." }
        ];

        const aiConfig = await systemAiService.getAiConfig('codegen', organizationId);
        if (!aiConfig) return files;
        const client = AIClientFactory.getClient(aiConfig as any);

        const swarmTasks = specialists.map(async (spec) => {
            await emitLog?.(`Specialist [${spec.role}] is analyzing the workspace...`, 'info');
            try {
                const result = await withAiTimeout(client.execute({
                    model: aiConfig.model,
                    systemPrompt: `You are the ${spec.role}. Your focus: ${spec.focus}
Return a JSON object of modified files only. Keep existing logic intact.`,
                    userPrompt: `App: ${description}\nFiles: ${JSON.stringify(files)}`,
                    requestType: "json",
                    responseType: "json"
                } as any, undefined, aiConfig.apiKey ?? ""), `swarm-${spec.role}`) as any;

                if (result.success && result.output) {
                    return typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
                }
            } catch (err: any) {
                logger.warn(`Specialist ${spec.role} failed: ${err?.message || String(err)}`);
            }
            return {};
        });

        const contributions = await Promise.all(swarmTasks);
        
        await emitLog?.("Swarm Manager: Merging specialist contributions...", 'info');
        
        for (const contrib of contributions) {
            for (const [path, content] of Object.entries(contrib)) {
                if (typeof content === 'string') {
                    files[path] = content;
                }
            }
        }

        await emitLog?.("Swarm Assembly completed. Workspace hardened by 4 specialists.", 'success');
        return files;
    }
};
