import { eventStream } from "./event-stream.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AlertInterventionBridge");

export class AlertInterventionBridge {
    private static isInitialized = false;

    /**
     * Start listening to system alerts and bridging them to UI interventions
     */
    static initialize(): void {
        if (this.isInitialized) {
            logger.warn("AlertInterventionBridge is already initialized.");
            return;
        }

        logger.info("Initializing Alert-to-Intervention Bridge...");

        eventStream.on("system.alert_created", async (event) => {
            try {
                const payload = event.payload;
                if (!payload) return;

                // Priority Filtering:
                // Only Critical, Error, and Warning alerts trigger Assistant interventions
                if (!["critical", "error", "warning"].includes(payload.severity)) {
                    logger.debug(`Skipping intervention for alert ${payload.alertId} with low severity: ${payload.severity}`);
                    return;
                }

                // Map alert severity to intervention priority
                let priority: "critical" | "high" | "medium" | "low" = "medium";
                if (payload.severity === "critical") {
                    priority = "critical";
                } else if (payload.severity === "error") {
                    priority = "high";
                }

                // Build a helpful diagnostics AI prompt for the Copilot assistant
                const aiPrompt = [
                    `I have detected a system alert: "${payload.message}"`,
                    `Category: ${payload.category}`,
                    `Severity: ${payload.severity}`,
                    payload.jobRunId ? `Job Run ID: ${payload.jobRunId}` : null,
                    payload.pipelineRunId ? `Pipeline Run ID: ${payload.pipelineRunId}` : null,
                    payload.details ? `Details: ${JSON.stringify(payload.details, null, 2)}` : null,
                    "\nPlease diagnose the root cause of this failure, search any relevant execution logs or database tables, and propose a detailed remediation plan or auto-healing action."
                ].filter(Boolean).join("\n");

                const title = `System Alert: ${payload.category.replace(/[_-]+/g, " ")}`;
                const description = payload.message;

                // Trigger an intervention via event stream
                logger.info(`Bridging alert ${payload.alertId} (${payload.severity}) to Copilot intervention with priority: ${priority}`);
                
                await eventStream.publish("intervention.triggered", {
                    interventionId: `alert-${payload.alertId}-${Date.now()}`,
                    vector: "S", // Struggle vector
                    title,
                    description,
                    aiPrompt,
                    rationale: `Proactive triage for ${payload.severity} alert in category "${payload.category}".`,
                    priority,
                    confidence: 1.0,
                    sessionId: "system",
                    context: {
                        alertId: payload.alertId,
                        category: payload.category,
                        severity: payload.severity,
                        jobRunId: payload.jobRunId,
                        pipelineRunId: payload.pipelineRunId,
                    }
                }, {
                    organizationId: payload.organizationId || undefined,
                }, "alert-intervention-bridge");

            } catch (err: any) {
                logger.error("Failed to bridge alert to intervention:", err);
            }
        });

        this.isInitialized = true;
        logger.info("Alert-to-Intervention Bridge successfully initialized");
    }
}
