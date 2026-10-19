/**
 * Forge Codegen Service
 *
 * AI-driven file generation step injected into the forgeApp() pipeline.
 * Called after blueprint copy, before docker build.
 *
 * Uses the AI client to generate customized file content from:
 *   - Mission description + blackboard (what the user wants)
 *   - Blueprint code graph snapshot (what already exists)
 *
 * Writes generated files into the forge workspace via appForgeService.editFile().
 */

import path from "node:path";
import fs from "node:fs/promises";
import { createLogger } from "@server/utils/logger.js";
import { UI_ARCHITECT_PROMPT, UI_CRITIQUE_PROMPT } from "./forge-design-specialists.js";
import type { ForgeOptions } from "../app-forge.service.js";
import { TraceContext } from "@domain/core/infrastructure/trace-context.service.js";
import { tryFixJson } from "../../../../shared/utils/jsonUtils.js";
import type { AiConfig } from "@domain/ai/core/ai-config-resolver.js";
import { forgeDependencyService } from "./forge-dependency.service.js";
import { forgeBlueprintService } from "./forge-blueprint.service.js";
import { forgeValidatorService } from "./forge-validator.service.js";
import { forgeInputGuard } from "./forge-input-guard.service.js";
import { forgeSecurityInjectService } from "./forge-security-inject.service.js";
import { withAiTimeout, sleep } from "./forge-utils.js";
import { FORGE_WORKSPACE_ROOT, isWithinDirectory } from "./forge-paths.js";
import type { DevelopmentPlan, ArchitectureProposal, WavePlan } from "./forge-plan.service.js";
import { assertOrgId } from "@server/utils/auth-context.js";

// Import modular sub-services
import { forgePreassemblyService } from "./forge-preassembly.service.js";
import { forgeTaskRunnerService, executeWithBackoff } from "./forge-task-runner.service.js";
import { forgeCritiqueService } from "./forge-critique.service.js";
import { forgeSecurityAuditorService } from "./forge-security-auditor.service.js";
import { forgeDesignSynthesisService } from "./forge-design-synthesis.service.js";
import { forgeFoundationService } from "./forge-foundation.service.js";
import { forgePlanService } from "./forge-plan.service.js";
import { forgeMemoryService } from "./forge-memory.service.js";
import { forgeLiveAssemblyService } from "./forge-live-assembly.service.js";
import { forgeDraftService } from "./forge-draft.service.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("ForgeCodegen");
const BLUEPRINT_ROOT = path.resolve("server/blueprints/apps");
const MAX_SOURCE_CHARS = 100_000;

export interface CachedScaffold {
    blueprintSnapshot: Record<string, string>;
    uiPalette: any;
    slots: Record<string, string[]>; // filename -> slot names
    cachedAt: number;
}

