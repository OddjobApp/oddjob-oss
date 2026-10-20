import { assertLocalTenantExecutionAllowed } from "@server/utils/local-tenant-execution.js";
import { apps, appDeployments, appInstances, projectResources, type InsertApp, type InsertAppDeployment } from "@shared/schema/index.js";
import { mintDeploymentToken, getPlaintextToken, ALL_CAPABILITIES } from "./infrastructure/app-token.service.js";
import { eq, and, desc, inArray } from "drizzle-orm";
import { NotFoundError, BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { portAuthority } from "@domain/core/infrastructure/port-authority.js";
import { dockerBridgeService } from "@domain/core/infrastructure/docker/docker-bridge.service.js";
import { localProcessService } from "./infrastructure/local-process.service.js";
import { getForgeWorkspacePath, LEGACY_FORGE_WORKSPACE_ROOT } from "./core/forge-paths.js";
import fs from "fs/promises";
import path from "path";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";
import { runtimeInstanceIsRunning } from './infrastructure/runtime-instance-health.js';

async function hasBuiltWorkspace(slug: string): Promise<boolean> {
    const candidates = [
        path.join(getForgeWorkspacePath(slug), ".next"),
        path.join(LEGACY_FORGE_WORKSPACE_ROOT, slug, ".next"),
    ];
    for (const p of candidates) {
        if (await fs.access(p).then(() => true).catch(() => false)) return true;
    }
    return false;
}

const logger = createLogger("AppRegistryService");

async function normalizeUniqueAppName(data: InsertApp): Promise<InsertApp> {
    if (!data.name || !data.slug) return data;

    const [existingWithName] = await db
        .select({ slug: apps.slug })
        .from(apps)
        .where(eq(apps.name, data.name))
        .limit(1);

    if (!existingWithName || existingWithName.slug === data.slug) return data;

    const suffix = ` (${data.slug})`;
    const maxBaseLength = 120 - suffix.length;
    const baseName = data.name.slice(0, Math.max(1, maxBaseLength)).trimEnd();
    return {
        ...data,
        name: `${baseName}${suffix}`,
    };
}

export const appRegistryService = {
    /**
     * List all available apps in the marketplace
     */
    async listAvailableApps(isPublicOnly: boolean = true) {
        const cacheKey = `apps:market:${isPublicOnly}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (err) {
            logger.warn("Redis cache read failed for apps market", { error: err });
        }

        let result;
        if (isPublicOnly) {
            result = await db.select().from(apps).where(eq(apps.isPublic, true)).orderBy(desc(apps.createdAt));
        } else {
            result = await db.select().from(apps).orderBy(desc(apps.createdAt));
        }

        if (!result || result.length === 0) {
            try {
                const { syncBlueprintsAndApps } = await import("@server/scripts/seed-blueprints.js");
                await syncBlueprintsAndApps();
                result = isPublicOnly
                    ? await db.select().from(apps).where(eq(apps.isPublic, true)).orderBy(desc(apps.createdAt))
                    : await db.select().from(apps).orderBy(desc(apps.createdAt));
            } catch (syncErr: any) {
                logger.warn("Auto-syncing blueprints and apps failed:", syncErr?.message);
            }
        }

        try {
            await redis.setex(cacheKey, 60, JSON.stringify(result));
        } catch (err) {
            logger.warn("Redis cache write failed for apps market", { error: err });
        }

        return result;
    },

    /**
     * Get app by slug or ID
     */
    async getApp(identifier: string | number) {
        const query = typeof identifier === "string"
            ? eq(apps.slug, identifier)
            : eq(apps.id, identifier);

        const [app] = await db.select().from(apps).where(query).limit(1);
        if (!app) throw new NotFoundError("App not found");
        return app;
    },

    /**
     * Install an app to an organization
     */
    /**
     * A public slug no other deployment holds.
     *
     * Tries the app's own slug first, so a single-tenant install keeps the clean
     * URL it always had, then falls back to an org-qualified form (matching the
     * `-org291` convention the app slugs themselves use) and finally to a random
     * suffix. Every candidate stays lowercase alphanumeric-and-hyphen, because
     * these become hostnames for shared-server apps.
     *
     * Checking then inserting is not atomic, so the caller still has to survive
     * a 23505 from a concurrent install — but with a per-org candidate the
     * common collision is gone rather than merely narrowed.
     */
    async reserveDeploymentSlug(baseSlug: string, orgId: number): Promise<string> {
        const safe = (value: string) =>
            value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

        const candidates = [
            safe(baseSlug),
            safe(`${baseSlug}-org${orgId}`),
            ...Array.from({ length: 5 }, () =>
                safe(`${baseSlug}-org${orgId}-${Math.random().toString(36).slice(2, 7)}`),
            ),
        ];

        for (const candidate of candidates) {
            if (!candidate) continue;
            const [taken] = await db
                .select({ id: appDeployments.id })
                .from(appDeployments)
                .where(eq(appDeployments.publicSlug, candidate))
                .limit(1);
            if (!taken) return candidate;
        }

        throw new BadRequestError(
            `Could not allocate a free public slug for "${baseSlug}" in organization ${orgId}.`,
        );
    },

    async installApp(appId: number, orgId: number) {
        const app = await this.getApp(appId);

        // Check if already installed
        const [existing] = await db.select().from(appDeployments).where(
            and(
                eq(appDeployments.appId, appId),
                eq(appDeployments.organizationId, orgId)
            )
        ).limit(1);

        if (existing) {
            throw new BadRequestError(`App "${app.name}" is already installed in this organization`);
        }

        // public_slug carries a UNIQUE index across the whole table, because it
        // is the public URL of a deployed app and two deployments cannot share
        // one. This used to insert `app.slug` unchanged, which is unique per APP
        // and not per DEPLOYMENT — so the first org to install an app took the
        // slug globally and every other org's install died on
        // app_deployment_public_slug_unq. The duplicate check above did not
        // catch it either: it looks at (appId, organizationId), so a collision
        // with a DIFFERENT org is invisible to it.
        const publicSlug = await this.reserveDeploymentSlug(app.slug, orgId);

        const [deployment] = await db.insert(appDeployments).values({
            appId,
            organizationId: orgId,
            status: "installed",
            isPublished: true,
            publicSlug,
            title: app.name,
            description: app.description,
            projectId: app.projectId ?? null,
            config: {},
        }).returning();

        // Mint a scoped platform token for this deployment. The plaintext is
        // returned once so the caller can inject it into the container env.
        // The DB stores only the hash (for validation) and the ciphertext (for re-injection on restart).
        let appToken: string | undefined;
        try {
            appToken = await mintDeploymentToken(deployment.id, ALL_CAPABILITIES);
        } catch (tokenErr: any) {
            logger.warn(`[AppToken] Token mint failed for deployment ${deployment.id}: ${tokenErr.message}`);
        }

        logger.info(`App ${app.slug} (${appId}) installed for organization ${orgId}`);

        // If a matching cycle YAML exists for this app slug, provision the full
        // cycle infrastructure (agents, blueprints, and the OperationalCycle record
        // that the Operations screen reads).
        const yamlPath = path.resolve(process.cwd(), "server", "cycles", `${app.slug}.cycle.yaml`);
        try {
            const yamlContent = await fs.readFile(yamlPath, "utf-8");
            const { orgForgeService } = await import("../org/core/org-forge.service.js");
            const forgeResult = await orgForgeService.installCycleApp(orgId, yamlContent);
            logger.info(`Cycle app provisioned for ${app.slug}: cycle id=${(forgeResult as any).cycleId}`);
        } catch (yamlErr: any) {
            if (yamlErr.code !== "ENOENT") {
                // ENOENT is expected for non-cycle apps; any other error should be surfaced
                logger.warn(`Cycle provisioning failed for ${app.slug}: ${yamlErr.message}`);
            }
        }

        // Announce the arrival. POD_EVENTS.APP.DEPLOYED has had listeners since
        // it was defined — the X-Ray listener indexes the app→mission edge and
        // warms the composition cache, and the prefetch listener warms that
        // app's manifests — but nothing in the repo ever published it, so all of
        // that sat dead and a newly installed app had no X-Ray presence until
        // someone opened its scope and paid the full build.
        //
        // Emitted here rather than in the scaffold path so every route into an
        // org is covered: a marketplace install, a scaffolded app, or anything
        // else that installs, all arrive through this method.
        //
        // Non-fatal, like the app.deleted emission it mirrors: the deployment
        // row exists by now, and a cache that failed to warm must not read as a
        // failed install.
        try {
            const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
            const { POD_EVENTS } = await import("@domain/core/infrastructure/pod-events.contract.js");
            await eventStream.publish(POD_EVENTS.APP.DEPLOYED, {
                appSlug: app.slug,
                appId,
                deploymentId: deployment.id,
                publicSlug: deployment.publicSlug,
                organizationId: orgId,
            }, { organizationId: orgId, source: "app-registry-service" });
        } catch (err: any) {
            logger.warn(`Failed to emit app.deployed event for appId ${appId}`, { err: err?.message ?? err });
        }

        return { deployment, appToken };
    },

    /**
     * Get active deployments for an organization.
     *
     * A READ. It used to auto-provision when it found nothing, which was two
     * bugs in one:
     *
     * 1. INFINITE RECURSION. It called ensureDefaultAppDeployments(), whose
     *    first action is to call this method again. With zero deployments
     *    neither base case is reachable — and the installs that would have
     *    ended it only run AFTER the recursive call returns, which it never
     *    does. GET /api/apps/installed therefore never responded for an org
     *    with no apps, which is what left every App Arsenal button stuck on
     *    "Checking installation" with nothing installable. It is an async loop
     *    rather than a stack overflow, so it does not even crash: it just
     *    hammers the database until the process is restarted.
     *
     * 2. A GET THAT INSTALLS. ensureDefaultAppDeployments installs every app
     *    listAvailableApps(true) returns — the whole public catalogue, 85 apps
     *    here, not a curated default set. Merely opening the marketplace would
     *    have installed all of them.
     *
     * Provisioning is now only what it says it is: an explicit seeding step,
     * called deliberately (see seed-blueprints.ts), never as a side effect of
     * looking.
     */
    async listOrgDeployments(orgId: number) {
        return db.select({
            deployment: appDeployments,
            app: apps
        })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(eq(appDeployments.organizationId, orgId));
    },

    /**
     * Register a new app (Marketplace Admin)
     */
    async registerApp(data: InsertApp) {
        const normalizedData = await normalizeUniqueAppName(data);
        const updateData = { ...normalizedData };
        // `apps.project_id` and `project_resources` are two views of the same
        // ownership relationship. Project Space reads the junction table, so
        // writing only the app column creates a valid app that is invisible on
        // its project's Apps tab. Keep both writes atomic.
        const app = await db.transaction(async (tx) => {
            const [registered] = await tx.insert(apps)
                .values(normalizedData)
                .onConflictDoUpdate({
                    target: apps.slug,
                    set: updateData
                })
                .returning();

            if (registered.projectId != null) {
                // A resource has one primary project. Re-registration may move
                // an app, so release the old primary link before establishing
                // the relationship declared by apps.project_id.
                await tx.delete(projectResources).where(and(
                    eq(projectResources.resourceType, "app"),
                    eq(projectResources.resourceId, registered.id),
                    eq(projectResources.relation, "primary"),
                ));
                await tx.insert(projectResources).values({
                    projectId: registered.projectId,
                    resourceType: "app",
                    resourceId: registered.id,
                    relation: "primary",
                    addedBy: normalizedData.createdBy ?? null,
                }).onConflictDoUpdate({
                    target: [projectResources.projectId, projectResources.resourceType, projectResources.resourceId],
                    set: { relation: "primary", addedBy: normalizedData.createdBy ?? null },
                });
            }

            return registered;
        });
        logger.info(`App registered/updated: ${app.slug}`);

        // Register app to knowledge graph for discoverability
        try {
            const { appsKnowledgeBridge } = await import("./core/apps-knowledge-bridge.js");
            const result = await appsKnowledgeBridge.registerApp(app.id);
            if (result.success) {
                logger.info(`App ${app.slug} registered to knowledge graph as node ${result.nodeId}`);
            }
        } catch (err: any) {
            logger.warn(`Failed to register app ${app.slug} to knowledge graph:`, err.message);
        }

        return app;
    },

    /**
     * Find a deployment by app slug and organization
     */
    async findDeploymentBySlug(slug: string, orgId: number) {
        const cacheKey = `apps:deployment:${slug}:${orgId}`;
        try {
            const cached = await redis.get(cacheKey);
            if (cached) return JSON.parse(cached);
        } catch (err) {
            logger.warn("Redis cache read failed for deployment lookup", { slug, orgId, error: err });
        }

        const [result] = await db.select({
            deployment: appDeployments,
            app: apps
        })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(
                and(
                    eq(apps.slug, slug),
                    eq(appDeployments.organizationId, orgId)
                )
            )
            .limit(1);

        const data = result || null;

        if (data) {
            try {
                await redis.setex(cacheKey, 300, JSON.stringify(data)); // 5 minute cache
            } catch (err) {
                logger.warn("Redis cache write failed for deployment lookup", { slug, orgId, error: err });
            }
        }

        return data;
    },

    /**
     * Finds a specific app deployment for an organization
     */
    async findDeploymentByAppId(appId: number, organizationId: number) {
        const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
        if (!app) return null;

        const [deployment] = await db.select()
            .from(appDeployments)
            .where(
                and(
                    eq(appDeployments.appId, appId),
                    eq(appDeployments.organizationId, organizationId)
                )
            )
            .limit(1);

        if (!deployment) return null;

        return { app, deployment };
    },

    /**
     * Record spend for an app deployment
     */
    async recordAppSpend(deploymentId: number, costUsd: number) {
        const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId)).limit(1);
        if (!deployment) return;

        const currentSpend = parseFloat(deployment.currentSpendUsd || '0') || 0;
        const newSpend = currentSpend + costUsd;

        await db.update(appDeployments)
            .set({
                currentSpendUsd: newSpend.toFixed(6),
                updatedAt: new Date()
            })
            .where(eq(appDeployments.id, deploymentId));

        // Invalidate analytics cache if we implement it
        await redis.del(`apps:analytics:${deployment.appId}:${deployment.organizationId}`).catch(() => { });

        // Fire budget webhooks
        if (deployment.budgetLimitUsd) {
            const limit = parseFloat(String(deployment.budgetLimitUsd)) || 0;
            if (limit > 0) {
                const pct = newSpend / limit;
                const { appWebhookService } = await import("./app-webhook.service.js");
                if (pct >= 1.0) {
                    appWebhookService.fire(deploymentId, "budget.exceeded", { currentSpendUsd: newSpend, budgetLimitUsd: limit })
                        .catch((err: any) => logger.warn(`Budget exceeded webhook failed: ${err.message}`));
                } else if (pct >= 0.8) {
                    appWebhookService.fire(deploymentId, "budget.warning", { currentSpendUsd: newSpend, budgetLimitUsd: limit })
                        .catch((err: any) => logger.warn(`Budget warning webhook failed: ${err.message}`));
                }
            }
        }

        logger.debug(`Recorded $${costUsd} spend for deployment ${deploymentId}. Total: $${newSpend}`);
    },

    /**
     * Fetch manifest from a remote URL
     */
    async fetchManifest(url: string) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) throw new Error(`Failed to fetch manifest: ${res.statusText}`);
            const manifest = await res.json();

            // Basic validation
            if (!manifest.name || !manifest.slug) {
                throw new Error("Invalid manifest: Missing name or slug");
            }

            return manifest;
        } catch (err: any) {
            logger.error("Manifest fetch failed", { url, error: err.message });
            throw new BadRequestError(`Could not fetch manifest: ${err.message}`);
        }
    },

    /**
     * Stage an update as a draft (vNext)
     */
    async stageUpdate(appId: number, manifestUrl?: string) {
        const app = await this.getApp(appId);
        const url = manifestUrl || app.manifestUrl;

        if (!url) throw new BadRequestError("No manifest URL provided or associated with this app");

        const manifest = await this.fetchManifest(url);

        const [updated] = await db.update(apps)
            .set({
                vNextManifest: manifest,
                updatedAt: new Date()
            })
            .where(eq(apps.id, appId))
            .returning();

        logger.info(`Staged vNext update for app ${app.slug}`);
        return updated;
    },

    /**
     * Promote the staged vNext manifest to production
     */
    async publishUpdate(appId: number, changelog?: string) {
        const app = await this.getApp(appId);

        if (!app.vNextManifest) {
            throw new BadRequestError("No staged update (vNext) found to publish");
        }

        const manifest = app.vNextManifest as any;

        // Auto-increment minor version if not provided in manifest
        const currentVersion = app.version || "1.0.0";
        const parts = currentVersion.split('.');
        if (parts.length === 3) {
            parts[1] = String(parseInt(parts[1]) + 1);
            parts[2] = "0";
        }
        const nextVersion = manifest.version || parts.join('.');

        // Push current manifest snapshot to history before clearing vNext
        const currentSnapshot = {
            version: app.version,
            name: app.name,
            description: app.description,
            snapshotAt: new Date().toISOString(),
        };
        const existingConfig = (app as any).config as any || {};
        const manifestHistory: any[] = Array.isArray(existingConfig?.manifestHistory) ? existingConfig.manifestHistory : [];
        manifestHistory.push(currentSnapshot);

        const [updated] = await db.update(apps)
            .set({
                name: manifest.name,
                description: manifest.description || app.description,
                icon: manifest.icon || app.icon,
                version: nextVersion,
                changelog: changelog || manifest.changelog || app.changelog,
                pricePerLaunchUsd: manifest.price_per_launch_usd || app.pricePerLaunchUsd,
                developerPayoutPercentage: manifest.developer_payout_percentage || app.developerPayoutPercentage,
                dockerImage: manifest.docker_image || app.dockerImage, // Supporting containerized runtime
                vNextManifest: null, // Clear draft
                updatedAt: new Date()
            })
            .where(eq(apps.id, appId))
            .returning();

        logger.info(`Published version ${nextVersion} for app ${app.slug}`);

        // Invalidate marketplace cache
        await redis.del(`apps:market:true`).catch(() => { });
        await redis.del(`apps:market:false`).catch(() => { });

        return updated;
    },

    /**
     * Mach 3: Starts the mini-app by provisioning its first instance.
     */
    async startApp(appId: number, orgId?: number, opts?: { rebuildAttempted?: boolean }) {
        const app = await this.getApp(appId);

        // Find deployment to link instances
        const [deployment] = await db.select().from(appDeployments).where(and(
            eq(appDeployments.appId, appId),
            orgId != null ? eq(appDeployments.organizationId, orgId) : undefined
        )).limit(1);

        if (!deployment) throw new Error(`No deployment found for app ${app.slug} in organization ${orgId}`);

        // Stop and remove any existing instances first to free up ports
        const existingInstances = await db.select().from(appInstances)
            .where(eq(appInstances.deploymentId, deployment.id));
        for (const instance of existingInstances) {
            await this.decommissionInstance(instance.id);
        }

        // No zombie cleanup needed with pm2 as it handles its own process management and restarts.
        // We could run pm2 delete if necessary, but decommissionInstance handles it.

        // opts.rebuildAttempted threads through to provisionInstance so the
        // missing-next-binary detector doesn't loop forever.
        const result = await this.provisionInstance(deployment.id, opts);

        // Update main app status for dashboard visibility
        // Fetch existing metadata to merge
        const [existingApp] = await db.select({ runtimeMetadata: apps.runtimeMetadata }).from(apps).where(eq(apps.id, appId)).limit(1);
        const existingMeta = (existingApp?.runtimeMetadata as any) || {};

        await db.update(apps)
            .set({
                status: "active",
                runtimeMetadata: {
                    ...existingMeta,
                    status: "running",
                    lastInstanceId: result.instanceId,
                    assignedPort: result.port,
                    launchedAt: new Date().toISOString(),
                },
                updatedAt: new Date()
            })
            .where(eq(apps.id, appId));

        await db.update(appDeployments)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(appDeployments.id, deployment.id));

        return result;
    },

    /**
     * Provisions a new horizontal replica for a deployment.
     */
    async provisionInstance(deploymentId: number, opts?: { rebuildAttempted?: boolean }) {
        const [deploymentInfo] = await db.select({
            deployment: appDeployments,
            app: apps
        })
        .from(appDeployments)
        .innerJoin(apps, eq(appDeployments.appId, apps.id))
        .where(eq(appDeployments.id, deploymentId))
        .limit(1);

        if (!deploymentInfo) throw new Error("Deployment not found");
        const { app, deployment } = deploymentInfo;

        const nodePath = await import("node:path");
        let storagePath = nodePath.join(LEGACY_FORGE_WORKSPACE_ROOT, app.slug);
        const localDataPath = getForgeWorkspacePath(app.slug);
        
        const fs = await import("node:fs/promises");
        // Older cycle installs used a binding ID as the workspace directory while
        // package.json retained the app slug. Recover that materialized workspace
        // before scaffolding a second, unrelated app into the canonical directory.
        const configuredLegacyBuild = await fs.access(nodePath.join(storagePath, ".next", "BUILD_ID")).then(() => true).catch(() => false);
        if (!configuredLegacyBuild) {
            const legacyEntries = await fs.readdir(LEGACY_FORGE_WORKSPACE_ROOT, { withFileTypes: true }).catch(() => []);
            for (const entry of legacyEntries) {
                if (!entry.isDirectory()) continue;
                const candidate = nodePath.join(LEGACY_FORGE_WORKSPACE_ROOT, entry.name);
                try {
                    const manifest = JSON.parse(await fs.readFile(nodePath.join(candidate, "package.json"), "utf8"));
                    const hasBuild = await fs.access(nodePath.join(candidate, ".next", "BUILD_ID")).then(() => true).catch(() => false);
                    if (manifest.name === app.slug && hasBuild) {
                        storagePath = candidate;
                        break;
                    }
                } catch {
                    // Ignore non-app directories and malformed manifests.
                }
            }
        }
        const hasLocalData = await fs.access(localDataPath).then(() => true).catch(() => false);
        // Prefer the canonical workspace (FORGE_WORKSPACE, off the OneDrive-synced project
        // tree by default). Only use the legacy in-project path when it already holds a
        // materialized workspace (backward compatibility). A fresh app builds in the
        // canonical location — building inside OneDrive breaks Next.js symlink creation
        // (EPERM) during `next build`.
        const legacyHasData = await fs.access(storagePath).then(() => true).catch(() => false);
        const canonicalHasValidBuild = hasLocalData &&
            await fs.access(nodePath.join(localDataPath, "package.json")).then(() => true).catch(() => false) &&
            await fs.access(nodePath.join(localDataPath, ".next", "BUILD_ID")).then(() => true).catch(() => false);
        const legacyHasValidBuild = legacyHasData &&
            await fs.access(nodePath.join(storagePath, "package.json")).then(() => true).catch(() => false) &&
            await fs.access(nodePath.join(storagePath, ".next", "BUILD_ID")).then(() => true).catch(() => false);
        const workspacePath = canonicalHasValidBuild
            ? localDataPath
            : legacyHasValidBuild
                ? storagePath
                : hasLocalData
                    ? localDataPath
                    : legacyHasData
                        ? storagePath
                        : localDataPath;
        
        const effectiveBlueprint = app.blueprint || app.blueprintSlug;
        const isDockerApp = ["go-backend", "python-backend", "java-backend"].includes(effectiveBlueprint || "") ||
                            await fs.access(nodePath.join(workspacePath, "Dockerfile")).then(() => true).catch(() => false);

        if (!isDockerApp) assertLocalTenantExecutionAllowed();

        let workspaceExists = await fs.access(workspacePath).then(() => true).catch(() => false);

        // Which launch profile this workspace follows. Everything below used to
        // assume Next: a workspace without `.next/BUILD_ID` was treated as
        // unbuilt, and the recovery for that is to copy a blueprint OVER the
        // workspace and build it. For an Express service from the scaffold packs
        // that is not merely a failure to start — it replaces the app. So the
        // profile is resolved before any of that logic runs.
        let nodeEntryFile: string | undefined;
        const { detectLaunchProfile, prepareNodeWorkspace } = await import("./infrastructure/node-launch-profile.js");
        const launchProfile = isDockerApp || !workspaceExists
            ? "docker-or-absent"
            : await detectLaunchProfile(workspacePath);
        const isPlainNodeApp = launchProfile === "node";

        if (isDockerApp) {
            if (!workspaceExists) {
                const blueprintName = effectiveBlueprint || "go-backend";
                const blueprintPath = nodePath.join(process.cwd(), "server", "blueprints", "apps", blueprintName);
                try {
                    await fs.mkdir(workspacePath, { recursive: true });
                    await fs.cp(blueprintPath, workspacePath, { recursive: true });
                    workspaceExists = true;
                } catch (e: any) {
                    logger.error(`[Mach 3] Scaffold failed for Docker app ${app.slug}: ${e.message}`);
                    throw e;
                }
            }
        } else if (isPlainNodeApp) {
            // Prepare in place: install dependencies and run the app's own build
            // if its entry point is not there yet. Nothing is copied over the
            // workspace, because this app is not a blueprint instance — it is the
            // app somebody scaffolded.
            const readiness = await prepareNodeWorkspace(workspacePath, app.slug);
            if (!readiness.ready) {
                throw new Error(`Cannot start ${app.slug}: ${readiness.error}`);
            }
            nodeEntryFile = readiness.entry;
        } else {
            // The app is launched with `next start`, which requires a VALID production
            // build — signalled by .next/BUILD_ID, not merely the .next/ directory. A
            // failed/partial build leaves .next/ without BUILD_ID; treating that as "built"
            // makes us skip rebuilding and then spawn `next start` against a broken build
            // (app never serves). Require BUILD_ID so a partial build triggers a rebuild.
            const validBuildExists = await fs.access(nodePath.join(workspacePath, ".next", "BUILD_ID")).then(() => true).catch(() => false);
            // package.json is the source manifest — the true "is materialized" signal.
            // A leftover build output (.next/) must NOT mask a missing source, or we skip
            // re-scaffolding and then fail the build with "package.json is missing from
            // the workspace" forever. Re-scaffold whenever the source manifest is absent.
            const packageJsonExists = await fs.access(nodePath.join(workspacePath, "package.json")).then(() => true).catch(() => false);
            if (!workspaceExists || !packageJsonExists || !validBuildExists) {
                // An app with no source and no blueprint has nothing to build. This
                // used to fall back to the chat-assistant blueprint, so publishing an
                // empty app published a chat assistant under its name and URL.
                if (!packageJsonExists && !effectiveBlueprint) {
                    throw new Error(`${app.slug} has no source to build and no blueprint to build it from. Generate it in App Forge before starting or publishing it.`);
                }
                try {
                  // Scaffold only a workspace with no source. When package.json is
                  // there the app's own code is built as-is: copying a blueprint
                  // over it (fs.cp overwrites) replaced the app with the template.
                  if (!packageJsonExists) {
                    const blueprintPath = nodePath.join(process.cwd(), "server", "blueprints", "apps", effectiveBlueprint!);
                    await fs.mkdir(workspacePath, { recursive: true });
                    // Remove any stale .next directory before scaffolding — leftover
                    // .next/dev/ artifacts cause EPERM symlink errors on Windows.
                    await fs.rm(nodePath.join(workspacePath, ".next"), { recursive: true, force: true }).catch(() => {});
                    await fs.cp(blueprintPath, workspacePath, {
                        recursive: true,
                        filter: (src: string) => !src.includes(`${nodePath.sep}.next`),
                    });
                    // Inject the workbench SDK so blueprints can import { useWorkbenchContext,
                    // notifySaved, isEmbedded } from './sdk/workbench-sdk'. Single source of
                    // truth lives at server/blueprints/sdk/workbench-sdk.ts; gets duplicated
                    // into every workspace at scaffold time so the runtime doesn't need
                    // cross-workspace module resolution. Idempotent: overwrites stale copies.
                    const sdkSourcePath = nodePath.join(process.cwd(), "server", "blueprints", "sdk", "workbench-sdk.ts");
                    const sdkDestPath = nodePath.join(workspacePath, "sdk", "workbench-sdk.ts");
                    try {
                        await fs.mkdir(nodePath.dirname(sdkDestPath), { recursive: true });
                        await fs.cp(sdkSourcePath, sdkDestPath);
                    } catch (sdkErr: any) {
                        logger.warn(`[Mach 3] SDK injection failed for ${app.slug}: ${sdkErr.message} (workbench will still work standalone)`);
                    }
                    try {
                        const { forgeWorkspaceService } = await import("./core/forge-workspace.service.js");
                        await forgeWorkspaceService.injectBuildConfig(app.slug, effectiveBlueprint!, workspacePath);
                    } catch (injectErr: any) {
                        logger.warn(`[Mach 3] Build config injection failed for ${app.slug}: ${injectErr.message}`);
                    }
                    const appPageExists = await fs.access(nodePath.join(workspacePath, "app", "page.tsx")).then(() => true).catch(() => false);
                    const srcAppPageExists = await fs.access(nodePath.join(workspacePath, "src", "app", "page.tsx")).then(() => true).catch(() => false);
                    const srcIndexExists = await fs.access(nodePath.join(workspacePath, "src", "pages", "index.tsx")).then(() => true).catch(() => false);
                    const indexExists = await fs.access(nodePath.join(workspacePath, "pages", "index.tsx")).then(() => true).catch(() => false);
                    if (!indexExists && !appPageExists && !srcAppPageExists && !srcIndexExists) {
                        await fs.mkdir(nodePath.join(workspacePath, "pages"), { recursive: true });
                        await fs.writeFile(nodePath.join(workspacePath, "pages", "index.tsx"), "export default function Home() { return <div>Ok</div>; }");
                    }
                  }
                    const { appBuilderService } = await import("./app-builder.service.js");
                    const build = await appBuilderService.buildContainer(app.id, app.slug);
                    if (!build.success) {
                        // buildContainer failures used to be silently ignored — that
                        // led to PM2 spawning `next start` against an empty .next/
                        // directory and looping forever. Fail fast with a clear msg.
                        throw new Error(`Bypass build failed for ${app.slug}: ${build.error}`);
                    }
                    workspaceExists = true;
                } catch (e: any) {
                    logger.error(`[Mach 3] Scaffold/build failed for ${app.slug}: ${e.message}`);
                    throw e;
                }
            }
        }

        if (!workspaceExists) {
            throw new Error(`App workspace not found. Build required.`);
        }

        // A plain Node service has no next binary, and demanding one would send it
        // into a Next rebuild it can never satisfy.
        if (!isDockerApp && !isPlainNodeApp) {
            const nextBinPath = nodePath.join(workspacePath, "node_modules", "next", "dist", "bin", "next");
            const nextBinExists = await fs.access(nextBinPath).then(() => true).catch(() => false);
            if (!nextBinExists) {
                if (opts?.rebuildAttempted) {
                    throw new Error(`Build required (npm install missing 'next'); rebuild already attempted and ${app.slug} still has no next binary. Workspace may be unrecoverable.`);
                }
                logger.warn(`[Mach 3] Workspace ${app.slug} missing node_modules/next — triggering rebuild before launch`);
                const { appBuilderService } = await import("./app-builder.service.js");
                const build = await appBuilderService.buildContainer(app.id, app.slug);
                if (!build.success) {
                    throw new Error(`Build required (npm install missing 'next'); rebuild failed: ${build.error}`);
                }
                // buildContainer ends by calling startApp recursively (with the
                // same code path entering provisionInstance again). The flag we
                // pass down ensures any future rebuild attempt for the same call
                // throws instead of recursing further.
                const [latest] = await db.select().from(appInstances).where(eq(appInstances.deploymentId, deploymentId)).orderBy(desc(appInstances.id)).limit(1);
                if (latest) return { instanceId: latest.id, port: latest.port, containerId: latest.containerId };
                // No instance was created by the recursive startApp (rare — would
                // mean buildContainer returned success but its startApp call
                // produced no row). Fall through to the port loop below with the
                // attempt flag set so we can't recurse again.
            }
        }
        
        const MAX_PORT_RETRIES = 5;

        for (let attempt = 0; attempt < MAX_PORT_RETRIES; attempt++) {
            const port = await portAuthority.findOpenPort();
            const instanceUid = Math.random().toString(36).substring(2, 8);

            let appToken: string | undefined;
            try {
                appToken = await getPlaintextToken(deploymentId) ?? undefined;
            } catch (tokenErr: any) {
                logger.warn(`[AppToken] Token decrypt failed for deployment ${deploymentId}: ${tokenErr.message}`);
            }
            if (!appToken) {
                try {
                    appToken = await mintDeploymentToken(deploymentId);
                    logger.info(`[AppToken] Re-minted token for deployment ${deploymentId} (no valid stored token)`);
                } catch (mintErr: any) {
                    logger.warn(`[AppToken] Token re-mint failed for deployment ${deploymentId}: ${mintErr.message}`);
                }
            }

            const env = {
                NODE_ENV: "production",
                HOSTNAME: "0.0.0.0",
                INSTANCE_ID: instanceUid,
                ODDJOB_API_URL: process.env.ODDJOB_API_URL || process.env.ODDJOB_PLATFORM_URL || "http://localhost:5000",
                ODDJOB_PLATFORM_URL: process.env.ODDJOB_PLATFORM_URL || process.env.ODDJOB_API_URL || "http://localhost:5000",
                ODDJOB_MODEL: process.env.ODDJOB_MODEL || "gpt-4o-mini",
                OPENAI_API_KEY: developmentProviderKey("openai"),
                NEXT_TELEMETRY_DISABLED: "1",
                ...(appToken && { ODDJOB_APP_TOKEN: appToken }),
                ...(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN && { NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN }),
            };

            let runResult: { id: string; success: boolean; error?: string };
            if (isDockerApp) {
                const { dockerBridgeService } = await import("../core/infrastructure/docker/docker-bridge.service.js");
                const imageRef = `oddjob-app/${app.slug}:v1`;
                const imageExists = await dockerBridgeService.imageExists(imageRef);
                if (!imageExists) {
                    logger.info(`[AppRegistry] Building Docker image for ${app.slug} JIT...`);
                    const buildRes = await dockerBridgeService.buildImage(workspacePath, `oddjob-app/${app.slug}`, "v1");
                    if (!buildRes.success) {
                        throw new Error(`Docker build failed for ${app.slug}: ${buildRes.error}`);
                    }
                }

                logger.info(`[AppRegistry] Launching container for ${app.slug} on port ${port}...`);
                const containerName = `oddjob-app-${app.slug}-${port}`;
                await dockerBridgeService.stopContainer(containerName).catch(() => {});

                const launchRes = await dockerBridgeService.runContainer({
                    image: imageRef,
                    name: containerName,
                    portMappings: { [port]: 8080 },
                    env: {
                        ...env,
                        PORT: "8080"
                    },
                    restartPolicy: "always"
                });

                if (launchRes.success) {
                    runResult = { id: containerName, success: true };
                } else {
                    runResult = { id: "", success: false, error: launchRes.error };
                }
            } else {
                runResult = await localProcessService.startProcess(workspacePath, port, env, app.slug, nodeEntryFile);
            }

            if (!runResult.success) {
                throw new Error(runResult.error);
            }

            // Register Instance
            const [instance] = await db.insert(appInstances).values({
                deploymentId,
                containerId: runResult.id!,
                port,
                status: "running",
            }).returning();

            logger.info(`[Mach 3] Scaled UP: ${app.slug} instance ${instanceUid} on port ${port}`);
            return { instanceId: instance.id, port, containerId: runResult.id };
        }

        throw new Error("Failed to provision instance after multiple port retries.");
    },

    /**
     * Decommissions a specific instance (Scale Down).
     */
    async decommissionInstance(instanceId: number) {
        const [instance] = await db.select().from(appInstances).where(eq(appInstances.id, instanceId)).limit(1);
        if (!instance) return;

        if (instance.containerId) {
            await localProcessService.stopProcess(instance.containerId);
            if (instance.containerId.length > 30) {
                const { dockerBridgeService } = await import("../core/infrastructure/docker/docker-bridge.service.js");
                logger.info(`[AppRegistry] Decommissioning Docker container ${instance.containerId}`);
                await dockerBridgeService.stopContainer(instance.containerId);
            }
        }
        await db.delete(appInstances).where(eq(appInstances.id, instanceId));

        logger.info(`[Mach 3] Scaled DOWN: instance ${instanceId} (port ${instance.port}) decommissioned.`);
    },

    /**
     * Reconcile instances with Docker reality.
     */
    async reconcileRunningApps() {
        try {
            const activeInstances = await db.select().from(appInstances).where(eq(appInstances.status, "running"));
            logger.info(`[AppRegistry] Reconciling ${activeInstances.length} active instances...`);

            for (const instance of activeInstances) {
                const isRunning = await runtimeInstanceIsRunning(instance);
                if (!isRunning) {
                    await db.delete(appInstances).where(eq(appInstances.id, instance.id));
                    logger.warn(`[AppRegistry] Instance ${instance.id} (port ${instance.port}) not running - pruned.`);
                }
            }

            // Sync app-level status (limit to avoid loading entire table into memory)
            const allApps = await db.select().from(apps).limit(1000);
            for (const app of allApps) {
                const deployments = await db.select().from(appDeployments).where(eq(appDeployments.appId, app.id)).limit(50);
                const depIds = deployments.map(d => d.id);
                
                if (depIds.length === 0) continue;

                const instances = await db.select().from(appInstances).where(inArray(appInstances.deploymentId, depIds));
                const hasRunning = instances.some(i => i.status === "running");

                if (!hasRunning && (app.runtimeMetadata as any)?.status === "running") {
                    const currentMeta = (app.runtimeMetadata as any) || {};
                    
                    // FALLBACK: If the app has an activeContainerId in metadata, check if it's alive in Docker
                    // This covers "Warm Pool" apps that haven't registered a DB instance yet.
                    if (currentMeta.activeContainerId) {
                        try {
                            const isAlive = await localProcessService.isProcessRunning(currentMeta.activeContainerId);
                            if (isAlive) {
                                logger.info(`Reconcile: App ${app.slug} has no DB instance but process ${currentMeta.activeContainerId} is alive. Maintaining status.`);
                                continue; 
                            }
                        } catch (err) {
                            logger.error(`Reconcile fallback check failed for ${app.slug}: ${err}`);
                        }
                    }

                    // FALLBACK: the instance row can go missing simply because the server
                    // restarted (local-process registry is cleared on restart — see
                    // local-process.service.ts), not because the underlying `next start`
                    // process actually died. If the app's last-known port is still occupied,
                    // that process is almost certainly still alive and serving traffic —
                    // re-register it instead of launching a duplicate on a fresh port. Without
                    // this check, every server restart abandons one orphan per app and spawns
                    // a replacement on an ever-higher port, leaking processes indefinitely.
                    // A replacement listener can belong to another app: recover only
                    // when the exact local process is still registered, never from occupancy.
                    if (currentMeta.assignedPort && (await hasBuiltWorkspace(app.slug)) && await localProcessService.isProcessRunning(`oddjob-app-${app.slug}-${currentMeta.assignedPort}`)) {
                        const [existingClaim] = await db.select().from(appInstances).where(eq(appInstances.port, currentMeta.assignedPort)).limit(1);
                        if (!existingClaim) {
                            const firstDep = deployments[0];
                            logger.warn(`[AppRegistry] ${app.slug}: instance row missing but port ${currentMeta.assignedPort} is occupied and built workspace exists — re-registering process.`);
                            await db.insert(appInstances).values({
                                deploymentId: firstDep.id,
                                containerId: `oddjob-app-${app.slug}-${currentMeta.assignedPort}`,
                                port: currentMeta.assignedPort,
                                status: "running",
                            });
                            continue;
                        }
                    }

                    if (await hasBuiltWorkspace(app.slug)) {
                        // Workspace is ready — restart rather than mark stopped
                        const firstDep = deployments[0];
                        logger.info(`[AppRegistry] Auto-restarting ${app.slug} (built workspace found)`);
                        this.startApp(app.id, firstDep.organizationId ?? undefined)
                            .catch((e: any) => logger.warn(`[AppRegistry] Auto-restart failed for ${app.slug}: ${e.message}`));
                    } else {
                        logger.info(`[AppRegistry] App ${app.slug} has no built workspace — marking stopped`);
                        await db.update(apps)
                            .set({
                                runtimeMetadata: {
                                    ...currentMeta,
                                    status: "stopped",
                                    stoppedAt: new Date().toISOString()
                                }
                            })
                            .where(eq(apps.id, app.id));
                    }
                }
            }
        } catch (err: any) {
            logger.error(`[AppRegistry] Reconciliation failed: ${err.message}`);
        }
    },

    /**
     * Stops ALL instances for an app.
     */
    async stopApp(appId: number) {
        const app = await this.getApp(appId);
        const deployments = await db.select().from(appDeployments).where(eq(appDeployments.appId, appId));
        const depIds = deployments.map(d => d.id);

        if (depIds.length > 0) {
            const instances = await db.select().from(appInstances).where(inArray(appInstances.deploymentId, depIds));
            for (const instance of instances) {
                await this.decommissionInstance(instance.id);
            }
        }

        const currentMeta = (app.runtimeMetadata as any) || {};
        await db.update(apps)
            .set({
                runtimeMetadata: { 
                    ...currentMeta,
                    status: "stopped", 
                    stoppedAt: new Date().toISOString() 
                },
                updatedAt: new Date()
            })
            .where(eq(apps.id, appId));

        logger.info(`[Mach 3] App ${app.slug} all instances stopped.`);
    }
};
