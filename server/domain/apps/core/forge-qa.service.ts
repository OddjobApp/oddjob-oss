
import { createLogger } from "@server/utils/logger.js";
import { forgeSpecialistService } from "./forge-specialist.service.js";
import { forgeVisionService } from "./forge-vision.service.js";
import { forgeReasoningService } from "./forge-reasoning.service.js";
import { forgeInteractiveVisionService } from "./forge-interactive-vision.service.js";
import { ForgeOptions, WavePlan } from "./forge-types.js";
import { getForgeWorkspacePath } from "./forge-paths.js";
import fs from "node:fs/promises";
import path from "node:path";

const logger = createLogger("ForgeQAService");

export class ForgeQAService {
    async automatedQAAudit(slug: string, options: ForgeOptions, emitLog: Function, workspacePath?: string): Promise<{ success: boolean; findings: string[] }> {
        await emitLog("Hardening: Running multi-agent QA audit and accessibility scan...", 'info', 4);
        
        if (process.env.E2E_FAST_MOCK === 'true') {
            await emitLog("[E2E_FAST_MOCK] Skipping QA Audit...", 'info', 4);
            return { success: true, findings: [] };
        }

        if (options.skipToAssembly === true || !!options.approvedPlan || options.deliveryProfile === 'accelerated') {
            await emitLog("Hardening: Running deterministic build verification...", 'info', 4);
            const { forgeWorkspaceService } = await import("./forge-workspace.service.js");
            let build = await forgeWorkspaceService.runCommand(slug, "npm", ["run", "build"], workspacePath);
            if (!build.success && isTransientNextCssBuildFailure(build)) {
                const buildPath = workspacePath ?? getForgeWorkspacePath(slug);
                await emitLog("Hardening: Clearing transient Next build cache and retrying build verification...", 'warn', 4);
                await fs.rm(path.join(buildPath, ".next"), { recursive: true, force: true }).catch(() => undefined);
                await new Promise((resolve) => setTimeout(resolve, 2000));
                build = await forgeWorkspaceService.runCommand(slug, "npm", ["run", "build"], workspacePath);
            }
            if (build.success) {
                await emitLog("Hardening: Pre-approved build verification passed.", 'success', 4);
                return { success: true, findings: [] };
            }
            return { success: false, findings: [build.stderr || build.error || "Build failure persists."] };
        }

        const findings: string[] = [];
        
        // 1. Specialist Audit (Code Quality)
        const codeResult = await forgeSpecialistService.auditCodebase(slug, options);
        if (!codeResult.success) {
            findings.push(...codeResult.findings);
        }

        // 2. Vision Audit (UI/UX Critique)
        const visionResult = await forgeVisionService.critiqueUI(slug, options);
        if (!visionResult.success) {
            findings.push(...visionResult.findings);
        }

        // 3. Interactive UI Audit (UX Flow & Friction Points)
        // If we have a deployment URL, we can run the deep interactive audit
        const deploymentUrl = options.blackboard?.deploymentUrl;
        if (deploymentUrl) {
            const interactiveResult = await forgeInteractiveVisionService.performInteractiveAudit(deploymentUrl, options.organizationId);
            if (interactiveResult.uxScore < 70) {
                findings.push(...(interactiveResult.frictionPoints || ["Significant UX friction detected."]));
            }
            await emitLog(`Interactive UX Audit: ${interactiveResult.uxScore}% score. Happy Path: ${interactiveResult.happyPath?.join(' -> ')}`, 'info', 4);

            // 3.5 Neuro-Symbolic Evolution (Mach 4: Vision-to-Code Loop)
            // Fix UI friction points detected by the vision agent automatically
            if (interactiveResult.uxScore < 85) {
                await forgeVisionService.evolveUI(
                    options.slug || "", 
                    interactiveResult, 
                    options.organizationId,
                    async (m, l) => emitLog(m, l)
                );
            }
        }

        // 4. Swarm Assembly (Mach 4: Multi-role refinement)
        if (options.blackboard?.files) {
            options.blackboard.files = await forgeSpecialistService.runSwarmAssembly(
                options.blackboard.files, 
                options.description || "", 
                options.organizationId,
                async (m, l) => emitLog(m, l)
            );
        }

        // 5. System 2 Reasoning Audit
        if (options.blackboard?.wavePlan) {
            const reasoningResult = await forgeReasoningService.deepVerify(slug, options, options.blackboard.wavePlan as WavePlan);
            if (!reasoningResult.verificationPassed) {
                findings.push(...(reasoningResult.logicGaps || ["Logic verification failed during deep thinking pass."]));
            }
        }

        // --- OPTIMIZATION: BATCH DIAGNOSTICS ---
        const buildPath = workspacePath ?? getForgeWorkspacePath(slug);
        const isDockerApp = ["go-backend", "python-backend", "java-backend"].includes(options.blueprint || "") ||
                            await fs.access(path.join(buildPath, "Dockerfile")).then(() => true).catch(() => false);

        if (isDockerApp) {
            await emitLog("Hardening: Verifying Docker build compatibility for non-JS/Docker stack...", 'info', 4);
            const { dockerBridgeService } = await import("@domain/core/infrastructure/docker/docker-bridge.service.js");
            const buildRes = await dockerBridgeService.buildImage(buildPath, `oddjob-app/${slug}`, "qa-test");
            
            if (buildRes.success) {
                await emitLog("Docker build compatibility verification passed.", 'success', 4);
                return { success: true, findings: [] };
            } else {
                await emitLog(`Docker build compatibility verification failed: ${buildRes.error}`, 'error', 4);
                return { success: false, findings: [buildRes.error || "Docker compilation build failed."] };
            }
        }

        await emitLog("Hardening: Running comprehensive static & build analysis...", 'info', 4);
        const { forgeWorkspaceService } = await import("./forge-workspace.service.js");

        // Run all checks to collect a full error report
        const pkg = await readPackageJson(workspacePath);
        const hasLintScript = !!pkg?.scripts?.lint;
        const [lint, tsc, build] = await Promise.all([
            hasLintScript
                ? forgeWorkspaceService.runCommand(slug, "npm", ["run", "lint"], workspacePath).catch(e => ({ success: false, stderr: e.message }))
                : Promise.resolve({ success: true, stdout: "No lint script configured; skipped.", stderr: "" }),
            forgeWorkspaceService.runCommand(slug, "npx", ["tsc", "--noEmit"], workspacePath).catch(e => ({ success: false, stderr: e.message })),
            forgeWorkspaceService.runCommand(slug, "npm", ["run", "build"], workspacePath).catch(e => ({ success: false, stderr: e.message }))
        ]);

        if (lint.success && tsc.success && build.success) {
            await emitLog("All static checks passed. App is healthy.", 'success', 4);
            return { success: true, findings: [] };
        }

        // Aggregate errors for the "Omni-Medic"
        const errorReport = {
            lint: !lint.success ? commandOutput(lint) : null,
            tsc: !tsc.success ? commandOutput(tsc) : null,
            build: !build.success ? commandOutput(build) : null
        };

        await emitLog("Hardening: Multiple failures detected. Initiating Omni-Medic healing...", 'warn', 4);
        const diagnosis = await forgeReasoningService.diagnoseOmniFailure(slug, errorReport, options);

        if (diagnosis.canFix && diagnosis.fixProposal) {
            await emitLog(`Omni-Medic: Applying holistic fixes for ${diagnosis.fixProposal.files.length} files...`, 'info', 4);
            for (const file of diagnosis.fixProposal.files) {
                await forgeWorkspaceService.editFile(slug, file.path, file.content, workspacePath);
            }
            
            // Final verification pass
            const finalBuild = await forgeWorkspaceService.runCommand(slug, "npm", ["run", "build"], workspacePath);
            if (finalBuild.success) {
                await emitLog("Omni-healing successful! App is now buildable.", 'success', 4);
                return { success: true, findings: [] };
            }
        }

        if (!lint.success) findings.push("Linting errors persist.");
        if (!tsc.success) findings.push("TypeScript errors persist.");
        if (!build.success) findings.push("Build failure persists.");

        return { success: false, findings };
    }

