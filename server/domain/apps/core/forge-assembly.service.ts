
import { createLogger } from "@server/utils/logger.js";
import { forgeCodegenService } from "./forge-codegen.service.js";
import { KNOWN_SAFE_VERSIONS } from "./forge-dependency.service.js";
import { ForgeOptions, WavePlan, ArchitectureProposal } from "./forge-types.js";
import { forgeWorkspaceService } from "./forge-workspace.service.js";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs/promises";
import { getForgeWorkspacePath } from "./forge-paths.js";
import { tenantProcessEnv } from "@server/utils/tenant-process-env.js";

const exec = promisify(execCallback);
const logger = createLogger("ForgeAssemblyService");
const BLUEPRINT_ROOT = path.resolve("server/blueprints/apps");

export class ForgeAssemblyService {
    async assemblyPhase(
        slug: string, 
        blueprintSlug: string,
        options: ForgeOptions, 
        wavePlan: WavePlan, 
        architecture: ArchitectureProposal, 
        emitLog: Function,
        workspacePath?: string
    ): Promise<boolean> {
        await emitLog("Assembly: Forging application from progressive build waves...", 'info', 3);
        
        // --- PREDICTIVE LEVERAGE (Option 3) ---
        try {
            const { forgePredictor } = await import("../../prediction-intelligence/prediction/forge-predictor.js");
            const { randomUUID } = await import("crypto");
            
            const prediction = await forgePredictor.predictForgeFailure(slug, blueprintSlug, options, {
                mode: "realtime",
                now: new Date().toISOString(),
                requestId: `forge-${randomUUID()}`,
                correlationId: `forge-${slug}`
            });
            
            if (prediction.failProbability > 0.5) {
                await emitLog(`[Prediction] Risk of failure detected: ${(prediction.failProbability * 100).toFixed(0)}%. Reason: ${prediction.reason}`, 'warn', 3);
                if (prediction.suggestedAction === "pause") {
                    await emitLog(`[Prediction] Suggested action: ${prediction.suggestedAction}. Proceeding with caution.`, 'warn', 3);
                }
            }
        } catch (err: any) {
            logger.error(`[ForgeAssemblyService] Prediction failed: ${err.message}`);
        }
        
        const buildPath = workspacePath ?? getForgeWorkspacePath(slug);
        const sourceBlueprintPath = path.join(BLUEPRINT_ROOT, blueprintSlug);
        await fs.mkdir(buildPath, { recursive: true });
        const existingEntries = await fs.readdir(buildPath, { withFileTypes: true }).catch(() => []);
        for (const entry of existingEntries) {
            if (entry.name === "node_modules") continue;
            await fs.rm(path.join(buildPath, entry.name), { recursive: true, force: true });
        }
        await fs.cp(sourceBlueprintPath, buildPath, {
            recursive: true,
            filter: (source) => {
                const name = path.basename(source);
                return !["node_modules", ".next", "dist", ".git"].includes(name);
            }
        });
        await emitLog(`Assembly: Blueprint scaffold "${blueprintSlug}" copied into workspace.`, "success", 3);

        if (process.env.E2E_FAST_MOCK === 'true' || options.skipToAssembly === true || !!options.approvedPlan) {
            await emitLog(`Assembly: Pre-approved lifecycle detected. Provisioning base blueprint without AI codegen.`, 'info', 3);
            await forgeWorkspaceService.injectSlotTokens(slug, options, blueprintSlug, buildPath);
            await forgeWorkspaceService.injectBuildConfig(slug, blueprintSlug, buildPath);
            await forgeWorkspaceService.sanitizeImports(slug, buildPath);
            return true;
        }

        // --- REFACTOR: Use the monolithic orchestrator in ForgeCodegenService ---
        // This orchestrator handles all waves, tasks, and parallel execution internally.
        const result = await forgeCodegenService.generateBlueprintFiles(
            slug,
            blueprintSlug,
            options,
            options.jobId,
            undefined, // traceContext
            buildPath,
            1.0,
            undefined, // devPlan
            architecture,
            false, // iterativeMode
            undefined // targetWaveId (undefined = all waves)
        );

        if (!result.success) {
            await emitLog(`Assembly failed during AI codegen.`, 'error', 3);
            return false;
        }

        await forgeWorkspaceService.injectBuildConfig(slug, blueprintSlug, buildPath);
        await forgeWorkspaceService.sanitizeImports(slug, buildPath);

        return true;
    }

    async syncDependencies(slug: string, blueprintSlug: string, emitLog: Function, workspacePath?: string): Promise<void> {
        const buildPath = workspacePath ?? getForgeWorkspacePath(slug);
        const isDockerApp = ["go-backend", "python-backend", "java-backend"].includes(blueprintSlug || "");
        if (isDockerApp) {
            await emitLog("Hardening: Non-JS stack detected. Warming of package caches is handled in-container.", 'info', 4);
            return;
        }

        await emitLog("Hardening: Synchronizing dependencies and warming caches...", 'info', 4);
        const childEnv = tenantProcessEnv({ NODE_ENV: 'production' });

        try {
            // Check if we can use a pre-warmed cache
            // (Logic omitted for brevity, but would involve checking BLUEPRINT_ROOT etc.)
            await exec('npm install --no-audit --no-fund --legacy-peer-deps --no-package-lock --no-save', {
                cwd: buildPath,
                timeout: 300_000, // 5 minutes
                env: childEnv as any,
            });
        } catch (err: any) {
            await emitLog(`Dependency sync failed: ${err.message}`, 'warn', 5);
        }
    }
}

export const forgeAssemblyService = new ForgeAssemblyService();
