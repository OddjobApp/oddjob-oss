import { tenantProcessEnv } from "@server/utils/tenant-process-env.js";
import { assertLocalTenantExecutionAllowed } from "@server/utils/local-tenant-execution.js";

import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { apps, blueprints, missionRuns } from "@shared/schema/index.js";
import { eq, desc, and, sql } from "drizzle-orm";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { eventStream as eventStreamService } from "@domain/core/infrastructure/event-stream.service.js";
import fs from "node:fs/promises";
import { decisionRouter } from "@domain/governor/core/decision-router.js";
import { knowledgePackService } from "@domain/knowledge-packs/knowledge-pack.service.js";

// New specialized services
import { forgeInfrastructureService } from "./core/forge-infrastructure.service.js";
import { forgeWorkspaceService } from "./core/forge-workspace.service.js";
import { forgeLifecycleService } from "./core/forge-lifecycle.service.js";
import { forgeAssemblyService } from "./core/forge-assembly.service.js";
import { forgeQAService } from "./core/forge-qa.service.js";
import { forgeBlueprintService } from "./core/forge-blueprint.service.js";
import { getForgeWorkspacePath } from "./core/forge-paths.js";
import { forgeDraftService } from "./core/forge-draft.service.js";
import { blueprintRegistryService } from "./blueprint-registry.service.js";
import { scaffoldRegistryService } from "@domain/scaffold/scaffold-registry.service.js";
import { SATScaffoldResolver } from "@domain/scaffold/sat-scaffold-resolver.js";
import { forgeLiveAssemblyService } from "./core/forge-live-assembly.service.js";

// Re-export types for backward compatibility
export * from "./core/forge-types.js";
import { ForgeOptions, WavePlan, ArchitectureProposal } from "./core/forge-types.js";

const logger = createLogger("AppForgeService");

const MAX_RECURSIVE_DEPTH = 3;

async function assertForgeSlugAvailableForOrg(slug: string, organizationId?: number): Promise<void> {
    if (!organizationId) return;

    const [existingApp] = await db.select({
        id: apps.id,
        slug: apps.slug,
        developerOrgId: apps.developerOrgId,
        organizationId: apps.organizationId,
    })
        .from(apps)
        .where(eq(apps.slug, slug))
        .limit(1);

    if (!existingApp) return;

    const ownerOrgId = existingApp.developerOrgId ?? existingApp.organizationId ?? null;
    if (ownerOrgId !== organizationId) {
        throw new Error(`App slug "${slug}" is already owned by another organization. Choose a different slug.`);
    }
}