    /**
     * Skill: Self-Healing Lint
     */
    async lintAudit(slug: string, options: ForgeOptions, emitLog: Function): Promise<{ success: boolean; findings: string[] }> {
        await emitLog("Hardening: Running ESLint and auto-fix loop...", 'info', 4);
        const { forgeWorkspaceService } = await import("./forge-workspace.service.js");

        // Attempt 0: Auto-fix
        await forgeWorkspaceService.runCommand(slug, "npm", ["run", "lint", "--", "--fix"]).catch(() => {});

        // Attempt 1: Check final status
        const lint = await forgeWorkspaceService.runCommand(slug, "npm", ["run", "lint"]);
        if (lint.success) {
            await emitLog("Linting passed successfully.", 'success', 4);
            return { success: true, findings: [] };
        }

        await emitLog("Linting failed. Attempting one-pass AI healing...", 'warn', 4);
        const { forgeReasoningService } = await import("./forge-reasoning.service.js");
        const diagnosis = await forgeReasoningService.diagnoseLintFailure(slug, lint.stdout || lint.stderr || "", options);
        
        if (diagnosis.canFix && diagnosis.fixProposal) {
            for (const file of diagnosis.fixProposal.files) {
                await forgeWorkspaceService.editFile(slug, file.path, file.content);
            }
            // One final check
            const finalLint = await forgeWorkspaceService.runCommand(slug, "npm", ["run", "lint"]);
            if (finalLint.success) return { success: true, findings: [] };
        }

        return { success: false, findings: ["Linting failed after healing attempts."] };
    }

