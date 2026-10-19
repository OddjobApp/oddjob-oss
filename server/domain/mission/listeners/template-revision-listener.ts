/**
 * Template Revision Listener
 *
 * Subscribes to MISSION.RUN_COMPLETED and asks templateRevisionService to
 * propose a revision to the template that spawned the run. Background work,
 * gated by the service itself (shadow runs / no source template / no signal).
 *
 * Errors here are non-fatal: a proposal is a best-effort suggestion, not part
 * of the mission's correctness.
 */

import { eventStream } from "../../core/infrastructure/event-stream.service.js";
import { POD_EVENTS } from "../../core/infrastructure/pod-events.contract.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("TemplateRevisionListener");

export function initializeTemplateRevisionSubscription() {
    logger.info("[MissionPod] Initializing template revision subscriptions...");

    eventStream.on(POD_EVENTS.MISSION.RUN_COMPLETED, async (event) => {
        const { missionRunId } = event.payload as { missionRunId?: number };
        if (!missionRunId) return;

        try {
            const { templateRevisionService } = await import("../core/template-revision.service.js");
            const outcome = await templateRevisionService.proposeRevisionFromRun(missionRunId);
            if (outcome.proposed) {
                logger.info(`[TemplateRevision] Proposed revision ${outcome.proposalId} from run ${missionRunId}`);
            } else if (outcome.reason && !["no_signal", "no_source_template", "shadow_run", "trace_too_thin"].includes(outcome.reason)) {
                // Skip-reasons that are routine get debug; anything else is worth logging.
                logger.debug(`[TemplateRevision] Skipped run ${missionRunId}: ${outcome.reason}`);
            }
        } catch (err: any) {
            logger.warn(`[TemplateRevision] Failed to process run ${missionRunId}: ${err.message}`);
        }
    });
}