export class AppForgeService {
    /**
     * Entry point for forging a new app.
     * Queues a background job and returns the jobId immediately.
     */
    async forgeApp(blueprintSlug: string, options: ForgeOptions) {
        const blackboard = options.blackboard || {};
        const currentDepth = blackboard.forge_depth || 0;
        if (currentDepth >= MAX_RECURSIVE_DEPTH) {
            throw new Error(`Maximum recursive forging depth reached. Recursive spawning blocked.`);
        }

        forgeInfrastructureService.assertSafeSlug(options.slug);
        forgeInfrastructureService.assertSafeSlug(blueprintSlug);
        await assertForgeSlugAvailableForOrg(options.slug, options.organizationId);
        const [blueprint] = await db.select({ manifest: blueprints.manifest })
            .from(blueprints)
            .where(eq(blueprints.slug, blueprintSlug))
            .limit(1);
        const blueprintManifest = blueprint?.manifest as Record<string, unknown> | undefined;

        if (options.organizationId) {
            const registryBlueprint = blueprint ? null : await blueprintRegistryService.get(blueprintSlug, options.organizationId);
            const governanceManifest = blueprintManifest
                ?? (registryBlueprint?.governanceDependencies ? { governance_dependencies: registryBlueprint.governanceDependencies } : undefined);
            if (governanceManifest) {
                const dependencyCheck = await knowledgePackService.checkBlueprintDependencies(options.organizationId, governanceManifest);
                if (!dependencyCheck.activatable) throw new Error(`Blueprint governance dependencies are not satisfied: ${dependencyCheck.issues.join(" ")}`);
            }
        }

        const manifestPacks = Array.isArray(blueprintManifest?.scaffoldPacks)
            ? blueprintManifest.scaffoldPacks.filter((id): id is string => typeof id === "string")
            : [];
        const requestedPacks = options.scaffoldPacks?.length ? options.scaffoldPacks : manifestPacks;
        if (requestedPacks.length > 0) {
            const availablePacks = await scaffoldRegistryService.loadAllPacks(true);
            const resolution = new SATScaffoldResolver(availablePacks).solve(requestedPacks, {
                includeRecommendations: true,
            });
            if (!resolution.satisfiable) {
                throw new Error(`Scaffold pack resolution failed: ${resolution.proofExplanation}`);
            }
            options.scaffoldPacks = resolution.selectedPacks.map((pack) => pack.id);
            options.assemblyPlan = {
                requestedPacks: [...requestedPacks],
                selectedPacks: resolution.selectedPacks.map((pack) => pack.id),
                executionOrder: resolution.executionOrder.map((pack) => pack.id),
                proofExplanation: resolution.proofExplanation,
            };
        }
        
        const jobId = options.jobId || `forge-${options.slug}-${Date.now()}`;
        const activeKey = `forge:active:${options.slug}`;
        const existingActiveJobId = await redis.get(activeKey).catch(() => null);
        if (existingActiveJobId && existingActiveJobId !== jobId) {
            const rawExisting = await redis.get(`forge:job:${existingActiveJobId}`).catch(() => null);
            let existingStatus = "unknown";
            try { existingStatus = rawExisting ? JSON.parse(rawExisting).status : "unknown"; } catch { /* ignore corrupt status */ }
            if (["queued", "running", "building", "awaiting_strategy_approval", "awaiting_architecture_approval", "awaiting_wave_approval"].includes(existingStatus)) {
                throw new Error(`A forge is already running for "${options.slug}" (job ${existingActiveJobId}).`);
            }
            await redis.del(activeKey).catch(() => {});
        }
        if (!existingActiveJobId) {
            const claimed = await redis.set(activeKey, jobId, "EX", 86400, "NX");
            if (!claimed) {
                throw new Error(`A forge is already running for "${options.slug}".`);
            }
        }

        const { queueForgeJob } = await import("./infrastructure/forge-queue.js");

        logger.info(`[AppForge] Queuing forge request for ${options.slug}`);

        await redis.set(`forge:config:${jobId}`, JSON.stringify({ blueprintSlug, options }), 'EX', 86400);
        await forgeDraftService.createOrUpdateDraft({
            jobId,
            blueprintSlug,
            options,
            status: 'queued',
            progress: 0,
            message: `Forge request accepted. Pending worker availability.`,
        });

        await redis.set(`forge:job:${jobId}`, JSON.stringify({
            status: 'queued',
            progress: 0,
            message: `Forge request accepted. Pending worker availability.`,
            updatedAt: new Date().toISOString(),

            jobId,
            slug: options.slug,
            blueprintSlug,
            options
        }), 'EX', 86400);

        try {
            await queueForgeJob({ blueprintSlug, options, jobId });
        } catch (err: any) {
            await redis.del(activeKey).catch(() => {});
            await forgeDraftService.updateDraft(jobId, {
                status: 'failed',
                error: err.message,
                message: `Forge queueing failed: ${err.message}`,
            });
            throw err;
        }

        if (options.oddjobMissionId) {
            try {
                const [latestRun] = await db.select({ id: missionRuns.id })
                    .from(missionRuns)
                    .where(eq(missionRuns.missionId, options.oddjobMissionId))
                    .orderBy(desc(missionRuns.createdAt))
                    .limit(1);
                if (latestRun) {
                    await db.update(missionRuns)
                        .set({ status: 'running', updatedAt: new Date() })
                        .where(eq(missionRuns.id, latestRun.id));
                }
            } catch (dbErr: any) {
                logger.warn(`[Forge:Queue] Failed to reset mission run status: ${dbErr.message}`);
            }
        }

        return { success: true, jobId };
    }

