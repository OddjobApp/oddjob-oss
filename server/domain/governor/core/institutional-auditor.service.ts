
import { db } from "@server/database_service.js";
import { aiUsageLogs, apps, missionRuns, pipelineExecutions, skills, approvalRequests, appDeployments, appInstances } from "@shared/schema/index.js";
import { eq, gte, sql, desc, and, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";

const logger = createLogger("InstitutionalAuditor");

export interface InstitutionalReport {
    totalCorporateSpendUsd: number;
    projectedMonthlyBurnUsd: number;
    topExpensiveApps: Array<{ 
        name: string, 
        slug: string, 
        cost: number, 
        usage: number,
        activeInstances: number,
        currentDensity: number
    }>;
    zombieAssets: Array<{ 
        type: 'app' | 'skill', 
        name: string, 
        slug: string, 
        reason: string,
        feedbackSnippet?: string 
    }>;
    efficiencyRating: number; // 0-100
    fleetTotalInstances: number;
}

export const institutionalAuditorService = {
    /**
     * Generates a comprehensive corporate health and ROI report.
     */
    async generateROIReport(organizationId?: number): Promise<InstitutionalReport> {
        const cacheKey = `audit:roi:report:${organizationId || 'global'}`;
        
        try {
            if (redis.status === 'ready') {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    logger.info(`[Auditor] ROI report cache HIT for ${organizationId || 'global'}`);
                    return JSON.parse(cached);
                }
            }
        } catch (err: any) {
            logger.warn(`[Auditor] Redis cache read failed: ${err.message}`);
        }

        logger.info(`[Auditor] ROI report cache MISS - Generating report for org ${organizationId || 'all'}`);

        // 1. Total Spend (Last 30 Days)
        const last30Days = new Date();
        last30Days.setDate(last30Days.getDate() - 30);

        const spendConditions = [gte(aiUsageLogs.createdAt, last30Days)];
        if (organizationId) spendConditions.push(eq(aiUsageLogs.organizationId, organizationId));

        const spendQuery = db.select({ total: sql<number>`sum(cost_usd)` })
            .from(aiUsageLogs)
            .where(and(...spendConditions));
        
        const [spendResult] = await spendQuery;
        const totalSpend = Number(spendResult?.total || 0);

        // 2. Projected Burn (based on last 24h)
        const last24h = new Date();
        last24h.setHours(last24h.getHours() - 24);
        
        const burnConditions = [gte(aiUsageLogs.createdAt, last24h)];
        if (organizationId) burnConditions.push(eq(aiUsageLogs.organizationId, organizationId));

        const burnQuery = db.select({ total: sql<number>`sum(cost_usd)` })
            .from(aiUsageLogs)
            .where(and(...burnConditions));
        
        const [burnResult] = await burnQuery;
        const projectedMonthlyBurn = Number(burnResult?.total || 0) * 30;

        // 3. Top Expensive Apps (Linked via Mission Runs)
        // This is a complex join: aiUsageLogs -> pipelineExecutions -> missionRuns
        const topApps = await db.select({
            appSlug: sql<string>`(mission_runs.mission_context->>'viaAppSlug')`,
            totalCost: sql<number>`sum(ai_usage_logs.cost_usd)`,
            usageCount: sql<number>`count(distinct ai_usage_logs.execution_id)`
        })
        .from(aiUsageLogs)
        .innerJoin(pipelineExecutions, eq(aiUsageLogs.executionId, pipelineExecutions.id))
        .innerJoin(missionRuns, eq(pipelineExecutions.missionRunId, missionRuns.id))
        .where(gte(aiUsageLogs.createdAt, last30Days))
        .groupBy(sql`mission_runs.mission_context->>'viaAppSlug'`)
        .orderBy(desc(sql`sum(ai_usage_logs.cost_usd)`))
        .limit(10);

        const enrichedTopApps = [];
        let totalInstances = 0;

        for (const ta of topApps) {
            if (!ta.appSlug) continue;
            
            // Get App & Deployment details
            const [appData] = await db.select({
                app: apps,
                deployment: appDeployments
            })
            .from(apps)
            .leftJoin(appDeployments, eq(apps.id, appDeployments.appId))
            .where(eq(apps.slug, ta.appSlug))
            .limit(1);

            if (!appData?.app) continue;

            // Get live instance count
            const instances = appData.deployment 
                ? await db.select().from(appInstances).where(and(eq(appInstances.deploymentId, appData.deployment.id), eq(appInstances.status, "running")))
                : [];
            
            const instanceCount = instances.length;
            totalInstances += instanceCount;

            // Get current density from Redis (Scaling Governor key)
            let activeSessions = 0;
            if (appData.deployment && redis.status === 'ready') {
                try {
                    activeSessions = Number(await redis.get(`scaling:sessions:${appData.deployment.id}`) || 0);
                } catch (e: any) {
                    logger.warn(`[Auditor] Redis scaling sessions read failed: ${e.message}`);
                }
            }
            
            const density = instanceCount > 0 ? activeSessions / instanceCount : 0;

            enrichedTopApps.push({
                name: appData.app.name,
                slug: ta.appSlug,
                cost: Number(ta.totalCost),
                usage: Number(ta.usageCount),
                activeInstances: instanceCount,
                currentDensity: density
            });
        }

        // 4. Incorporate Sentiment Analysis (Feedback Loops)
        const feedbackResults = await db.select()
            .from(approvalRequests)
            .where(and(
                eq(approvalRequests.status, "approved"),
                sql`${approvalRequests.executionId} LIKE 'feedback_%'`
            ));

        const appSentimentMap: Record<string, { scores: number[], snippets: string[] }> = {};
        for (const res of feedbackResults) {
            const output = (res.modifiedOutput as any) || {};
            const appSlug = output.appSlug;
            if (!appSlug) continue;

            let score = 1.0;
            if (output.accuracy === 'Poor' || output.roi === 'Low') score = 0.4;
            else if (output.accuracy === 'Good') score = 0.8;
            else if (output.accuracy === 'Perfect') score = 1.2;

            if (!appSentimentMap[appSlug]) appSentimentMap[appSlug] = { scores: [], snippets: [] };
            appSentimentMap[appSlug].scores.push(score);

            const snippet = output.feedback || output.reason || "General interaction feedback.";
            if (snippet) appSentimentMap[appSlug].snippets.push(snippet);
        }

        // 5. Identify Zombie Assets
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const allForgedApps = await db.select().from(apps).where(and(
            eq(apps.isSystem, false),
            organizationId ? eq(apps.developerOrgId, organizationId) : undefined
        ));

        const zombieAssets: InstitutionalReport['zombieAssets'] = [];
        let totalEfficiency = 0;

        for (const app of allForgedApps) {
            const usage = enrichedTopApps.find(ta => ta.slug === app.slug);
            const sentimentData = appSentimentMap[app.slug] || { scores: [], snippets: [] };
            const avgSentiment = sentimentData.scores.length > 0 
                ? sentimentData.scores.reduce((a, b) => a + b, 0) / sentimentData.scores.length 
                : 1.0;

            const baselineUsage = usage?.usage || 0;
            const weightedROI = baselineUsage * avgSentiment;

            if (!usage || (weightedROI < 2 && app.createdAt < sevenDaysAgo)) {
                zombieAssets.push({
                    type: 'app',
                    name: app.name,
                    slug: app.slug,
                    reason: avgSentiment < 0.7 ? "Critical negative user feedback." : "Low usage high retention cost.",
                    feedbackSnippet: sentimentData.snippets[0]
                });
            }
            
            totalEfficiency += (weightedROI > 5 ? 100 : (weightedROI / 5) * 100);
        }

        const efficiencyRating = allForgedApps.length > 0 
            ? Math.min(100, Math.round(totalEfficiency / allForgedApps.length)) 
            : 100;

        const report: InstitutionalReport = {
            totalCorporateSpendUsd: totalSpend,
            projectedMonthlyBurnUsd: projectedMonthlyBurn,
            topExpensiveApps: enrichedTopApps,
            zombieAssets,
            efficiencyRating,
            fleetTotalInstances: totalInstances
        };

        // Cache the result for 15 minutes
        if (redis.status === 'ready') {
            try {
                await redis.setex(cacheKey, 900, JSON.stringify(report));
            } catch (err: any) {
                logger.warn(`[Auditor] Redis cache write failed: ${err.message}`);
            }
        }

        return report;
    }
};
