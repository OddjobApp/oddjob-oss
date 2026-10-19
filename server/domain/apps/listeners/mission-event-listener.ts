import { eventStream } from "../../core/infrastructure/event-stream.service.js";
import { POD_EVENTS } from "../../core/infrastructure/pod-events.contract.js";
import { appRegistryService } from "../app-registry.service.js";
// Moved missionRunService to dynamic import to avoid cross-domain circular dependency
import { createLogger } from "@server/utils/logger.js";
import crypto from "node:crypto";

const logger = createLogger("MissionAppsListener");

/**
 * MissionEventListener (Apps Domain)
 * 
 * Handles inter-pod events related to Missions that require App integration actions.
 * This decouples the Mission pod from direct knowledge of Apps and Webhooks.
 */
export function initializeMissionAppsSubscription() {
    logger.info("[AppsPod] Initializing Mission Event Subscriptions...");

    eventStream.on(POD_EVENTS.MISSION.RUN_COMPLETED, async (event) => {
        const { missionRunId, appSlug, organizationId } = event.payload;

        if (!appSlug || !missionRunId) return;

        logger.info(`[AppsPod] Received mission.run.completed event for Run ID: ${missionRunId}, App: ${appSlug}`);

        try {
            const deploymentInfo = await appRegistryService.findDeploymentBySlug(appSlug, organizationId);
            if (!deploymentInfo || !deploymentInfo.deployment.webhookUrl) {
                logger.debug(`[AppsPod] No active deployment or webhook URL for app ${appSlug}`);
                return;
            }

            const { missionRunService } = await import("../../mission/core/mission-run.service.js");
            const run = await missionRunService.getById(missionRunId);

            if (!run || run.status !== 'completed') {
                logger.warn(`[AppsPod] Mission run ${missionRunId} status mismatch: ${run?.status}`);
                return;
            }

            const { deployment } = deploymentInfo;
            const payload = {
                event: "mission_completed",
                mission_run_id: missionRunId,
                app_slug: appSlug,
                status: run.status,
                timestamp: Date.now()
            };
            
            const body = JSON.stringify(payload);
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };

            if (deployment.webhookSecret) {
                headers['X-Oddjob-Signature'] = crypto.createHmac('sha256', deployment.webhookSecret).update(body).digest('hex');
            }

            logger.info(`[AppsPod] Triggering app webhook for ${appSlug} at ${deployment.webhookUrl}`);
            const response = await fetch(deployment.webhookUrl, { 
                method: 'POST', 
                headers, 
                body 
            });

            if (!response.ok) {
                logger.error(`[AppsPod] Webhook trigger failed for ${appSlug}: HTTP ${response.status}`);
            } else {
                logger.info(`[AppsPod] Webhook successfully triggered for ${appSlug}`);
            }
        } catch (err) {
            logger.error(`[AppsPod] Failed to process mission completion for app ${appSlug}:`, err);
        }
    });
}