    /**
     * The actual industrial forge execution logic (Called by ForgeWorker).
     * Orchestrates the 7-Stage Lifecycle.
     */
    async forgeAppInternal(blueprintSlug: string, options: ForgeOptions, jobId?: string) {
        const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
        
        const STAGE_PROGRESS: Record<number, number> = {
            0: 5,   // Discovery
            1: 15,  // Strategy
            2: 25,  // Architecture Review
            3: 40,  // Assembly
            4: 65,  // Hardening
            5: 85,  // Industrialization
            6: 98,  // Ignition
        };

        const emitLog = async (message: string, level: 'info' | 'warn' | 'error' | 'success' = 'info', stage?: number, metadata?: any) => {
            logger.info(`[Forge:${options.slug}] ${message}`);
            if (jobId) {
                const progress = stage !== undefined ? STAGE_PROGRESS[stage] : undefined;
                await eventStream.publish("FORGE_LOG", {
                    jobId,
                    message,
                    level,
                    timestamp: new Date().toLocaleTimeString(),
                    ...(stage !== undefined && { stage, progress }),
                    ...metadata
                }, { organizationId: options.organizationId || null }, "app-forge");

                if (stage !== undefined && progress !== undefined) {
                    await redis.set(`forge:job:${jobId}`, JSON.stringify({
                        status: 'building',
                        progress,
                        stage,
                        message,
                        updatedAt: new Date().toISOString(),
                        jobId,
                        slug: options.slug,
                        blueprintSlug,
                        options
                    }), 'EX', 86400);
                    await forgeDraftService.updateDraft(jobId, {
                        status: 'building',
                        progress,
                        stage,
                        message,
                        lastEvent: {
                            level,
                            message,
                            timestamp: new Date().toISOString(),
                        },
                    });
                }
            }
        };

        if (options.assemblyPlan) {
            await emitLog(
                `SAT-certified scaffold plan: ${options.assemblyPlan.executionOrder.join(" → ")}`,
                'success',
                0,
                { assemblyPlan: options.assemblyPlan },
            );
        }

        let claimedWarmContainer = false;
        try {
            const warmContainer = options.warmLeaseId
                ? await forgeInfrastructureService.claimWarmContainer(options.slug, options.warmLeaseId)
                : null;
            const workspacePath = warmContainer?.workspacePath ?? getForgeWorkspacePath(options.slug);
            if (warmContainer) {
                claimedWarmContainer = true;
                await emitLog(`Provisioning: Claimed warm container on port ${warmContainer.port}.`, "success", 3);
                options.blackboard = {
                    ...(options.blackboard || {}),
                    warmContainerPort: warmContainer.port,
                    deploymentUrl: `http://localhost:${warmContainer.port}`
                };
            }

            // Resolve a real component-gallery composition immediately. This is a
            // durable preview artifact, not simulated progress: every block named
            // here is a block that exists in block-registry.json, and the progress
            // modal lists them with live per-block status while codegen continues.
            options.liveAssembly = await forgeLiveAssemblyService.plan(blueprintSlug, options);
            await emitLog(
                `UI Assembly: Selected ${options.liveAssembly.blocks.length} component-gallery blocks for the live preview.`,
                'success',
                0,
                { liveAssembly: options.liveAssembly },
            );

            // A build is a long chain of AI calls and container work; there is no
            // safe way to tear one down mid-step from outside, so cancellation is
            // cooperative. cancelForgeJob raises a flag and this reads it between
            // stages, which bounds how long a cancelled build keeps burning spend.
            const abortIfCancelled = async (stageName: string) => {
                if (!jobId) return;
                const { isForgeCancelled } = await import("./infrastructure/forge-queue.js");
                if (await isForgeCancelled(jobId)) {
                    await emitLog(`Cancelled before ${stageName}.`, 'warn');
                    const cancelled: any = new Error(`Forge job ${jobId} was cancelled.`);
                    cancelled.forgeCancelled = true;
                    throw cancelled;
                }
            };

            // Stage 0: Discovery
            await abortIfCancelled("discovery");
            const features = await forgeLifecycleService.discoveryPhase(options, blueprintSlug, emitLog);

            // Stage 1: Strategy (Planning)
            await abortIfCancelled("strategy");
            const wavePlan = await forgeLifecycleService.planningPhase(options, features, emitLog, blueprintSlug);
            if (!options.blackboard) options.blackboard = {};
            options.blackboard.wavePlan = wavePlan; // Store for System 2 Reasoning in QA phase
            await emitLog("Strategy: Wave Plan finalized.", 'info', 1, { wavePlan });

            // Stage 2: Architecture Review
            await abortIfCancelled("architecture");
            const proposal = await forgeLifecycleService.architecturePhase(options, wavePlan, emitLog, blueprintSlug);
            await emitLog("Architecture: Technical proposal generated.", 'info', 2, { proposal });

            // Refine the preview with any explicit platform block choices made by
            // the architecture agent, while retaining a safe gallery composition
            // when the proposal only names generated components.
            options.liveAssembly = await forgeLiveAssemblyService.plan(blueprintSlug, options, proposal);
            await emitLog("UI Assembly: Architecture mapped to renderable gallery components.", 'success', 2, {
                liveAssembly: options.liveAssembly,
            });

            // Stage 3: Assembly
            await abortIfCancelled("assembly");
            options.liveAssembly = forgeLiveAssemblyService.withStatus(options.liveAssembly, 'assembling', 'assembling');
            await emitLog("UI Assembly: Mounting selected components into the application shell.", 'info', 3, {
                liveAssembly: options.liveAssembly,
            });
            const assemblySuccess = await forgeAssemblyService.assemblyPhase(options.slug, blueprintSlug, options, wavePlan, proposal, emitLog, workspacePath);
            if (!assemblySuccess) {
                // Otherwise the preview stays frozen mid-"assembling" forever: the
                // type carries a failed phase that nothing was setting.
                options.liveAssembly = forgeLiveAssemblyService.withStatus(options.liveAssembly, 'failed', 'failed');
                await emitLog("UI Assembly: Composition could not be mounted.", 'error', 3, {
                    liveAssembly: options.liveAssembly,
                });
                throw new Error("Assembly failed.");
            }
            options.liveAssembly = forgeLiveAssemblyService.withStatus(options.liveAssembly, 'mounted', 'preview');
            await emitLog("UI Assembly: Gallery composition mounted; validating the live application.", 'success', 3, {
                liveAssembly: options.liveAssembly,
            });

            // Stage 4: Dependencies must be present before QA can produce a meaningful result.
            await forgeAssemblyService.syncDependencies(options.slug, blueprintSlug, emitLog, workspacePath);

            // Stage 5: Hardening (QA)
            await abortIfCancelled("hardening");
            const qaResult = await forgeQAService.automatedQAAudit(options.slug, options, emitLog, workspacePath);
            if (!qaResult.success) {
                await emitLog(`Hardening findings: ${qaResult.findings.join(', ')}`, 'warn', 4);
                throw new Error(`QA failed: ${qaResult.findings.join(', ')}`);
            }

            await emitLog("Industrialization: Promoting build artifacts and preparing production image...", "info", 5);
            const canonicalWorkspace = getForgeWorkspacePath(options.slug);
            if (workspacePath !== canonicalWorkspace) {
                await fs.rm(canonicalWorkspace, { recursive: true, force: true });
                await fs.mkdir(canonicalWorkspace, { recursive: true });
                await fs.cp(workspacePath, canonicalWorkspace, {
                    recursive: true,
                    filter: (source) => !["node_modules", ".next", "dist"].includes(source.split(/[\\/]/).pop() || "")
                });
                await emitLog("Industrialization: Warm workspace promoted to canonical app workspace.", "success", 5);
            }

            // Stage 6: Ignition (Deployment)
            await abortIfCancelled("ignition");
            await emitLog("Ignition: Running governance check before deployment...", 'info', 6);

            // --- Governance Gate: check org policy and app plan review status ---
            const sessionId = `forge-${options.slug}-${jobId || Date.now()}`;
            const orgId = options.organizationId;

            // Read forge settings to check requireApprovalForAll (stored as extended JSON field)
            let requireApprovalForAll = false;
            let appPlanReviewPending = false;
            if (orgId) {
                try {
                    const rawSettings = await redis.get(`forge:settings:org:${orgId}`);
                    if (rawSettings) {
                        const parsed = JSON.parse(rawSettings);
                        requireApprovalForAll = parsed.requireApprovalForAll === true;
                    }
                } catch (_) { /* non-fatal — proceed without flag */ }

                // Check if the existing app record (if any) has planReviewStatus === "pending"
                try {
                    const [existingApp] = await db.select({ planReviewStatus: apps.planReviewStatus })
                        .from(apps)
                        .where(and(eq(apps.slug, options.slug), eq(apps.organizationId, orgId)))
                        .limit(1);
                    if (existingApp?.planReviewStatus === "pending") {
                        appPlanReviewPending = true;
                    }
                } catch (_) { /* non-fatal */ }
            }

            const preApprovedLifecycle = process.env.E2E_FAST_MOCK === 'true' || options.skipToAssembly === true || !!options.approvedPlan;
            const needsInstallApproval = !preApprovedLifecycle && (requireApprovalForAll || appPlanReviewPending);
            if (needsInstallApproval) {
                if (process.env.E2E_FAST_MOCK === 'true') {
                    await emitLog("[E2E_FAST_MOCK] Bypassing governance approval for app installation.", 'info', 6);
                } else {
                    await emitLog("Ignition: Requesting governance approval for app installation...", 'warn', 6);
                    const installDecision = await decisionRouter.requestDecision({
                        sessionId,
                        executionId: jobId || sessionId,
                        tool: "FORGE_INSTALL_APP",
                        params: { slug: options.slug, organizationId: orgId },
                        goal: `Install forged app '${options.name}' for organization ${orgId}.`,
                        description: appPlanReviewPending
                            ? `App '${options.slug}' has a pending plan review and requires approval before installation.`
                            : `Organization policy requires approval for all forge deployments.`,
                        riskLevel: "medium",
                        approverType: "internal",
                        approverId: undefined,
                        organizationId: orgId,
                        channels: ["inbox", "copilot"],
                    });
                    if (!installDecision.approved) {
                        throw new Error(`Forge deployment blocked by governance: install approval was denied for '${options.slug}'.`);
                    }
                    await emitLog("Ignition: Install governance approval granted.", 'success', 6);
                }
            }

            await emitLog("Ignition: Registering application in platform registry...", 'info', 6);
            await assertForgeSlugAvailableForOrg(options.slug, options.organizationId);

            // Retrieve Tokenized UI template if it exists in the Knowledge Graph
            let tokenizedUI: any = null;
            try {
                const { knowledgeNodes } = await import("@shared/schema/index.js");
                const [kgNode] = await db
                    .select()
                    .from(knowledgeNodes)
                    .where(
                        and(
                            eq(knowledgeNodes.label, "AppBlueprint"),
                            eq(knowledgeNodes.externalId, `blueprint-${blueprintSlug}`)
                        )
                    )
                    .limit(1);
                if (kgNode && (kgNode.data as any)?.tokenizedUI) {
                    tokenizedUI = (kgNode.data as any).tokenizedUI;
                    await emitLog(`Ignition: Loaded Tokenized UI layout from Knowledge Graph blueprint node.`, 'info', 6);
                }
            } catch (kgErr: any) {
                logger.warn(`Failed to retrieve tokenized UI from KG: ${kgErr.message}`);
            }

            const { appRegistryService } = await import("./app-registry.service.js");

            // Resolve project space for this app so it appears in Project Space / Apps
            let targetProjectId = options.projectId;
            if (!targetProjectId && options.organizationId) {
                try {
                    const { projectService } = await import("@domain/projects/core/project.service.js");
                    const defaultProj = await projectService.ensureDefaultProject({
                        organizationId: options.organizationId,
                        isOrgAdmin: true,
                    });
                    if (defaultProj) targetProjectId = defaultProj.id;
                } catch (pErr: any) {
                    logger.warn(`Could not resolve default project for org ${options.organizationId}: ${pErr.message}`);
                }
            }

            // 1. Register the app in the global registry
            const app = await appRegistryService.registerApp({
                name: options.name,
                slug: options.slug,
                description: options.description,
                blueprintSlug: blueprintSlug,
                developerOrgId: options.organizationId,
                organizationId: options.organizationId,
                projectId: targetProjectId,
                isPublic: false, // Forged apps are private to the org by default
                config: {
                    theme: options.theme,
                    apiInstructions: options.apiInstructions,
                    oddjobMissionId: options.oddjobMissionId,
                    ...(tokenizedUI ? { tokenizedUI } : {}),
                    ...options.blackboard
                },
                dockerImage: tokenizedUI ? undefined : `oddjob-app/${options.slug}:v1`, // Standard naming convention
                status: 'draft',
                version: '1.0.0'
            });

            // 2. Install the app for the organization
            if (options.organizationId) {
                await emitLog(`Ignition: Installing ${options.name} for organization ${options.organizationId}...`, 'info', 6);
                try {
                    await appRegistryService.installApp(app.id, options.organizationId);
                } catch (installErr: any) {
                    if (installErr.message?.includes('already installed')) {
                        await emitLog(`Ignition: App is already installed. Proceeding...`, 'info', 6);
                    } else {
                        throw installErr;
                    }
                }
            }

            // Create a versioned release record before build
            await emitLog("Ignition: Creating versioned release record...", 'info', 6);
            let releaseId: number | undefined;
            try {
                const { forgeReleaseService } = await import("./core/forge-release.service.js");
                const forgeQAEvidence: Record<string, unknown> = {
                    qaSuccess: qaResult.success,
                    findings: qaResult.findings,
                    forgedAt: new Date().toISOString(),
                    blueprintSlug,
                };
                const release = await forgeReleaseService.createRelease(app.id, forgeQAEvidence, options.organizationId);
                releaseId = release.id;
                await emitLog(`Ignition: Release v${release.version} staged (id=${release.id}).`, 'info', 6);
            } catch (releaseErr: any) {
                logger.warn(`[Forge:${options.slug}] Failed to create release record: ${releaseErr.message}`);
            }

            // Container build during Forge Ignition is an intrinsic, automated lifecycle step
            await emitLog("Ignition: Container build initiated for forge deployment.", 'info', 6);

            if (app.dockerImage) {
                await emitLog("Ignition: Building production image and launching application container...", 'info', 6);
                const { appBuilderService } = await import("./app-builder.service.js");
                const buildResult = await appBuilderService.buildContainer(app.id, options.slug);
                if (!buildResult.success) {
                    throw new Error(buildResult.error || "Production image build failed.");
                }
                await emitLog("Ignition: Production image built and container launched.", 'success', 6);
            } else {
                await emitLog("Ignition: App uses Tokenized UI framework. Skipping Docker build and container deployment.", 'success', 6);
            }

            const { appReadinessService } = await import("./core/app-readiness.service.js");
            const readiness = await appReadinessService.getAppReadiness(app.id, options.organizationId, { probeRuntime: false });
            await emitLog(
                readiness.ready
                    ? "Readiness: App passed deployment readiness checks."
                    : `Readiness: App has ${readiness.summary.fail} failed and ${readiness.summary.warn} warning checks.`,
                readiness.ready ? 'success' : 'warn',
                6
            );

            // Mark release as deployed
            if (releaseId) {
                try {
                    const { forgeReleases } = await import("@shared/schema/apps/forge-releases.js");
                    await db.update(forgeReleases).set({
                        status: "deployed",
                        deployedAt: new Date(),
                        deployedBy: options.organizationId ? String(options.organizationId) : "forge",
                    }).where(eq(forgeReleases.id, releaseId));
                } catch (deployMarkErr: any) {
                    logger.warn(`[Forge:${options.slug}] Failed to mark release as deployed: ${deployMarkErr.message}`);
                }
            }

            // Mark app status as active in DB so it reflects in Project Space and App Arsenal
            try {
                await db.update(apps).set({
                    status: 'active',
                    updatedAt: new Date()
                }).where(eq(apps.id, app.id));
            } catch (statusErr: any) {
                logger.warn(`[Forge:${options.slug}] Failed to update app ${app.id} status to active: ${statusErr.message}`);
            }

            // Final status update
            if (jobId) {
                await redis.set(`forge:job:${jobId}`, JSON.stringify({
                    status: 'completed',
                    progress: 100,
                    message: 'Application successfully forged and deployed.',
                    updatedAt: new Date().toISOString(),
                    jobId,
                    slug: options.slug,
                    appId: app.id,
                    blueprintSlug,
                    readiness,
                    options
                }), 'EX', 86400);
                await forgeDraftService.updateDraft(jobId, {
                    status: 'completed',
                    progress: 100,
                    message: 'Application successfully forged and deployed.',
                    appId: app.id,
                    readiness,
                });
                await emitLog(
                    'Application successfully forged and deployed.',
                    'success',
                    6,
                    { status: 'completed', appId: app.id, slug: options.slug }
                );
            }

            return { success: true, appId: app.id, readiness };
        } catch (err: any) {
            await emitLog(`Forge failed: ${err.message}`, 'error');

            // Route build/QA failures into the Knowledge Base Question Engine
            // so recurring blueprint failures can be surfaced for human review.
            if (options.organizationId) {
                try {
                    const { knowledgeBaseQuestionEngineService } = await import(
                        "@domain/agents/core/knowledge-base-question-engine.service.js"
                    );
                    await knowledgeBaseQuestionEngineService.createQuestion(
                        options.organizationId,
                        `forge:${blueprintSlug}`,
                        "predictive_failure",
                        {
                            filePaths: [`blueprints/${blueprintSlug}`],
                            errorCategory: "forge_build_failure",
                            errorMessage: err.message,
                            blueprintSlug,
                            appSlug: options.slug,
                            forgeJobId: jobId,
                        }
                    );
                } catch (qeErr: any) {
                    logger.warn(`[Forge] Question engine routing failed: ${qeErr.message}`);
                }
            }

            if (jobId) {
                await redis.set(`forge:job:${jobId}`, JSON.stringify({
                    status: 'failed',
                    error: err.message,
                    message: `Forge process aborted: ${err.message}`,
                    updatedAt: new Date().toISOString(),
                    jobId,
                    slug: options.slug,
                    blueprintSlug,
                    options
                }), 'EX', 86400);
                await forgeDraftService.updateDraft(jobId, {
                    status: 'failed',
                    error: err.message,
                    message: `Forge process aborted: ${err.message}`,
                });
            }
            throw err;
        } finally {
            if (claimedWarmContainer) {
                await forgeInfrastructureService.releaseClaimedContainer(options.slug, true).catch((releaseErr: any) => {
                    logger.warn(`[Forge:${options.slug}] Failed to release warm container: ${releaseErr.message}`);
                });
            }
        }
    }