export const forgeCodegenService = {
    async selectBlueprint(description: string, defaultSlug: string): Promise<string> {
        return forgeBlueprintService.selectBlueprint(description, defaultSlug);
    },

    detectSlots(snapshot: Record<string, string>): Record<string, string[]> {
        return forgeBlueprintService.detectSlots(snapshot);
    },

    async getBlockRegistry(): Promise<any> {
        return forgeBlueprintService.getBlockRegistry();
    },

    fillSlots(template: string, slots: Record<string, string>): string {
        return forgeBlueprintService.fillSlots(template, slots);
    },

    async executeSlotFill(
        blueprintSlug: string,
        slotsMap: Record<string, string[]>,
        options: ForgeOptions,
        featureSpec: string,
        visionDirectives: string,
        aiConfig: AiConfig,
        client: any,
        emitLog: (m: string, l?: any) => Promise<void>
    ): Promise<Record<string, Record<string, string>> | null> {
        const registry = await this.getBlockRegistry();
        const slotContext = Object.entries(slotsMap)
            .filter(([_, slots]) => slots.length > 0)
            .map(([file, slots]) => `FILE: ${file}\nSLOTS: ${slots.join(", ")}`)
            .join("\n\n");

        const prompt = `You are an industrial UI Architect. Fill the following blueprint slots for a new app.
APP DESCRIPTION: ${options.description}
FEATURE SPEC: ${featureSpec}
VISION DIRECTIVES: ${visionDirectives}
DATA WIRING HINTS (Use these for data slots):
${(options as any).wiringHints || "Infer from mission description and blackboard."}

INDUSTRIAL BLOCK REGISTRY (Use these for blocks/layout slots):
${JSON.stringify(registry.blocks, null, 2)}

BLUEPRINT SLOTS:
${slotContext}

RULES:
1. Return a JSON object mapping filenames to a sub-object of slot values.
2. Slot values must be strings. If a slot (like {{COLUMNS}} or {{HERO_STATS}}) expects a JSON array/object, provide it as a JSON-stringified string.
3. Match the "props" schema in the Block Registry for any slots that inject block data.
4. Use premium design patterns, industrial-grade terminology, and Oddjob platform conventions.
5. Output ONLY valid JSON. No markdown, no conversational text.`;

        const result = await executeWithBackoff(client, aiConfig, {
            model: aiConfig.model,
            systemPrompt: "You are a professional software architect. Output ONLY raw JSON.",
            userPrompt: prompt,
            requestType: "json",
            maxTokens: 4096
        }, {}, 3, emitLog);

        if (result.success && result.output) {
            try {
                return typeof result.output === 'string' ? JSON.parse(result.output) : result.output;
            } catch (e: any) {
                logger.warn(`Failed to parse slot-fill JSON: ${e.message}`);
                return null;
            }
        }
        return null;
    },

    async resolvePreassemblyContext(
        blueprintSlug: string,
        options: ForgeOptions,
        emitLog: (m: string, l?: any) => Promise<void>,
        blueprintSnapshot: Record<string, string>,
        cachedScaffold: CachedScaffold | null,
        orgContext: any,
        traceContext?: TraceContext
    ) {
        return forgePreassemblyService.resolvePreassemblyContext(
            blueprintSlug,
            options,
            emitLog,
            blueprintSnapshot,
            cachedScaffold,
            orgContext,
            traceContext
        );
    },

    async generateBlueprintFiles(
        slug: string,
        blueprintSlug: string,
        options: ForgeOptions,
        jobId?: string,
        traceContext?: TraceContext,
        workspacePath?: string,
        granularity: number = 1.0,
        devPlan?: WavePlan,
        architecture?: ArchitectureProposal,
        iterativeMode: boolean = false,
        targetWaveId?: number
    ): Promise<{ stitchProjectId?: string; success: boolean; files?: Record<string, string>; wavePlan?: WavePlan }> {
        const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
        
        const emitLog = async (message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info', metadata?: Record<string, any>) => {
            logger.info(`[ForgeCodegen:${slug}] ${message}`);
            if (jobId) {
                await eventStream.publish("FORGE_LOG", {
                    jobId,
                    message,
                    level,
                    timestamp: new Date().toLocaleTimeString(),
                    ...(metadata || {})
                }, { organizationId: options.organizationId || null }, "app-forge");
            }
        };

        const streamFiles = async (activeTask: string, files: string[]) => {
            if (!options.liveAssembly || files.length === 0) return;
            options.liveAssembly = forgeLiveAssemblyService.withFiles(options.liveAssembly, files, activeTask);
            if (jobId) {
                await forgeDraftService.updateDraft(jobId, { options });
                const rawStatus = await redis.get(`forge:job:${jobId}`).catch(() => null);
                try {
                    const current = rawStatus ? JSON.parse(rawStatus) : {};
                    await redis.set(`forge:job:${jobId}`, JSON.stringify({
                        ...current,
                        options,
                        liveAssembly: options.liveAssembly,
                        updatedAt: new Date().toISOString(),
                    }), 'EX', 86400);
                } catch { /* the normal stage writer will repair a corrupt snapshot */ }
            }
            await emitLog(`UI Assembly: ${activeTask} produced ${files.length} file${files.length === 1 ? '' : 's'}.`, 'success', {
                liveAssembly: options.liveAssembly,
            });
        };

        await emitLog(`AI Architect initiating blueprint expansion...`, 'info');

        // 0. Security: Validate input
        if (options.description) {
            const inputGuardResult = forgeInputGuard.scanInput(options.description, {
                maxLength: 10000,
                removeControlChars: true,
                normalizeWhitespace: true,
            });

            forgeInputGuard.logSecurityEvent(options.description, inputGuardResult, {
                slug,
                organizationId: options.organizationId,
            });

            if (!inputGuardResult.allowed) {
                await emitLog(`🚫 Input Guard: Request blocked - ${inputGuardResult.reason}`, "error");
                throw new Error(`Input validation failed: ${inputGuardResult.reason}`);
            }
        }

        // 1. Resolve blueprint snapshot
        const { forgeScaffoldCache } = await import("./forge-scaffold-cache.service.js");
        const cachedScaffold = await forgeScaffoldCache.get(blueprintSlug);
        
        const blueprintSnapshot = cachedScaffold?.blueprintSnapshot || await forgeFoundationService.snapshotDirectory(
            path.join(BLUEPRINT_ROOT, blueprintSlug),
            MAX_SOURCE_CHARS / 2
        );

        const orgContext = { organizationId: options.organizationId } as any;
        const preassembly = await forgePreassemblyService.resolvePreassemblyContext(
            blueprintSlug,
            options,
            emitLog,
            blueprintSnapshot,
            cachedScaffold,
            orgContext,
            traceContext
        );

        const {
            wiringHints,
            memoryContext,
            visionDirectives,
            refVisualDirectives,
            refRagContext,
            codeGraphContext,
            uiPalette,
            packagedFoundations,
            slotsMap
        } = preassembly;

        (options as any).wiringHints = wiringHints;
        const hasSlots = Object.values(slotsMap).some(s => (s as any).length > 0);

        let generatedFiles: Record<string, string> = {};
        try {
            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");

            const aiConfig = await systemAiService.getAiConfig('codegen');
            if (!aiConfig) {
                logger.warn("[ForgeCodegen] No AI config available, skipping code generation");
                return { success: false };
            }

            const resolvedAiConfig: AiConfig = {
                ...aiConfig,
                credentialId: aiConfig.credentialId ?? 0,
                apiKey: aiConfig.apiKey ?? ""
            };

            const client = AIClientFactory.getClient(resolvedAiConfig as any);

            // 3.1 Requirements Decomposition
            await emitLog("Decomposing requirements into feature spec...", 'info');
            const requiredFeatures = await forgePlanService.decomposeRequirements(
                options.description,
                blueprintSlug,
                resolvedAiConfig,
                client,
                refRagContext,
                visionDirectives,
                granularity,
                emitLog
            );
            if (requiredFeatures) {
                await emitLog(`Feature spec ready (${requiredFeatures.split('\n').length} items)`, 'info');
                try {
                    const targetPath = workspacePath || path.join(FORGE_WORKSPACE_ROOT, slug);
                    await fs.mkdir(targetPath, { recursive: true });
                    const mdHeader = `# App Requirements: ${options.name}\n\nGenerated by AI Architect on ${new Date().toLocaleDateString()}\n\n---\n\n`;
                    await fs.writeFile(path.join(targetPath, "requirements.md"), mdHeader + requiredFeatures, "utf-8");
                    await emitLog("Generated requirements.md in workspace.", 'success');
                    await streamFiles('Requirements', ['requirements.md']);
                } catch (e: any) {
                    logger.warn(`Failed to write requirements.md: ${e.message}`);
                }
            }

            // 3.2 Preassembly Code Synthesis (Slot-Fill)
            const isDockerApp = blueprintSlug && ["go-backend", "python-backend", "java-backend"].includes(blueprintSlug);
            let slotResults: Record<string, Record<string, string>> | null = null;
            if (hasSlots && !isDockerApp) {
                await emitLog("Preassembly: Fulfilling blueprint templates via Slot-Fill...", 'info');
                slotResults = await this.executeSlotFill(
                    blueprintSlug,
                    slotsMap,
                    options,
                    requiredFeatures || "",
                    visionDirectives,
                    resolvedAiConfig,
                    client,
                    emitLog
                );
            }

            if (slotResults) {
                let filledCount = 0;
                for (const [file, slots] of Object.entries(slotResults)) {
                    const template = blueprintSnapshot[file];
                    if (template && typeof slots === 'object') {
                        generatedFiles[file] = this.fillSlots(template, slots);
                        filledCount++;
                    }
                }
                await emitLog(`Preassembly complete: Filled slots in ${filledCount} file(s).`, 'success');
            }

            // 3.3 Dynamic Orchestration & Task Execution
            const { mcpClientService: mcpSvc } = await import("@domain/integrations/core/mcp-client.service.js");
            const allTools = mcpSvc.getAllTools ? mcpSvc.getAllTools() : [];
            const tools = allTools.filter((t: any) => t.name.startsWith("stitch_"));
            const stitchInstructions = tools.length > 0 
                ? "\nYou have access to Stitch MCP tools. Use them to manage UI components, screens, and design variants."
                : "";

            const targetPath = workspacePath || path.join(FORGE_WORKSPACE_ROOT, slug);
            let wavePlan: WavePlan | undefined;
            let stitchProjectId: string | undefined;
            const isAccelerated = options.deliveryProfile === 'accelerated';

            if (isAccelerated) {
                await emitLog("Accelerated Archetype Delivery: Consuming Component Gallery blocks and finalizing scaffold...", 'info');
                await streamFiles("Component Gallery Archetype", Object.keys(generatedFiles));
            } else if (devPlan) {
                wavePlan = devPlan;
                const waveId = targetWaveId ?? 1;
                const wave = wavePlan.waves.find(w => w.id === waveId);
                if (wave) {
                    await emitLog(`Iterative wave build: Processing Wave ${waveId} (${wave.title})...`, 'info');
                    const completedTaskIds = new Set<string>();
                    for (const task of wave.tasks) {
                        const taskRes = await forgeTaskRunnerService.executeSingleTask(
                            task,
                            { options, requiredFeatures: requiredFeatures || "", uiPalette, visionDirectives, blueprintSlug },
                            { client, resolvedAiConfig, tools, allTools, stitchInstructions, cachedContentName: undefined, maxTaskTurns: 5 },
                            { generatedFiles, completedTaskIds, emitLog, traceContext }
                        );
                        if (taskRes.success && taskRes.taskFiles) {
                            Object.assign(generatedFiles, taskRes.taskFiles);
                            completedTaskIds.add(task.id);
                            await streamFiles(task.title, Object.keys(taskRes.taskFiles));
                            if (taskRes.stitchProjectId) stitchProjectId = taskRes.stitchProjectId;
                        }
                    }
                }
            } else {
                await emitLog("Decomposing build tasks into wave plan...", 'info');
                wavePlan = (options as any).wavePlan || await forgePlanService.generateWavePlan(
                    requiredFeatures || "",
                    resolvedAiConfig,
                    client,
                    granularity,
                    emitLog,
                    options.userAnswers ? JSON.stringify(options.userAnswers) : undefined,
                    architecture,
                    blueprintSlug
                );
                if (wavePlan) {
                    await emitLog(`Wave plan compiled: ${wavePlan.waves.length} waves, ${wavePlan.waves.flatMap(w => w.tasks).length} tasks total.`, 'success');
                    
                    const completedTaskIds = new Set<string>();
                    for (const wave of wavePlan.waves) {
                        await emitLog(`Executing Wave ${wave.id}: ${wave.title}...`, 'info');
                        for (const task of wave.tasks) {
                            const taskRes = await forgeTaskRunnerService.executeSingleTask(
                                task,
                                { options, requiredFeatures: requiredFeatures || "", uiPalette, visionDirectives, blueprintSlug },
                                { client, resolvedAiConfig, tools, allTools, stitchInstructions, cachedContentName: undefined, maxTaskTurns: 5 },
                                { generatedFiles, completedTaskIds, emitLog, traceContext }
                            );
                            if (taskRes.success && taskRes.taskFiles) {
                                Object.assign(generatedFiles, taskRes.taskFiles);
                                completedTaskIds.add(task.id);
                                await streamFiles(task.title, Object.keys(taskRes.taskFiles));
                                if (taskRes.stitchProjectId) stitchProjectId = taskRes.stitchProjectId;
                            }
                        }
                    }
                }
            }

            // Fill empty templates
            for (const [file, content] of Object.entries(blueprintSnapshot)) {
                if (!generatedFiles[file]) {
                    generatedFiles[file] = content;
                }
            }

            // Gallery components depend on the semantic token contract shipped by
            // the blueprint. If a model replaces globals.css with a generic file,
            // Tailwind still compiles but colors and surfaces resolve to invalid CSS.
            // Restore the gallery stylesheet rather than publishing an unstyled app.
            if (!isDockerApp) {
                const galleryStyles = blueprintSnapshot["styles/globals.css"];
                const generatedStyles = generatedFiles["styles/globals.css"];
                const hasGalleryTokens = generatedStyles?.includes("--card:")
                    && generatedStyles.includes("--primary:")
                    && generatedStyles.includes("--border:")
                    && generatedStyles.includes("@tailwind components");
                if (galleryStyles && !hasGalleryTokens) {
                    generatedFiles["styles/globals.css"] = galleryStyles;
                    await emitLog("UI Assembly: Restored the Oddjob Component Gallery token stylesheet.", "success");
                }
            }

            let lastCritiqueScore = 100;

            // Inject Dependencies
            await forgeDependencyService.detectAndInjectDependencies(slug, generatedFiles, emitLog, workspacePath);

            // Run Validator Scanner
            await emitLog("Security validation: Scanning generated code for vulnerabilities...", "info");
            const validationResult = await forgeValidatorService.validateCode(generatedFiles);
            const summary = forgeValidatorService.getSummary(validationResult.issues);

            if (summary.critical > 0) {
                await emitLog(`🚨 Security Validation FAILED: ${summary.critical} critical issues detected`, "error");
                throw new Error(`Security validation failed: ${summary.critical} critical vulnerabilities found. Build aborted.`);
            }

            if (summary.high > 0) {
                await emitLog(`⚠️ Security Validation WARNING: ${summary.high} high-severity issues detected`, "warn");
            }

            /*
             * Gallery conformance is reported, never fatal. The prompt layer has
             * always told the model the gallery is mandatory; this is the first
             * thing that checks whether it listened. An off-style app still
             * builds — the author decides whether to ask for a restyle.
             */
            const galleryFindings = forgeValidatorService.getGalleryFindings(validationResult.issues);
            if (galleryFindings.length > 0) {
                const offendingFiles = [...new Set(galleryFindings.map(f => f.file))];
                await emitLog(
                    `🎨 Component Gallery: ${galleryFindings.length} conformance ${galleryFindings.length === 1 ? "finding" : "findings"} ` +
                    `across ${offendingFiles.length} ${offendingFiles.length === 1 ? "file" : "files"} ` +
                    `(${offendingFiles.slice(0, 3).join(", ")}${offendingFiles.length > 3 ? ", …" : ""}). ` +
                    `Ask for a restyle to move these onto gallery components.`,
                    "warn",
                );
            } else {
                await emitLog("🎨 Component Gallery: UI assembled from gallery components.", "success");
            }

            if (validationResult.fixed && Object.keys(validationResult.fixed).length > 0) {
                await emitLog(`🔧 Auto-fixed ${Object.keys(validationResult.fixed).length} security issues`, "success");
                Object.assign(generatedFiles, validationResult.fixed);
            }

            // Write files to final Workspace directory
            const finalWorkspacePath = workspacePath ?? path.join(FORGE_WORKSPACE_ROOT, slug);

            if (isDockerApp) {
                await emitLog("Security: Core security configurations are embedded directly in the Docker blueprint.", "success");
            } else {
                await emitLog("Injecting security middleware and protection modules...", "info");
                const securityInjectResult = await forgeSecurityInjectService.injectSecurityFiles(
                    finalWorkspacePath,
                    async (message: string, level?: string) => emitLog(
                        message,
                        level === "warn" || level === "error" || level === "success" ? level : "info"
                    )
                );
                if (securityInjectResult.success) {
                    await emitLog(`✅ Security modules injected: ${securityInjectResult.injected.join(", ")}`, "success");
                    await forgeSecurityInjectService.updateNextConfig(finalWorkspacePath);
                }
            }

            let written = 0;
            const failedWrites: string[] = [];
            for (let [relPath, content] of Object.entries(generatedFiles)) {
                if (typeof content !== "string") continue;
                if (relPath === "package.json" || relPath.endsWith("/package.json")) continue;

                // Deduplicate default exports
                if (relPath.match(/\.(tsx?|jsx?)$/)) {
                    const defaultExportMatches = [...content.matchAll(/^export\s+default\s+\w+\s*;?\s*$/gm)];
                    if (defaultExportMatches.length > 1) {
                        let seenDefault = false;
                        content = content.split("\n").reverse().map(line => {
                            if (/^export\s+default\s+\w+\s*;?\s*$/.test(line.trim())) {
                                if (!seenDefault) { seenDefault = true; return line; }
                                return "";
                            }
                            return line;
                        }).reverse().join("\n");
                    }
                }

                const fullPath = path.resolve(finalWorkspacePath, relPath);
                if (!isWithinDirectory(finalWorkspacePath, fullPath)) continue;

                try {
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.writeFile(fullPath, content, "utf-8");
                    written++;
                } catch (err: any) {
                    logger.warn(`[ForgeCodegen] Failed to write ${relPath}: ${err.message}`);
                    failedWrites.push(relPath);
                }
            }

            if (failedWrites.length > 0) {
                await emitLog(`   ${failedWrites.length} file(s) failed to write: ${failedWrites.join(", ")}`, 'warn');
                const criticalFiles = isDockerApp 
                    ? ["main.go", "main.py", "pom.xml"]
                    : ["pages/index.tsx", "pages/_app.tsx", "app/page.tsx", "app/layout.tsx"];
                const missingCritical = failedWrites.filter(f => criticalFiles.some(c => f.endsWith(c)));
                if (missingCritical.length > 0) {
                    throw new Error(`Critical entry point(s) failed to write: ${missingCritical.join(", ")}`);
                }
            }

            logger.info(`[ForgeCodegen] Wrote ${written} generated files into ${slug}`);
            await emitLog(`Forge workspace initialized with ${written} customized files.`, 'info');

            /*
             * The styling contract, checked against what was actually written.
             *
             * A missing semantic token does not throw. The class still applies,
             * the colour resolves to nothing, and the app renders unstyled while
             * every other check passes — so without this a build reports success
             * over a page that looks broken. Repair what is deterministic, then
             * re-validate rather than assume the repair worked.
             */
            try {
                const { validateGalleryContract, repairGalleryContract } = await import("./gallery-contract.service.js");
                let contract = await validateGalleryContract(slug);

                if (!contract.ok) {
                    const failed = contract.checks.filter(c => !c.ok);
                    await emitLog(
                        `Styling contract: ${failed.length} issue(s) — ${failed.map(c => c.detail).join(" ")}`,
                        'warn',
                    );

                    const repair = await repairGalleryContract(slug);
                    for (const line of repair.repaired) await emitLog(`Styling repair: ${line}`, 'info');
                    contract = await validateGalleryContract(slug);
                }

                if (contract.ok) {
                    await emitLog("Styling contract satisfied: gallery components will render as designed.", 'success');
                } else {
                    /*
                     * Reported, not thrown. An app whose tokens are incomplete
                     * still runs and can still be fixed from the studio, and
                     * failing the build here would throw away everything that
                     * was generated. What must not happen is silence.
                     */
                    const remaining = contract.checks.filter(c => !c.ok);
                    await emitLog(
                        `⚠️ Styling contract NOT satisfied after repair — the preview may render unstyled: ` +
                        remaining.map(c => c.detail).join(" "),
                        'warn',
                    );
                }
            } catch (contractErr: any) {
                await emitLog(`Styling contract check could not run: ${contractErr?.message ?? contractErr}`, 'warn');
            }

            if (written > 3 && lastCritiqueScore >= 80) {
                await emitLog(`Quality threshold met (${lastCritiqueScore}/100)   committing architectural pattern to memory.`, 'info');
                await forgeMemoryService.learnPattern(slug, blueprintSlug, options.description, generatedFiles, orgContext);
            }

            // Trigger Shadow Evaluation
            if (options.slug && !options.slug.startsWith("shadow-")) {
                try {
                    const { forgeQueue } = await import("../infrastructure/forge-queue.js");
                    await forgeQueue.add('shadow-challenger', {
                        liveAppSlug: options.slug,
                        options,
                        generatedFiles,
                        blueprintSlug,
                        traceContext
                    }, {
                        delay: 1000 * 60 * 60 * 2,
                        priority: 1,
                        jobId: `shadow-${options.slug}-${Date.now()}`,
                        attempts: 2,
                        backoff: { type: 'exponential', delay: 300000 }
                    });
                    await emitLog("Shadow challenger scheduled for off-peak execution (2h delay).", 'info');
                } catch (shadowErr: any) {
                    logger.warn(`Failed to schedule shadow challenger: ${shadowErr.message}`);
                }
            }

            return { stitchProjectId, success: true, files: generatedFiles, wavePlan };
        } catch (err: any) {
            await emitLog(`AI Architect call failed: ${err.message}`, 'error');
            return { success: false };
        }
    },

    async refineBlueprintFiles(
        slug: string,
        blueprintSlug: string,
        options: ForgeOptions & { isPriority?: boolean },
        qaTrace: any[],
        workspacePath: string,
        emitLog: (msg: string, type: 'info' | 'success' | 'warn' | 'error') => Promise<void>
    ): Promise<{ success: boolean; patches?: string[] }> {
        logger.info(`[Refinement] Initiating critique for ${slug}...`);
        await emitLog("Critique: Analyzing QA trace and console signatures...", 'info');

        try {
            const { systemAiService } = await import("@domain/ai/core/system-ai.service.js");
            const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
            const { promptEvolutionEngine } = await import("@domain/learning/core/prompt-evolution-engine.service.js");
            const { adaptiveLearningService } = await import("@domain/learning/core/adaptive-learning.service.js");

            const orgId = assertOrgId(options.organizationId);
            const critiqueRoute = await promptEvolutionEngine.routeWithShadowing(orgId, "testing");
            const architectRoute = await promptEvolutionEngine.routeWithShadowing(orgId, "code-generation");

            const aiConfig = await systemAiService.getAiConfig('codegen');
            if (!aiConfig) return { success: false };
            const client = AIClientFactory.getClient(aiConfig as any);

            const snapshot = await forgeFoundationService.snapshotDirectory(workspacePath, 32000);
            const snapshotStr = Object.entries(snapshot).map(([p, c]) => `FILE: ${p}\nCONTENT:\n${c}`).join("\n\n---\n\n");

            const critiqueResult = await withAiTimeout(client.execute({
                model: aiConfig.model,
                systemPrompt: critiqueRoute?.prompt || UI_CRITIQUE_PROMPT,
                userPrompt: `Analyze these QA findings and the current codebase for ${slug}.\n\nQA FINDINGS (Selenium Trace):\n${JSON.stringify(qaTrace.slice(-10))}\n\nCURRENT SOURCE:\n${snapshotStr}`,
                requestType: 'json',
                isPriority: options.isPriority ?? true
            } as any, undefined, aiConfig.apiKey ?? ""), "refine-critique") as any;

            if (!critiqueResult.success || !critiqueResult.output) {
                logger.warn("[Refinement] Critique generation failed.");
                return { success: false };
            }

            const rawCritique = typeof critiqueResult.output === 'string'
                ? critiqueResult.output.replace(/```json/g, "").replace(/```/g, "").trim()
                : JSON.stringify(critiqueResult.output);

            const fixResult3 = tryFixJson(rawCritique);
            let critique: any;
            try {
                critique = JSON.parse(fixResult3 ? fixResult3.fixed : rawCritique);
            } catch {
                logger.warn("[Refinement] Critique JSON unparseable   skipping refinement.");
                return { success: false };
            }

            if (critiqueRoute) {
                await adaptiveLearningService.logPromptPerformance({
                    organizationId: orgId,
                    promptVersionId: critiqueRoute.id,
                    promptType: "testing",
                    success: !critique.isCrashed,
                    outputQualityScore: critique.aestheticScore,
                    tokensUsed: critiqueResult.metadata?.tokensUsed || 0,
                    costUsd: "0.0001",
                    latencyMs: 1000
                } as any);
            }

            if (critique.aestheticScore >= 90 && !critique.isCrashed && (critique.defects || []).length === 0) {
                await emitLog(`Critique Passed (${critique.aestheticScore}/100). No refinement necessary.`, 'success');
                return { success: true };
            }

            await emitLog(`Critique Detected Defects: ${critique.defects.join("; ")}`, 'warn');
            await emitLog("Surgical Refinement: Generating patches for stability...", 'info');

            const patchResult = await withAiTimeout(client.execute({
                model: aiConfig.model,
                systemPrompt: architectRoute?.prompt || UI_ARCHITECT_PROMPT,

                userPrompt: `REFINEMENT WAVE: Patch the following defects in "${slug}".

DEFECTS:
${critique.defects.join("\n")}

DIRECTIVES:
${critique.refinementDirectives}

DEFENSIVE RENDERING MANDATE:
- Use \`SafeMap\` from \`@shared/SafeComponent\` to fix any "map of undefined" errors.
- Use explicit null guards and optional chaining (\`?.\`) for all data access.

CURRENT SOURCE:
${snapshotStr}

Output ONLY a JSON object mapping relative file paths to NEW file content. Correct the source files to fix the issues surgically.`,
                requestType: 'json',
                isPriority: options.isPriority ?? true
            } as any, undefined, aiConfig.apiKey ?? ""), "refine-patch") as any;

            if (patchResult.success && patchResult.output) {
                const rawPatches = typeof patchResult.output === 'string'
                    ? patchResult.output.replace(/```json/g, "").replace(/```/g, "").trim()
                    : JSON.stringify(patchResult.output);
                
                const patches = JSON.parse(rawPatches);
                let applied = 0;

                for (const [file, content] of Object.entries(patches)) {
                    if (typeof content !== 'string' || file.startsWith("__")) continue;
                    const fullPath = path.join(workspacePath, file);
                    await fs.mkdir(path.dirname(fullPath), { recursive: true });
                    await fs.writeFile(fullPath, content, 'utf-8');
                    applied++;
                }

                await emitLog(`Refinement complete: Applied ${applied} patches to stabilize the app.`, 'success');
                return { success: true, patches: Object.keys(patches) };
            }

        } catch (err: any) {
            logger.error(`[Refinement] Critical system failure: ${err.message}`);
            await emitLog(`Refinement system error: ${err.message}`, 'error');
        }

        return { success: false };
    },
};
