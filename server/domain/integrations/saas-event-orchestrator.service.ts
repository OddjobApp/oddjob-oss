
import { createHash, randomUUID } from "node:crypto";
import { db } from "@server/database_service.js";
import { saasEventWorkflows, signalFeeds, type EventType, type Severity } from "@shared/schema/index.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { eventStream, EventPayload } from "../core/infrastructure/event-stream.service.js";
import { reactiveOrchestratorService } from "../mission/core/reactive-orchestrator.service.js";
import { eventIngressService } from "../signal-intelligence/core/event-ingress.service.js";
import { causalGraphService } from "../signal-intelligence/core/causal-graph.service.js";
import { worldModelBridgeService } from "../signal-intelligence/core/world-model-bridge.service.js";

const logger = createLogger("SaaSEventOrchestrator");

export class SaaSEventOrchestratorService {
    private static instance: SaaSEventOrchestratorService;
    private isInitialized = false;

    private constructor() {}

    static getInstance(): SaaSEventOrchestratorService {
        if (!this.instance) {
            this.instance = new SaaSEventOrchestratorService();
        }
        return this.instance;
    }

    async initialize() {
        if (this.isInitialized) return;

        logger.info("Initializing SaaS Event Orchestrator...");
        
        // Listen for all events and check for workflow matches
        eventStream.on("*", async (event: EventPayload) => {
            // Only process events that look like SaaS events
            // SaaS events usually have a source like 'jira', 'slack', 'confluence', 'servicenow'
            // OR the eventType starts with the platform name
            const platformMatch = event.eventType.split('.')[0];
            const platforms = ['jira', 'slack', 'confluence', 'github', 'resend', 'servicenow', 'quickbooks'];
            
            if (platforms.includes(platformMatch) || platforms.includes(event.source)) {
                const platform = platforms.includes(event.source) ? event.source : platformMatch;
                const triggerEvent = event.eventType.includes('.') ? event.eventType.split('.').slice(1).join('.') : event.eventType;
                
                await this.processEvent(platform, triggerEvent, event.payload, event.context?.organizationId, event.eventId);
            }
        });

        this.isInitialized = true;
        logger.info("SaaS Event Orchestrator initialized and listening.");
    }

    async processEvent(platform: string, triggerEvent: string, payload: any, orgId?: number, eventId?: string) {
        logger.debug(`Processing SaaS event: platform=${platform}, event=${triggerEvent}, orgId=${orgId}`);

        // Bridge real-time SaaS event into Signal Studio pipeline
        if (orgId) {
            await this.bridgeToSignalStudio(platform, triggerEvent, payload, orgId, eventId);
        }

        try {
            const conditions: any[] = [
                eq(saasEventWorkflows.platform, platform),
                eq(saasEventWorkflows.triggerEvent, triggerEvent),
                eq(saasEventWorkflows.enabled, true)
            ];

            if (orgId) {
                conditions.push(eq(saasEventWorkflows.orgId, orgId));
            }

            const workflows = await db.select()
                .from(saasEventWorkflows)
                .where(and(...conditions));

            if (workflows.length === 0) {
                return [];
            }

            const results = [];
            for (const workflow of workflows) {
                try {
                    // 1. Evaluate conditions (simplified for now)
                    const matches = this.evaluateConditions(payload, workflow.conditions);
                    if (!matches) {
                        logger.debug(`Workflow ${workflow.id} conditions not met for event.`);
                        continue;
                    }

                    // 2. Perform transformation (simplified for now)
                    const transformedPayload = this.transformPayload(payload, workflow.transformation);

                    // 3. Launch Mission
                    // workflowId is expected to be a Mission ID (number) or slug
                    let missionId: number | null = null;
                    if (/^\d+$/.test(workflow.workflowId)) {
                        missionId = parseInt(workflow.workflowId);
                    } else {
                        // Look up mission by slug/name if needed
                        // For now, assume it's an ID
                        logger.warn(`Workflow ${workflow.id} has non-numeric workflow_id: ${workflow.workflowId}. Mapping to slugs not implemented yet.`);
                    }

                    if (missionId) {
                        logger.info(`Triggering mission ${missionId} for workflow ${workflow.id}`);
                        const { missionExecutionService } = await import("../mission/core/mission-execution.service.js");
                        const run = await missionExecutionService.launchMission(
                            missionId, 
                            'system', 
                            workflow.orgId,
                            undefined,
                            undefined,
                            { 
                                event_trigger: { platform, triggerEvent },
                                payload: transformedPayload 
                            }
                        );
                        
                        if (run.success && run.missionRunId) {
                            results.push({
                                pathway: workflow.workflowId,
                                status: "success",
                                result: { missionId, runId: run.missionRunId }
                            });
                        } else {
                            results.push({
                                pathway: workflow.workflowId,
                                status: "error",
                                error: run.error || "Failed to launch mission"
                            });
                        }
                    } else {
                        results.push({
                            pathway: workflow.workflowId,
                            status: "error",
                            error: "Invalid mission ID"
                        });
                    }
                } catch (err: any) {
                    logger.error(`Error executing workflow ${workflow.id}:`, err.message);
                    results.push({
                        pathway: workflow.workflowId,
                        status: "error",
                        error: err.message
                    });
                }
            }
            return results;
        } catch (err: any) {
            logger.error(`Failed to process SaaS event:`, err.message);
            throw err;
        }
    }