    /**
     * Forensic audit of a forge job's lifecycle.
     */
    async diagnoseJob(jobId: string) {
        logger.info(`[Forensics] Diagnosing job ${jobId}...`);
        // delegate to infra service for deep checks if needed, or keep here for now
        return { jobId, status: 'diagnosing', timestamp: new Date().toISOString() };
    }

    /**
     * Marks stagnant jobs as failed.
     */
    async cleanupStagnantJobs(): Promise<number> {
        logger.info("[Forge] Scanning for stagnant jobs...");
        const keys = await redis.keys('forge:job:*');
        let cleaned = 0;
        const now = Date.now();
        const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

        for (const key of keys) {
            const raw = await redis.get(key);
            if (!raw) continue;
            try {
                const job = JSON.parse(raw);
                const updatedAt = job.updatedAt ? new Date(job.updatedAt).getTime() : 0;
                if ((job.status === 'building' || job.status === 'pending') && (now - updatedAt > FOUR_HOURS_MS)) {
                    await redis.set(key, JSON.stringify({
                        ...job,
                        status: 'failed',
                        error: 'Job timed out.',
                        updatedAt: new Date().toISOString()
                    }), 'EX', 86400);
                    cleaned++;
                }
            } catch (err) { /* ignore */ }
        }
        return cleaned;
    }