    /**
     * Skill: Self-Healing Type Check
     */
    async typeCheckAudit(slug: string, options: ForgeOptions, emitLog: Function): Promise<{ success: boolean; findings: string[] }> {
        await emitLog("Hardening: Running strict TypeScript type check...", 'info', 4);
        const { forgeWorkspaceService } = await import("./forge-workspace.service.js");

        const tsc = await forgeWorkspaceService.runCommand(slug, "npx", ["tsc", "--noEmit"]);
        if (tsc.success) {
            await emitLog("Type check passed.", 'success', 4);
            return { success: true, findings: [] };
        }

        await emitLog("Type check failed. Triggering AI healing...", 'warn', 4);
        const { forgeReasoningService } = await import("./forge-reasoning.service.js");
        const diagnosis = await forgeReasoningService.diagnoseTypeFailure(slug, tsc.stdout || tsc.stderr || "", options);

        if (diagnosis.canFix && diagnosis.fixProposal) {
            for (const file of diagnosis.fixProposal.files) {
                await forgeWorkspaceService.editFile(slug, file.path, file.content);
            }
            const finalTsc = await forgeWorkspaceService.runCommand(slug, "npx", ["tsc", "--noEmit"]);
            if (finalTsc.success) return { success: true, findings: [] };
        }

        return { success: false, findings: ["TypeScript type errors persist after healing."] };
    }

    /**
     * Skill: Self-Healing Build
     * Runs a trial build and attempts to fix errors using the reasoning agent.
     */
    async buildAudit(slug: string, options: ForgeOptions, emitLog: Function): Promise<{ success: boolean; findings: string[] }> {
        await emitLog("Hardening: Running trial build and self-healing check...", 'info', 4);
        
        const { forgeWorkspaceService } = await import("./forge-workspace.service.js");
        const { forgeReasoningService } = await import("./forge-reasoning.service.js");

        let attempt = 1;
        const maxAttempts = 3;

        while (attempt <= maxAttempts) {
            await emitLog(`Build Attempt ${attempt}/${maxAttempts}...`, 'info', 4);
            const build = await forgeWorkspaceService.runCommand(slug, "npm", ["run", "build"]);

            if (build.success) {
                await emitLog("Build successful! No self-healing required.", 'success', 4);
                return { success: true, findings: [] };
            }

            await emitLog(`Build failed (Attempt ${attempt}). Triggering reasoning agent for diagnosis...`, 'warn', 4);
            const diagnosis = await forgeReasoningService.diagnoseBuildFailure(slug, build.stderr || build.error || "Unknown build error", options);
            
            if (diagnosis.canFix && diagnosis.fixProposal) {
                await emitLog(`Reasoning: Applying fix for: ${diagnosis.errorCategory}`, 'info', 4);
                for (const file of diagnosis.fixProposal.files) {
                    await forgeWorkspaceService.editFile(slug, file.path, file.content);
                }
                attempt++;
            } else {
                await emitLog(`Reasoning: Unable to automatically fix this build error: ${diagnosis.errorCategory}`, 'error', 4);
                return { success: false, findings: [`Build failed: ${diagnosis.errorCategory} - ${diagnosis.summary}`] };
            }
        }

        return { success: false, findings: ["Build failed consistently after 3 self-healing attempts."] };
    }

    async performStructuralQA(slug: string): Promise<{ success: boolean; findings: string[] }> {
        const findings: string[] = [];
        try {
            const { podRegistry } = await import("@domain/core/infrastructure/pod-registry.service.js");
            const xray = podRegistry.getPodSync<any>('xray');
            const graph = await xray.queryGraph(slug);
            
            const routes = graph.nodes.filter((n: any) => n.kind === 'code_function' && n.name.includes(' '));
            const dbCalls = graph.nodes.filter((n: any) => n.name.startsWith('DB '));

            if (routes.length === 0) findings.push("No API routes detected via structural scan.");
            if (dbCalls.length === 0) findings.push("No database interactions detected.");

            return { success: findings.length === 0, findings };
        } catch (err: any) {
            return { success: false, findings: [`QA Scan failed: ${err.message}`] };
        }
    }
}

export const forgeQAService = new ForgeQAService();

async function readPackageJson(workspacePath?: string): Promise<any | null> {
    if (!workspacePath) return null;
    try {
        return JSON.parse(await fs.readFile(path.join(workspacePath, "package.json"), "utf-8"));
    } catch {
        return null;
    }
}

function commandOutput(result: unknown): string {
    const value = result as { stdout?: string; stderr?: string; error?: string };
    return value.stdout || value.stderr || value.error || "";
}

function isTransientNextCssBuildFailure(result: unknown): boolean {
    const output = commandOutput(result).toLowerCase();
    return output.includes("mini-css-extract-plugin") || output.includes("styles/globals.css");
}
