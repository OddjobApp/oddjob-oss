import { db } from "@server/database_service.js";
import { appDeployments, appInstances, apps } from "@shared/schema/index.js";
import { eq, and, sql, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { eventStream, type EventPayload } from "@domain/core/infrastructure/event-stream.service.js";
import { POD_EVENTS } from "@domain/core/infrastructure/pod-events.contract.js";
import { podRegistry } from "@domain/core/infrastructure/pod-registry.service.js";
import { IAppPod } from "@shared/contracts/index.js";
import { institutionalAuditorService } from "./institutional-auditor.service.js";
import { decisionRouter } from "./decision-router.js";

const logger = createLogger("ScalingGovernor");

export class ScalingGovernorService {
    private isInitialized = false;
    private appPod: IAppPod | null = null;
    private readonly SESSION_COUNT_KEY = (depId: number) => `scaling:sessions:${depId}`;

    /**
     * Start the Governor and listen for scaling-relevant telemetry.
     */
    async initialize() {
        if (this.isInitialized) return;

        logger.info("[ScalingGovernor] Initializing Elastic Infrastructure Governor...");

        // Fetch the Apps pod facade from the registry (enables distribution)
        this.appPod = await podRegistry.getPod<IAppPod>('apps');

        // Listen for new sessions to scale UP
        eventStream.on(POD_EVENTS.APP.SESSION_START, (event: EventPayload) => {
            this.handleSessionStart(event).catch(err => 
                logger.error("[ScalingGovernor] Scale-up failure:", err)
            );
        });

        // Listen for session completions to scale DOWN
        eventStream.on(POD_EVENTS.APP.SESSION_COMPLETE, (event: EventPayload) => {
            this.handleSessionComplete(event).catch(err => 
                logger.error("[ScalingGovernor] Scale-down failure:", err)
            );
        });

        // 3. Start Infrastructure Monitoring (Every 60s)
        setInterval(() => {
            this.monitorInfrastructure().catch(err => 
                logger.error("[ScalingGovernor] Infra monitor failure:", err)
            );
        }, 60000);

        this.isInitialized = true;
    }

    /**
     * Monitors fleet-wide infrastructure pressure (Queues, Heartbeats)
     */
    private async monitorInfrastructure() {
        logger.debug("[ScalingGovernor] Checking infrastructure health...");

        // 1. Check Knowledge Extraction Backlog
        try {
            const { extractionQueue } = await import("../../knowledge/knowledge-queue.js");
            const counts = await extractionQueue.getJobCounts();
            
            if (counts.waiting > 100) {
                logger.warn(`[ScalingGovernor] Knowledge backlog detected (${counts.waiting} jobs). Triggering extraction worker scale-up...`);
                await this.triggerInfraScale('extraction');
            }
        } catch (e) {
            logger.error("[ScalingGovernor] Failed to monitor extraction queue", e);
        }

        // 2. Check AI Compute Backlog
        try {
            // Assuming an aiQueue exists in integrations/job-queue or similar
            // For now, we use a placeholder for the logic
        } catch (e) {}
    }

    private async triggerInfraScale(podType: string) {
        // Emit a global event that an external orchestrator (Terraform/K8s) can pick up
        eventStream.emit(POD_EVENTS.INFRA.SCALE_UP_REQUESTED, {
            podType,
            timestamp: new Date().toISOString(),
            reason: "Queue backlog threshold exceeded"
        });

        logger.info(`[ScalingGovernor] Scale-up REQUESTED for system pod: ${podType}`, { podType, reason: "backlog" });
    }

    /**
     * Logic for Horizontal Scaling UP.
     */
    private async handleSessionStart(event: EventPayload) {
        const { deploymentId, appSlug } = event.payload;
        if (!deploymentId || !this.appPod) return;

        // 1. Increment active session count in Redis
        const activeCount = await redis.incr(this.SESSION_COUNT_KEY(deploymentId));
        await redis.expire(this.SESSION_COUNT_KEY(deploymentId), 3600); // 1hr TTL

        // 2. Fetch current fleet status
        const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId)).limit(1);
        if (!deployment) return;

        const instances = await db.select().from(appInstances).where(and(
            eq(appInstances.deploymentId, deploymentId),
            eq(appInstances.status, "running")
        ));
        
        const instanceCount = instances.length || 1;
        const density = activeCount / instanceCount;

        logger.debug(`[ScalingGovernor] ${appSlug} Density: ${density.toFixed(2)} (Target: ${deployment.targetConcurrency})`);

        // 3. Trigger Scale UP if threshold reached
        if (density > deployment.targetConcurrency && instanceCount < deployment.maxReplicas) {
            await this.executeScaleUp(deploymentId, appSlug, deployment.organizationId);
        }
    }

    /**
     * Logic for Horizontal Scaling DOWN (The Reaper).
     */
    private async handleSessionComplete(event: EventPayload) {
        const { deploymentId, appSlug } = event.payload;
        if (!deploymentId || !this.appPod) return;

        // 1. Decrement active session count
        const activeCount = await redis.decr(this.SESSION_COUNT_KEY(deploymentId));
        
        // 2. Scale down if load is consistently low (Cooldown logic)
        const [deployment] = await db.select().from(appDeployments).where(eq(appDeployments.id, deploymentId)).limit(1);
        if (!deployment) return;

        const instances = await db.select().from(appInstances).where(and(
            eq(appInstances.deploymentId, deploymentId),
            eq(appInstances.status, "running")
        ));

        const instanceCount = instances.length;
        if (instanceCount <= deployment.minReplicas) return;

        const density = Math.max(0, activeCount) / instanceCount;

        // Scale down if density is purely fractional (e.g. 0.2 sessions per instance)
        if (density < 0.2) {
            logger.info(`[ScalingGovernor] Target density reached for ${appSlug}. Decommissioning replica...`);
            const targetInstance = instances[instances.length - 1]; // PRUNE LAST
            await this.appPod.decommissionInstance(targetInstance.id);
        }
    }

    /**
     * Orchestrates the scale-up with budget guardrails.
     */
    private async executeScaleUp(deploymentId: number, appSlug: string, orgId: number) {
        if (!this.appPod) return;
        
        logger.info(`[ScalingGovernor] Scaling event triggered for ${appSlug}. Validating budget...`);

        // 1. Check Fiscal Sovereignty (Guardrail)
        const report = await institutionalAuditorService.generateROIReport(orgId);
        const projectedBurn = report.projectedMonthlyBurnUsd;
        
        const BUDGET_LIMIT = 5000;

        if (projectedBurn > BUDGET_LIMIT) {
            logger.warn(`[ScalingGovernor] Scale-up BLOCKED for ${appSlug}: Organization budget exceeded ($${projectedBurn.toFixed(2)} projected).`);
            
            // Trigger HIL Exception
            await decisionRouter.requestDecision({
                sessionId: `scale_block_${Date.now()}`,
                goal: `Appprove emergency scaling for ${appSlug} despite budget exhaustion.`,
                description: `Demand for ${appSlug} has spiked, but the organization is at 100% of its monthly compute budget ($${BUDGET_LIMIT}). Should we provision a new instance anyway?`,
                tool: "approve_scaling_expansion",
                params: { deploymentId, appSlug, currentBurn: projectedBurn },
                riskLevel: "medium",
                approverType: "internal",
                channels: ["inbox"]
            });
            return;
        }

        // 2. Provision new container
        try {
            await this.appPod.provisionInstance(deploymentId);
            logger.info(`[ScalingGovernor] Successfully scaled ${appSlug} fleet.`);
        } catch (err) {
            logger.error(`[ScalingGovernor] Provisioning failed for ${appSlug}:`, err);
        }
    }
}

export const scalingGovernorService = new ScalingGovernorService();

/** An org's 50 most recent app instances, for the Governor's scaling monitor. */
export async function listOrgAppInstances(organizationId: number) {
    return db.select({
        id: appInstances.id,
        status: appInstances.status,
        port: appInstances.port,
        createdAt: appInstances.createdAt,
        appSlug: apps.slug,
        appName: apps.name,
    })
        .from(appInstances)
        .innerJoin(appDeployments, eq(appInstances.deploymentId, appDeployments.id))
        .innerJoin(apps, eq(appDeployments.appId, apps.id))
        .where(eq(apps.organizationId, organizationId))
        .orderBy(desc(appInstances.createdAt))
        .limit(50);
}