    /**
     * Ensures a specific number of warm forge instances are ready.
     */
    async ensureWarmPool(size: number) {
        return forgeInfrastructureService.ensureWarmPool(size);
    }

    /**
     * Checks the health of the industrial pool and restarts dead instances.
     */
    async verifyPoolIntegrity() {
        return forgeInfrastructureService.verifyPoolIntegrity();
    }

    /**
     * Takes a user's raw idea and returns a structured Business Case.
     */
    async analyzeIdea(idea: string, organizationId?: number) {
        return forgeLifecycleService.analyzeIdea(idea, organizationId);
    }

    /**
     * Discovers relevant existing platform assets based on a business case.
     */
    async discoverAssets(businessCase: any, organizationId?: number) {
        return forgeLifecycleService.discoverAssets(businessCase, organizationId);
    }

    /**
     * Generates a logical architecture diagram from a business case.
     */
    async generateDiagram(businessCase: any, assets: any[]) {
        return forgeLifecycleService.generateDiagram(businessCase, assets);
    }

    /**
     * Runs pre-flight checks (Forecaster, Compliance) for a proposed app.
     */
    async runPreFlightCheck(businessCase: any, diagram: any, organizationId?: number) {
        return forgeLifecycleService.runPreFlightCheck(businessCase, diagram, organizationId);
    }

