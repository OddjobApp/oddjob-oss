
import { eventStream, type EventPayload } from "@domain/core/infrastructure/event-stream.service.js";
import { createLogger } from "@server/utils/logger.js";
import { formPublishingService } from "./form-publishing-service.js";
import { decisionRouter } from "./decision-router.js";
import { systemAiService } from "../../ai/core/system-ai.service.js";
import { POD_EVENTS } from "@domain/core/infrastructure/pod-events.contract.js";

const logger = createLogger("FeedbackLoopService");

export class FeedbackLoopService {
    private isInitialized = false;

    /**
     * Initialize the feedback loop by subscribing to session events.
     */
    async initialize() {
        if (this.isInitialized) return;

        logger.info("[FeedbackLoop] Initializing Ephemeral Feedback Loop Orchestrator...");

        // Subscribe to session completion events
        eventStream.on(POD_EVENTS.APP.SESSION_COMPLETE, (event: EventPayload) => {
            this.handleSessionComplete(event).catch(err => 
                logger.error("[FeedbackLoop] Error handling session completion:", err)
            );
        });

        // Subscribe to mission pause events for human review
        eventStream.on(POD_EVENTS.MISSION.AWAITING_ORDERS, (event: EventPayload) => {
            this.handleMissionAwaitingOrders(event).catch(err =>
                logger.error("[FeedbackLoop] Error handling mission pause:", err)
            );
        });

        this.isInitialized = true;
    }

    /**
     * Processes a completed session and determines if a survey is warranted.
     */
    private async handleSessionComplete(event: EventPayload) {
        const { sessionId, appSlug, deploymentId, metadata } = event.payload;
        const durationMs = metadata?.durationMs || 0;
        const organizationId = event.context?.organizationId;

        logger.debug(`[FeedbackLoop] Analyzing completed session ${sessionId} for app ${appSlug} (Duration: ${durationMs}ms)`);

        // TRIGGER CRITERIA:
        // 1. Session duration > 2 minutes (quality interaction)
        // 2. OR session had an error (stability check)
        const isSpammy = durationMs < 120000; // < 2 mins
        const hadError = metadata?.hadError === true;
        
        if (isSpammy && !hadError) {
            logger.debug(`[FeedbackLoop] Session ${sessionId} dismissed: Interaction depth insufficient.`);
            return;
        }

        // 3. Sampling: 30% of eligible sessions
        if (Math.random() > 0.3 && !hadError) {
            logger.debug(`[FeedbackLoop] Session ${sessionId} dismissed: Sampling skip.`);
            return;
        }

        logger.info(`[FeedbackLoop] Triggering contextual survey for session ${sessionId} (${appSlug})`);
        await this.generateAndRouteSurvey(appSlug, organizationId, metadata);
    }

    /**
     * Uses AI to generate a contextual survey and routes it via HIL.
     */
    private async generateAndRouteSurvey(appSlug: string, organizationId: number | undefined, sessionMetadata: any) {
        try {
            // 1. Generate Contextual Survey Schema using System AI
            const prompt = `
                Generate a 3-question user feedback survey for an AI application with the slug "${appSlug}".
                Session Context:
                - Duration: ${Math.round(sessionMetadata.durationMs / 1000)}s
                - Errors Detected: ${sessionMetadata.hadError ? 'Yes' : 'No'}
                - User Actions: ${JSON.stringify(sessionMetadata.actions || [])}

                The survey should be professional yet conversational.
                Questions should focus on:
                1. Accuracy of the AI's output for their specific task.
                2. UI/UX performance and speed.
                3. Overall ROI (Was this worth the cost/time?).

                Respond only with a JSON array of fields compatible with a form builder:
                [
                    { "name": "accuracy", "label": "How accurate was the AI?", "type": "select", "options": ["Perfect", "Good", "Mediocre", "Poor"] },
                    ...
                ]
            `;

            const aiResponse = await systemAiService.generateJson(prompt);
            const fields = Array.isArray(aiResponse) ? aiResponse : [];

            if (fields.length === 0) throw new Error("AI failed to generate survey fields.");

            // 2. Publish the ephemeral form
            const formName = `Post-Usage Audit: ${appSlug}`;
            const formId = await formPublishingService.publish(formName, fields, organizationId);

            if (!formId) throw new Error("Failed to publish feedback form.");

            // 3. Route to Decision Inbox via HIL
            await decisionRouter.requestDecision({
                sessionId: `feedback_${Date.now()}`,
                goal: `Capture user sentiment for high-cost asset optimization (${appSlug}).`,
                description: `As part of our Institutional Sovereignty protocol, please provide 30 seconds of feedback on your recent use of ${appSlug}. This data directly impacts our ROI calculations and asset retention policy.`,
                tool: "submit_feedback",
                params: { formId, appSlug },
                riskLevel: "low",
                approverType: "internal",
                approverEmail: "system@oddjob.local", // In a real scenario, this would be the session user
                channels: ["inbox"]
            });

            logger.info(`[FeedbackLoop] Survey successfully routed for app ${appSlug}`);
        } catch (err) {
            logger.error(`[FeedbackLoop] Failed to generate/route survey for ${appSlug}:`, err);
        }
    }

    /**
     * Handles mission pause events by creating a HIL decision for the user.
     */
    private async handleMissionAwaitingOrders(event: EventPayload) {
        const { missionRunId } = event.payload;
        const organizationId = event.context?.organizationId;

        logger.info(`[FeedbackLoop] Mission ${missionRunId} is awaiting orders. Creating review decision...`);

        await decisionRouter.requestDecision({
            sessionId: `mission_review_${missionRunId}_${Date.now()}`,
            goal: `Review mission progress and provide guidance for the next wave.`,
            description: `Mission run ${missionRunId} has completed its current wave and is awaiting your feedback before proceeding.`,
            tool: "resume_mission",
            params: { missionRunId },
            riskLevel: "medium",
            approverType: "internal",
            approverEmail: "system@oddjob.local",
            channels: ["inbox", "copilot"]
        });
    }
}

export const feedbackLoopService = new FeedbackLoopService();
