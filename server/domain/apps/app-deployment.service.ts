import { db } from "@server/database_service.js";

import { appDeployments, apps, appUserUsage, type App, type AppDeployment, type Job } from "@shared/schema/index.js";
import { eq, and, asc, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { NotFoundError, BadRequestError, UnauthorizedError } from "@server/utils/errors.js";

const logger = createLogger("AppDeploymentService");

export class AppDeploymentService {
    static getPipelineJobType(deployment: AppDeployment, app?: App | null): "dispatcher" | null {
        const isDispatcher = deployment.publicSlug === "dispatcher" || app?.slug === "service-dispatch";
        return isDispatcher ? "dispatcher" : null;
    }

    static getPipelineReadiness(deployment: AppDeployment, app?: App | null) {
        const jobType = this.getPipelineJobType(deployment, app);
        return {
            ready: Boolean(jobType),
            jobType,
            reason: jobType
                ? null
                : "This app can trigger pipelines, but it does not expose a pipeline step executor yet.",
        };
    }

    /**
     * Get deployment by publicSlug for public viewing
     */
    /**
     * @param organizationId When given, only that organization's deployment answers.
     *   The public route has no session, so without it the slug alone decides — and an
     *   app deployed once per org (824 exists in both 473 and 291) has no single right
     *   answer. /o/:orgId/app/:slug exists to supply it.
     */
    static async getPublicDeployment(slug: string, organizationId?: number | null): Promise<{ deployment: AppDeployment; app: any }> {
        const orgFilter = (organizationId != null)
            ? [eq(appDeployments.organizationId, organizationId)]
            : [];
        // 1. Direct match on publicSlug
        let result = await db.select({
            deployment: appDeployments,
            app: apps
        })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            // isPublished is required here: this feeds /api/public/apps, which is
            // mounted without auth. Filtering on slug alone served unpublished
            // deployments to anonymous callers despite the "not published" error
            // message below implying otherwise.
            .where(and(eq(appDeployments.publicSlug, slug), eq(appDeployments.isPublished, true), ...orgFilter))
            .limit(1);

        // 2. Fallback: the publicSlug may carry an org suffix (rescue-dispatch-org291)
        // while the app slug is bare, so fall back to matching the app itself.
        //
        // ORDERED, because this route has no org context: /api/public/apps is mounted
        // without auth, and an app can have a deployment per organization -- app 824 has
        // one in org 473 and another in org 291. An unordered limit(1) therefore returned
        // whichever row the planner happened to emit first, so the tenant whose app an
        // anonymous visitor got was arbitrary and could change between identical requests.
        // Preferring an exact publicSlug match, then any deployment that has a slug at all,
        // then the lowest id, makes the answer stable and explainable.
        if (!result[0]) {
            result = await db.select({
                deployment: appDeployments,
                app: apps
            })
                .from(appDeployments)
                .innerJoin(apps, eq(appDeployments.appId, apps.id))
                .where(and(eq(apps.slug, slug), eq(appDeployments.isPublished, true), ...orgFilter))
                .orderBy(
                    sql`case when ${appDeployments.publicSlug} = ${slug} then 0 else 1 end`,
                    sql`case when coalesce(btrim(${appDeployments.publicSlug}), '') = '' then 1 else 0 end`,
                    asc(appDeployments.id),
                )
                .limit(1);
        }

        // 3. Fallback: match directly in apps table
        if (!result[0]) {
            const [matchedApp] = await db.select().from(apps).where(eq(apps.slug, slug)).limit(1);
            if (matchedApp) {
                // Same reasoning as fallback 2: pick deterministically rather than
                // letting the planner choose which organization answers.
                const existingDep = await db.select().from(appDeployments)
                    .where(and(eq(appDeployments.appId, matchedApp.id), eq(appDeployments.isPublished, true), ...orgFilter))
                    .orderBy(
                        sql`case when coalesce(btrim(${appDeployments.publicSlug}), '') = '' then 1 else 0 end`,
                        asc(appDeployments.id),
                    )
                    .limit(1);
                if (existingDep[0]) {
                    return {
                        deployment: existingDep[0],
                        app: matchedApp
                    };
                }
                // Deliberately does NOT create a deployment here.
                //
                // This used to INSERT one with isPublished:true, status:"active" and
                // organizationId falling back to a hardcoded 1. That made a read path
                // perform a cross-tenant write: /api/public/apps is mounted with no auth
                // and calls this through getBySlug BEFORE the access-policy check, so an
                // anonymous request naming any undeployed app published it — and the
                // policy check then passed against the row just created, because
                // access_policy defaults to "public".
                //
                // Publishing is an explicit action; it does not belong in a lookup.
                throw new NotFoundError("App deployment not found or not published");
            }
        }

        const data = result[0];
        if (!data) {
            throw new NotFoundError("App deployment not found or not published");
        }

        return {
            deployment: data.deployment,
            app: data.app
        };
    }

    /**
     * Get deployment by publicSlug (legacy alias)
     */
    static async getBySlug(slug: string, organizationId?: number | null) {
        try {
            return await this.getPublicDeployment(slug, organizationId);
        } catch (e) {
            return null;
        }
    }

    /**
     * Get deployment by jobId/appId for admin configuration
     */
    static async getByAppAndOrg(appId: number, organizationId: number): Promise<AppDeployment | null> {
        const deployment = await db.query.appDeployments.findFirst({
            where: and(
                eq(appDeployments.appId, appId),
                eq(appDeployments.organizationId, organizationId)
            )
        });
        return deployment || null;
    }

    /**
     * Update publishing settings for a deployment
     */
    static async updateDeploymentPublishing(appId: number, organizationId: number, data: any) {
        const [updated] = await db.update(appDeployments)
            .set({
                ...data,
                updatedAt: new Date()
            })
            .where(
                and(
                    eq(appDeployments.appId, appId),
                    eq(appDeployments.organizationId, organizationId)
                )
            )
            .returning();

        if (!updated) {
            throw new NotFoundError("App deployment not found");
        }

        // Fire app.launched webhook when published
        if (updated.isPublished && updated.publicSlug) {
            const { appWebhookService } = await import("./app-webhook.service.js");
            appWebhookService.fire(updated.id, "app.launched", { slug: updated.publicSlug }).catch(() => {});
        }

        // --- NEW: Slack Notification Hook ---
        if (updated.isPublished && updated.publicSlug) {
            try {
                const { slackService } = await import("../integrations/core/slack.service.js");
                const { apps } = await import("@shared/schema/index.js");

                // Get app details
                const [app] = await db.select().from(apps).where(eq(apps.id, updated.appId)).limit(1);

                // Find Slack workspace for this organization
                const workspaces = await slackService.listWorkspaces(organizationId);
                if (workspaces.length > 0) {
                    const workspace = workspaces[0]; // Use first available workspace
                    await slackService.sendNotification(workspace.id, "app_launched", {
                        appId: updated.appId,
                        slug: updated.publicSlug,
                        name: app?.name || updated.publicSlug,
                        organizationId,
                        publicUrl: `${process.env.APP_URL}/app/${updated.publicSlug}`,
                    });
                    logger.info(`[HOOK] Slack notification sent for app ${updated.publicSlug}`);
                }
            } catch (err: any) {
                logger.error(`[HOOK ERROR] Slack notification failed for ${updated.publicSlug}: ${err.stack || err.message}`);
            }
        }
        // ----------------------------------------

        // --- NEW: Automated Job Creation Hook ---
        if (updated.isPublished && updated.publicSlug) {
            try {
                await this.ensureAppJob(updated, organizationId);
                logger.info(`[HOOK] Successfully ensured job for ${updated.publicSlug}`);
            } catch (err: any) {
                logger.error(`[HOOK ERROR] ensureAppJob failed for ${updated.publicSlug}: ${err.stack || err.message}`);
            }
        }
        // ----------------------------------------

        return updated;
    }

    static async ensurePipelineRunnableJob(
        deploymentId: number,
        orgContext: { organizationId: number | null; userId: string }
    ): Promise<{ deployment: AppDeployment; app: App; job: Job }> {
        if (!orgContext.organizationId) {
            throw new BadRequestError("Organization context required");
        }

        const [row] = await db.select({
            deployment: appDeployments,
            app: apps,
        })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(and(
                eq(appDeployments.id, deploymentId),
                eq(appDeployments.organizationId, orgContext.organizationId)
            ))
            .limit(1);

        if (!row) {
            throw new NotFoundError("App deployment not found");
        }

        const jobType = this.getPipelineJobType(row.deployment, row.app);
        if (!jobType) {
            throw new BadRequestError("This app cannot be added to pipelines yet because it does not expose a supported pipeline executor.");
        }

        const job = await this.ensureAppJob(row.deployment, orgContext.organizationId, row.app, jobType);
        return { deployment: row.deployment, app: row.app, job };
    }

    private static async ensureAppJob(
        deployment: AppDeployment,
        organizationId: number,
        appOverride?: App | null,
        forcedJobType?: "dispatcher" | "app_proxy"
    ): Promise<Job> {
        const { jobService } = await import("../jobs/job.service.js");
        const { users } = await import("@shared/schema/index.js");
        
        // Find a valid user to satisfy service requirements
        const [validUser] = await db.select().from(users).limit(1);
        const userId = validUser ? String(validUser.id) : '1';
        const orgContext = { organizationId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };

        // Fetch the app to check its system slug
        const app = appOverride ?? (await db.select().from(apps).where(eq(apps.id, deployment.appId)).limit(1))[0];

        // A job is a "Dispatcher" type if either the public slug is 'dispatcher' 
        // OR the underlying app is the 'service-dispatch' system app.
        const isDispatcher = deployment.publicSlug === 'dispatcher' || (app && app.slug === 'service-dispatch');
        const jobType = forcedJobType ?? (isDispatcher ? 'dispatcher' : 'app_proxy');
        
        // Check for existing job with same name in this org
        const publicSlug = deployment.publicSlug || (app?.slug === "service-dispatch" ? "dispatcher" : app?.slug);
        if (!publicSlug) {
            throw new BadRequestError("App deployment needs a public slug or app slug before it can be exposed as a job");
        }

        const jobName = `App: ${publicSlug}`;
        const { items } = await jobService.list(orgContext, { search: jobName, includeHidden: true });
        const existing = items.find(j => j.name === jobName);

        const baseJobConfig = {
            isAppBacked: true,
            appDeploymentId: deployment.id,
            publicSlug,
            appId: deployment.appId,
            appSlug: app?.slug,
            appName: app?.name,
            dockerImage: app && app.dockerImage,
            // Expertise Hub Integration (Mach 3 stabilization)
            expertiseJobId: deployment.expertiseJobId,
            allowedTopicIds: deployment.allowedTopicIds,
            allowedDatasetIds: deployment.allowedDatasetIds,
            allowedPipelineIds: deployment.allowedPipelineIds,
        };

        const jobConfig = jobType === "dispatcher"
            ? {
                serviceType: (deployment.config as any)?.serviceType || "general",
                userLocationSource: (deployment.config as any)?.userLocationSource || "variable",
                userLocationVar: (deployment.config as any)?.userLocationVar || "{{data.userLocation}}",
                isDemoMode: (deployment.config as any)?.isDemoMode ?? true,
                ...baseJobConfig,
            }
            : baseJobConfig;

        // NEW: Ensure Docker container is running if it's a containerized app
        if (app && app.dockerImage) {
            const { dockerBridgeService } = await import("../core/infrastructure/docker/docker-bridge.service.js");
            const isAvailable = await dockerBridgeService.isAvailable();
            if (isAvailable) {
                logger.info(`Ensuring container runtime for ${app.slug}: ${app.dockerImage}`);
                const port = 3000 + app.id;
                const url = `http://localhost:${port}`;
                await dockerBridgeService.runContainer({
                    image: app.dockerImage,
                    name: `oddjob-app-${app.slug}-${organizationId}`,
                    portMappings: { [port]: 3000 },
                    env: { ODDJOB_API_KEY: process.env.SYSTEM_API_KEY || "" },
                    memoryLimitMb: 256
                });

                // Save the URL to the deployment
                await db.update(appDeployments).set({ url }).where(eq(appDeployments.id, deployment.id));
            }
        }

        if (existing) {
            // Update existing job config
            const updatedJob = await jobService.update(existing.id, {
                config: { ...(existing.config as any), ...jobConfig },
                isActive: true,
                isHidden: true,
            }, orgContext);
            logger.info(`Updated existing job ${existing.id} for app ${deployment.publicSlug}`);
            return updatedJob;
        } else {
            // Create new job
            const job = await jobService.create({
                name: jobName,
                type: jobType,
                description: deployment.description || `Automatically created job for app: ${publicSlug}`,
                config: jobConfig,
                isActive: true,
                isHidden: true,
                tool: publicSlug || undefined
            }, orgContext);
            logger.info(`Created new ${jobType} job for app ${publicSlug}`);
            return job;
        }
    }

    /**
     * Get deployment analytics
     */
    static async getDeploymentAnalytics(appId: number, orgId: number) {
        const [existing] = await db.select().from(appDeployments).where(
            and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, orgId))
        ).limit(1);

        if (!existing) throw new NotFoundError("App deployment not found");

        const { missions } = await import("@shared/schema/missions/index.js");
        const { appAnalyticsDaily } = await import("@shared/schema/analytics.js");
        const { sql } = await import("drizzle-orm");

        let totalLaunches = 0;

        if (existing.publicSlug) {
            const stats = await db.select({
                count: sql<number>`count(*)`
            })
                .from(missions)
                .where(
                    and(
                        eq(missions.organizationId, orgId),
                        sql`${missions.blackboard}->>'viaAppSlug' = ${existing.publicSlug}`
                    )
                );
            totalLaunches = Number(stats[0]?.count || 0);
        }

        const dailyStats = await db.select()
            .from(appAnalyticsDaily)
            .where(
                and(
                    eq(appAnalyticsDaily.deploymentId, existing.id),
                    sql`${appAnalyticsDaily.date} >= CURRENT_DATE - INTERVAL '30 days'`
                )
            )
            .orderBy(appAnalyticsDaily.date);

        // Sum real-time mission costs
        const { missionRuns } = await import("@shared/schema/missions/runs.js");
        let realtimeSpend = 0;
        if (existing.publicSlug) {
            const spendRows = await db.select({
                total: sql<string>`coalesce(sum(cast(${missionRuns.actualMetricValue} as decimal)), 0)`
            })
                .from(missionRuns)
                .innerJoin(missions, eq(missionRuns.missionId, missions.id))
                .where(
                    and(
                        eq(missions.organizationId, orgId),
                        sql`${missions.blackboard}->>'viaAppSlug' = ${existing.publicSlug}`
                    )
                );
            realtimeSpend = Number(spendRows[0]?.total || 0);
        }

        // Per-user spend breakdown
        const { appUserUsage } = await import("@shared/schema/index.js");
        const userSpend = await db.select({
            userId: appUserUsage.userId,
            monthlySpendUsd: appUserUsage.monthlySpendUsd,
            dailySpendUsd: appUserUsage.dailySpendUsd,
            lastSpendAt: appUserUsage.lastSpendAt,
        }).from(appUserUsage).where(eq(appUserUsage.deploymentId, existing.id));

        return {
            totalLaunches,
            currentSpendUsd: Number(existing.currentSpendUsd || 0),
            realtimeSpendUsd: realtimeSpend,
            budgetLimitUsd: existing.budgetLimitUsd ? Number(existing.budgetLimitUsd) : null,
            dailyStats: dailyStats.map(s => ({
                date: s.date,
                launches: s.launchCount,
                uniqueUsers: s.uniqueUserCount
            })),
            userSpend
        };
    }

    /**
     * Uninstall a deployment and clean up all associated data
     */
    static async uninstallDeployment(appId: number, orgId: number) {
        const [deployment] = await db.select().from(appDeployments).where(
            and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, orgId))
        ).limit(1);

        if (!deployment) throw new NotFoundError("App not installed in this organization");

        const [appRecord] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);

        // Stop/remove Docker container if app has a docker image
        if (appRecord?.dockerImage) {
            const { dockerBridgeService } = await import("../core/infrastructure/docker/docker-bridge.service.js");
            const available = await dockerBridgeService.isAvailable();
            if (available) {
                const containerName = `oddjob-app-${appRecord.slug}-${orgId}`;
                await dockerBridgeService.stopContainer(containerName).catch(() => {});
            }
        }

        // Delete auto-created job for this deployment
        if (deployment.publicSlug) {
            try {
                const { jobService } = await import("../jobs/job.service.js");
                const { users } = await import("@shared/schema/index.js");
                const [validUser] = await db.select().from(users).limit(1);
                const userId = validUser ? String(validUser.id) : '1';
                const orgContext = { organizationId: orgId, userId, isAdmin: false, isSuperAdmin: false, isOrgAdmin: false };
                const jobName = `App: ${deployment.publicSlug}`;
                const { items } = await jobService.list(orgContext, { search: jobName, includeHidden: true });
                const existing = items.find((j: any) => j.name === jobName);
                if (existing) {
                    await jobService.delete(existing.id, orgContext);
                }
            } catch (err) {
                logger.warn(`Failed to clean up job for deployment ${deployment.publicSlug}`, { err });
            }
        }

        // Delete appUserUsage rows
        await db.delete(appUserUsage).where(eq(appUserUsage.deploymentId, deployment.id));

        // Delete the deployment record
        await db.delete(appDeployments).where(eq(appDeployments.id, deployment.id));

        // Emit app.deleted event for cache cleanup (prefetch manifests, etc.)
        try {
            const { eventStream } = await import("@domain/core/infrastructure/event-stream.service.js");
            const { POD_EVENTS } = await import("@domain/core/infrastructure/pod-events.contract.js");
            await eventStream.publish(POD_EVENTS.APP.DELETED, {
                appSlug: appRecord?.slug,
                appId,
                organizationId: orgId,
            }, { organizationId: orgId, source: "app-deployment-service" });
        } catch (err) {
            logger.warn(`Failed to emit app.deleted event for appId ${appId}`, { err });
        }

        return true;
    }

    /**
     * Check budget limits before launching a mission from this deployment
     */
    static async checkBudget(deploymentId: number, userId: number): Promise<void> {
        const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId)).limit(1);
        if (!deployment) return;

        if (deployment.budgetLimitUsd !== null && deployment.budgetLimitUsd !== undefined) {
            const limit = parseFloat(String(deployment.budgetLimitUsd));
            const current = parseFloat(String(deployment.currentSpendUsd || '0'));
            if (current >= limit) throw new BadRequestError("App budget limit has been reached");
        }

        if (deployment.userBudgetLimit !== null && deployment.userBudgetLimit !== undefined) {
            const userLimit = parseFloat(String(deployment.userBudgetLimit));
            const { sql } = await import("drizzle-orm");
            const [usage] = await db.select().from(appUserUsage).where(
                and(
                    eq(appUserUsage.deploymentId, deploymentId),
                    eq(appUserUsage.userId, String(userId))
                )
            ).limit(1);
            const monthlySpend = parseFloat(String(usage?.monthlySpendUsd || '0'));
            if (monthlySpend >= userLimit) throw new BadRequestError("User budget limit for this app has been reached");
        }
    }

    /**
     * Get health/container status for a deployment
     */
    static async getHealthStatus(appId: number, orgId: number) {
        const [row] = await db.select({ app: apps, deployment: appDeployments })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, orgId)))
            .limit(1);

        if (!row) throw new NotFoundError("App deployment not found");

        if (!row.app.dockerImage) {
            return { status: "healthy", message: "No container required" };
        }

        const { dockerBridgeService } = await import("../core/infrastructure/docker/docker-bridge.service.js");
        const available = await dockerBridgeService.isAvailable();
        if (!available) return { status: "unknown", message: "Docker unavailable" };

        const containerName = `oddjob-app-${row.app.slug}-${orgId}`;
        const isRunning = await dockerBridgeService.isContainerRunning(containerName);
        return { status: isRunning ? "healthy" : "stopped", containerName };
    }
}