    // --- Delegation Methods for Tools & Codegen ---

    async editFile(slug: string, filePath: string, content: string) {
        return forgeWorkspaceService.editFile(slug, filePath, content);
    }

    async runCommand(slug: string, command: string, args: string[]) {
        return forgeWorkspaceService.runCommand(slug, command, args);
    }

    async sanitizeDependencies(slug: string, blueprintSlug: string) {
        const { forgeDependencyService } = await import("./core/forge-dependency.service.js");
        const dummyLog = async (m: string) => logger.info(`[SanitizeDeps:${slug}] ${m}`);
        return forgeDependencyService.detectAndInjectDependencies(slug, {}, dummyLog);
    }

    async injectBuildConfig(slug: string, blueprintSlug: string) {
        return forgeWorkspaceService.injectBuildConfig(slug, blueprintSlug);
    }

    async validateWorkspace(slug: string) {
        return forgeWorkspaceService.validateWorkspace(slug);
    }

    async listBlueprints() {
        return forgeBlueprintService.listBlueprints();
    }

    async acquireWarmLease() {
        return forgeInfrastructureService.acquireWarmLease();
    }

    async releaseWarmLease(leaseId: string, dehydrate: boolean = true) {
        return forgeInfrastructureService.releaseWarmLease(leaseId, dehydrate);
    }