    private evaluateConditions(payload: any, conditions: any): boolean {
        // Simple JSON-based matching for now
        // e.g. { "priority": "High" } means payload.priority must be "High"
        if (!conditions || Object.keys(conditions).length === 0) return true;
        
        for (const [key, value] of Object.entries(conditions)) {
            if (payload[key] !== value) return false;
        }
        return true;
    }

    private transformPayload(payload: any, transformation: any): any {
        // Simple mapping for now
        if (!transformation || Object.keys(transformation).length === 0) return payload;
        
        const result: any = {};
        for (const [targetKey, sourceKey] of Object.entries(transformation)) {
            if (typeof sourceKey === 'string' && sourceKey.startsWith('$')) {
                const path = sourceKey.substring(1);
                result[targetKey] = payload[path];
            } else {
                result[targetKey] = sourceKey; // Literal
            }
        }
        return result;
    }

    private async bridgeToSignalStudio(
        platform: string,
        triggerEvent: string,
        payload: any,
        orgId: number,
        eventId?: string
    ): Promise<void> {
        try {
            // Determine severity from payload
            let severity: Severity = "Medium";
            const payloadStr = JSON.stringify(payload || {}).toLowerCase();
            if (payloadStr.includes("critical") || payloadStr.includes("sev0") || payloadStr.includes("sev1") || payloadStr.includes("fatal")) {
                severity = "Critical";
            } else if (payloadStr.includes("high") || payloadStr.includes("error") || payloadStr.includes("sev2") || payloadStr.includes("p1")) {
                severity = "High";
            } else if (payloadStr.includes("low") || payloadStr.includes("minor") || payloadStr.includes("trivial")) {
                severity = "Low";
            }

            // Determine EventType
            let eventType: EventType;
            if (payloadStr.includes("security") || payloadStr.includes("cve") || payloadStr.includes("vulnerability") || payloadStr.includes("breach")) {
                eventType = "Security_Incident";
            } else if (payloadStr.includes("incident") || payloadStr.includes("outage") || payloadStr.includes("disruption") || payloadStr.includes("failure")) {
                eventType = "Operational_Disruption";
            } else if (payloadStr.includes("policy") || payloadStr.includes("rule")) {
                eventType = "Policy_Change";
            } else if (payloadStr.includes("compliance") || payloadStr.includes("audit") || payloadStr.includes("regulatory")) {
                eventType = "Compliance_Mandate";
            } else {
                eventType = "Operational_Disruption";
            }

            // Generate content hash
            const rawText = typeof payload === "string" ? payload : JSON.stringify(payload);
            const contentHash = createHash("sha256")
                .update(`${platform}:${triggerEvent}:${rawText}`)
                .digest("hex");

            // Look up any matching SaaS feeds for this org to mark active/delivered
            const feeds = await db
                .select()
                .from(signalFeeds)
                .where(
                    and(
                        eq(signalFeeds.organizationId, orgId),
                        eq(signalFeeds.sourceType, "saas_adapter"),
                        eq(signalFeeds.enabled, true)
                    )
                );

            const matchingFeed = feeds.find(f => {
                const url = (f.url || "").toLowerCase();
                return url.includes(platform.toLowerCase());
            }) || feeds[0];

            const sourceUrl = matchingFeed?.url || `https://${platform}.internal/events`;

            const inserted = await eventIngressService.insertEvent({
                organizationId: orgId,
                sourceEntryId: eventId || `saas-${randomUUID()}`,
                eventType,
                targetSector: "Enterprise_Operations",
                jurisdiction: "Global",
                severity,
                sourceUrl,
                extractionTimestamp: new Date(),
                confidenceScore: 0.9,
                rawText: rawText.slice(0, 5000),
                flags: [platform, triggerEvent],
                contentHash,
            });

            if (matchingFeed) {
                await eventIngressService.markFeedDelivered(matchingFeed.id);
            }

            if (inserted && inserted.confidenceScore >= 0.3) {
                try {
                    const links = await causalGraphService.mapEventToGraph(inserted);
                    await worldModelBridgeService.emitStateTransition(inserted, links);
                } catch (graphErr: any) {
                    logger.warn(`[SaaSEventOrchestrator] Causal graph mapping failed for SaaS event ${inserted.id}: ${graphErr.message}`);
                }
            }
        } catch (err: any) {
            logger.warn(`[SaaSEventOrchestrator] Failed to bridge SaaS event to Signal Studio: ${err.message}`);
        }
    }
}

export const saasEventOrchestrator = SaaSEventOrchestratorService.getInstance();

