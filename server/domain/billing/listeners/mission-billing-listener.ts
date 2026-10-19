import { eventStream } from "../../core/infrastructure/event-stream.service.js";
import { POD_EVENTS } from "../../core/infrastructure/pod-events.contract.js";
import { payoutService } from "../payout.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("MissionBillingListener");

/**
 * MissionBillingListener
 * 
 * Handles billing and payout actions when missions complete.
 */
export function initializeMissionBillingSubscription() {
    logger.info("[BillingPod] Initializing Mission Event Subscriptions...");

    eventStream.on(POD_EVENTS.MISSION.RUN_COMPLETED, async (event) => {
        const { missionRunId, appSlug, organizationId } = event.payload;

        if (!appSlug) {
            logger.debug(`[BillingPod] Run ${missionRunId} completed without appSlug, no payout needed.`);
            return;
        }

        try {
            // Find the app to get its ID for the payout service
            const { appRegistryService } = await import("../../apps/app-registry.service.js");
            const deploymentInfo = await appRegistryService.findDeploymentBySlug(appSlug, organizationId);
            
            if (!deploymentInfo || !deploymentInfo.app) {
                logger.warn(`[BillingPod] Could not find app for slug ${appSlug} during payout processing.`);
                return;
            }

            const appId = deploymentInfo.app.id;
            logger.info(`[BillingPod] Mission run ${missionRunId} completed for app ${appSlug}. Recording payout for App ID: ${appId}`);
            
            await payoutService.recordAppLaunchPayout(appId, missionRunId);
        } catch (err) {
            logger.error(`[BillingPod] Failed to process payout for mission run ${missionRunId}:`, err);
        }
    });
}