    async rollbackToVersion(appId: number, version: string, userId?: string) {
        logger.info(`[Forge] Rolling back app ${appId} to version ${version}`);
        try {
            const { forgeReleaseService } = await import("./core/forge-release.service.js");
            const { forgeReleases } = await import("@shared/schema/apps/forge-releases.js");
            // Find the deployed release with this version
            const releases = await db.select().from(forgeReleases)
                .where(eq(forgeReleases.appId, appId))
                .orderBy(desc(forgeReleases.createdAt)).limit(50);
            const target = releases.find(r => r.version === version && r.status === "deployed");
            if (!target) {
                return { success: false, message: `No deployed release found for app ${appId} at version ${version}` };
            }
            return forgeReleaseService.rollbackToRelease(appId, target.id, userId || "forge");
        } catch (err: any) {
            logger.warn(`[Forge] rollbackToVersion failed: ${err.message}`);
            return { success: false, message: err.message };
        }
    }

    async cleanupWorkspace(slug: string) {
        return forgeWorkspaceService.cleanupWorkspace(slug);
    }

    async listNmCacheEntries() {
        return forgeInfrastructureService.listNmCacheEntries();
    }

    async pruneNmCache(maxEntries: number) {
        return forgeInfrastructureService.pruneNmCache(maxEntries);
    }

