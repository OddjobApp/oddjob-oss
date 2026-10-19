import { db } from "@server/database_service.js";
import {
    hilForms,
    appDeployments,
    pipelineStepExecutions,
    pipelineExecutions,
    missionRuns,
    appAuditLogs,
    apps as appsTable,
    appTelemetry,
    appAudits,
    appPayouts,
    jobs,
    orgs
} from "@shared/schema/index.js";
import { eq, and, desc, or, inArray, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("AppQueryService");

export class AppQueryService {
    /**
     * Finds pending Human-In-The-Loop forms for a given app slug.
     */
    async getPendingHilForms(slug: string) {
        // 1. Resolve Deployment
        const [deployment] = await db.select()
            .from(appDeployments)
            .where(eq(appDeployments.publicSlug, slug))
            .limit(1);

        if (!deployment) return null;
        if (!deployment.oddjobMissionId) return [];

        // 2. Fetch Pending Forms for the mission
        return await db.select({
            id: hilForms.id,
            name: hilForms.name,
            description: hilForms.description,
            schema: hilForms.schema,
            status: hilForms.status,
            createdAt: hilForms.createdAt
        })
        .from(hilForms)
        .innerJoin(pipelineStepExecutions, eq(hilForms.stepExecutionId, pipelineStepExecutions.id))
        .innerJoin(pipelineExecutions, eq(pipelineStepExecutions.pipelineExecutionId, pipelineExecutions.id))
        .innerJoin(missionRuns, eq(pipelineExecutions.missionRunId, missionRuns.id))
        .where(and(
            eq(missionRuns.missionId, deployment.oddjobMissionId),
            eq(hilForms.kind, "request"),
            eq(hilForms.status, "pending")
        ));
    }

    /**
     * Resolves the most recent active forge job for an organization.
     */
    async getActiveForgeJob(orgId: number) {
        const orgHistoryKey = `forge:history:org:${orgId}`;
        const history = await redis.lrange(orgHistoryKey, 0, 49);

        const ACTIVE_STATUSES = new Set([
            "queued",
            "running",
            "building",
            "awaiting_strategy_approval",
            "awaiting_architecture_approval",
            "awaiting_wave_approval"
        ]);

        for (const rawItem of history) {
            let item: any;
            try { item = JSON.parse(rawItem); } catch { continue; }
            const rawStatus = await redis.get(`forge:job:${item.jobId}`);
            if (!rawStatus) continue;

            let statusObj: any;
            try { statusObj = JSON.parse(rawStatus); } catch { continue; }
            if (ACTIVE_STATUSES.has(statusObj.status)) {
                return {
                    active: true,
                    jobId: item.jobId,
                    slug: item.slug,
                    name: item.name,
                    status: statusObj.status,
                    updatedAt: statusObj.updatedAt ?? item.createdAt,
                };
            }
        }

        return { active: false };
    }

    /**
     * Lists recent forge jobs with detailed AI findings for an organization.
     */
    async getForgeHistory(orgId: number) {
        const orgHistoryKey = `forge:history:org:${orgId}`;
        const history = await redis.lrange(orgHistoryKey, 0, 49);

        return await Promise.all(history.map(async (h) => {
            const item = JSON.parse(h);
            const rawStatus = await redis.get(`forge:job:${item.jobId}`);
            const status = rawStatus ? JSON.parse(rawStatus) : { status: 'unknown' };

            let findings: any[] = [];
            if (status.appId) {
                findings = await db.select()
                    .from(appAuditLogs)
                    .where(eq(appAuditLogs.appId, status.appId))
                    .orderBy(desc(appAuditLogs.createdAt))
                    .limit(5);
            }

            return {
                ...item,
                status: status.status,
                message: status.message || status.step,
                progress: status.progress,
                updatedAt: status.updatedAt,
                findings: findings.map(f => ({
                    category: f.findingType,
                    severity: f.severity,
                    issue: f.description,
                    recommendation: f.recommendation
                }))
            };
        }));
    }

    async getAgentJobConfigs(agentJobIds: number[]) {
        if (agentJobIds.length === 0) return new Map<number, any>();
        const rows = await db.select({ id: jobs.id, config: jobs.config })
            .from(jobs)
            .where(inArray(jobs.id, agentJobIds));
        const map = new Map<number, any>();
        for (const row of rows) map.set(row.id, row.config ?? {});
        return map;
    }

    async getBlueprintApp(slug: string) {
        const [app] = await db.select()
            .from(appsTable)
            .where(or(
                eq(appsTable.slug, slug),
                eq(appsTable.blueprintSlug, slug),
                eq(appsTable.blueprint, slug),
            ))
            .limit(1);
        return app ?? null;
    }

    async getAppTelemetry(appId: number, orgId?: number, limit = 10) {
        const conditions = [eq(appTelemetry.appId, appId)];
        if (orgId) conditions.push(eq(appTelemetry.orgId, orgId));
        return await db.select()
            .from(appTelemetry)
            .where(and(...conditions))
            .orderBy(desc(appTelemetry.createdAt))
            .limit(limit);
    }

    async recordAppTelemetry(values: any) {
        const [event] = await db.insert(appTelemetry).values(values).returning();
        return event;
    }

    async getAppAudits(appId: number, limit = 50) {
        return await db.select()
            .from(appAudits)
            .where(eq(appAudits.appId, appId))
            .orderBy(desc(appAudits.createdAt))
            .limit(limit);
    }

    async updatePersonalityTraits(appId: number, orgId: number, traits: any, archetype: string | null) {
        await db.update(appDeployments as any)
            .set({
                oceanTraits: traits,
                soulArchetype: archetype,
                updatedAt: new Date(),
            })
            .where(and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, orgId)));
    }

    async getPayoutsSummary(orgId: number) {
        return await db.select({
            appId: appPayouts.appId,
            appName: appsTable.name,
            status: appPayouts.status,
            total: sql<string>`sum(${appPayouts.amountUsd})`
        })
            .from(appPayouts)
            .leftJoin(appsTable, eq(appPayouts.appId, appsTable.id))
            .where(eq(appPayouts.developerOrgId, orgId))
            .groupBy(appPayouts.appId, appsTable.name, appPayouts.status);
    }


    /**
     * Every deployed app an organization can see, with its deployment row.
     *
     * The cycle manager used to build this join inline as
     *
     *     or(eq(apps.organizationId, cycle.organizationId!), eq(apps.organizationId, 291))
     *
     * Organization 291 is TECHHEAD7, a named tenant - not a platform or shared
     * organization. ACDD_PLATFORM_ORG_ID, which is the configured mechanism for
     * a shared org, is unset. So that `or` returned one tenant's apps and
     * deployments to callers in every other tenant, and a cycle with no
     * organization saw nothing *but* that tenant's apps, because
     * `eq(column, null)` never matches. The organization is required here and
     * there is no second branch.
     */
    async listDeployedAppsForOrg(orgId: number) {
        return db
            .select({ app: appsTable, deployment: appDeployments })
            .from(appsTable)
            .innerJoin(appDeployments, eq(appDeployments.appId, appsTable.id))
            .where(eq(appsTable.organizationId, orgId));
    }

    async getAppDeploymentWithApp(appId: number, orgId: number) {
        const [row] = await db.select({ app: appsTable })
            .from(appDeployments)
            .innerJoin(appsTable, eq(appDeployments.appId, appsTable.id))
            .where(and(eq(appDeployments.appId, appId), eq(appDeployments.organizationId, orgId)))
            .limit(1);
        return row ?? null;
    }

    async getAuditLogs(appId: number, limit = 50) {
        return await db.select()
            .from(appAuditLogs)
            .where(eq(appAuditLogs.appId, appId))
            .orderBy(desc(appAuditLogs.createdAt))
            .limit(limit);
    }

    async approveAppPlan(appId: number) {
        const [app] = await db.select().from(appsTable).where(eq(appsTable.id, appId)).limit(1);
        if (!app) return null;
        await db.update(appsTable)
            .set({ 
                planReviewStatus: "approved",
                lastApprovedPlan: app.developmentPlan 
            })
            .where(eq(appsTable.id, appId));
        return app;
    }

    async getPlatformHealthDeployment(appId: number, orgId?: number) {
        const [deployment] = await db.select()
            .from(appDeployments)
            .where(and(
                eq(appDeployments.appId, appId),
                orgId ? eq(appDeployments.organizationId, orgId) : sql`1=1`
            ))
            .limit(1);
        return deployment ?? null;
    }

    async checkAgentsConnectivity(orgId?: number) {
        const rows = await db.select({ id: jobs.id })
            .from(jobs)
            .where(orgId ? eq(jobs.organizationId, orgId) : sql`1=1`)
            .limit(1);
        return rows.length > 0;
    }

    async getOrgSubscriptionStatus(orgId: number) {
        const [org] = await db.select().from(orgs).where(eq(orgs.id, orgId)).limit(1);
        return org?.subscriptionStatus ?? null;
    }

    async recordPayout(developerOrgId: number, appId: number, amountUsd: string) {
        await db.insert(appPayouts).values({
            developerOrgId,
            appId,
            amountUsd,
            status: "pending"
        });
    }

    async updateAppTokenizedUi(appId: number, schema: any, existingConfig: any) {
        const updatedConfig = {
            ...existingConfig,
            tokenizedUI: schema
        };
        await db.update(appsTable)
            .set({ config: updatedConfig, updatedAt: new Date() })
            .where(eq(appsTable.id, appId));
    }
}

export const appQueryService = new AppQueryService();