    async executePlaywrightTest(testPath: string, orgId: number) {
        assertLocalTenantExecutionAllowed();
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        try {
            const { stdout } = await execAsync(`npx playwright test ${testPath} --reporter=json`, {
                cwd: process.cwd(),
                timeout: 120000,
                env: tenantProcessEnv(),
            });
            const parsed = JSON.parse(stdout);
            return {
                passed: parsed.stats?.expected || 0,
                failed: parsed.stats?.unexpected || 0,
                skipped: parsed.stats?.skipped || 0,
                results: parsed.suites || []
            };
        } catch (err: any) {
            try {
                const parsed = JSON.parse(err.stdout || "{}");
                return {
                    passed: parsed.stats?.expected || 0,
                    failed: parsed.stats?.unexpected || 1,
                    skipped: parsed.stats?.skipped || 0,
                    results: parsed.suites || []
                };
            } catch {
                return { passed: 0, failed: 1, skipped: 0, results: [] };
            }
        }
    }

    async runDependencyAudit(path: string, orgId: number) {
        const { exec } = await import("child_process");
        const { promisify } = await import("util");
        const execAsync = promisify(exec);
        try {
            const { stdout } = await execAsync(`npm audit --json`, {
                cwd: process.cwd(),
                timeout: 30000,
            });
            const parsed = JSON.parse(stdout);
            return {
                vulnerabilities: Object.keys(parsed.advisories || {}),
                total: parsed.metadata?.vulnerabilities?.total || 0,
                severity: {
                    high: parsed.metadata?.vulnerabilities?.high || 0,
                    medium: parsed.metadata?.vulnerabilities?.moderate || 0,
                    low: parsed.metadata?.vulnerabilities?.low || 0
                }
            };
        } catch (err: any) {
            try {
                const parsed = JSON.parse(err.stdout || "{}");
                return {
                    vulnerabilities: Object.keys(parsed.advisories || {}),
                    total: parsed.metadata?.vulnerabilities?.total || 0,
                    severity: {
                        high: parsed.metadata?.vulnerabilities?.high || 0,
                        medium: parsed.metadata?.vulnerabilities?.moderate || 0,
                        low: parsed.metadata?.vulnerabilities?.low || 0
                    }
                };
            } catch {
                return { vulnerabilities: [], total: 0, severity: { high: 0, medium: 0, low: 0 } };
            }
        }
    }
}

export const appForgeService = new AppForgeService();
