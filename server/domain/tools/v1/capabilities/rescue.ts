import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { createLogger } from "../../../../utils/logger.js";
import { db } from "../../../../database_service.js";
import { apps, appRecords } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";

const logger = createLogger("RescueTools");

export const RESCUE_TOOLS: Record<string, ToolDefinition> = {
    rescue_dispatch_action: {
        name: "rescue_dispatch_action",
        idempotency: "none",
        label: "Execute Rescue Dispatch Stage",
        group: "Rescue",
        description: "Execute one deterministic, idempotent Service Dispatch pipeline stage against the protected app dataset.",
        parameters: z.object({
            action: z.string(),
            stepCode: z.string().optional(),
        }).passthrough(),
        execute: async ({ action, stepCode }: any, context: ToolContext) => {
            const data = ((context as any)?.data || {}) as Record<string, any>;
            const orgId = Number((context as any)?.organizationId || (context as any)?.orgId || data.organizationId);
            const requestId = String(data.requestId || data.id || "").trim();
            if (!orgId || !requestId) {
                throw new Error("Rescue pipeline context requires organizationId and requestId.");
            }

            const [app] = await db.select({ id: apps.id }).from(apps)
                .where(eq(apps.slug, "rescue-dispatch")).limit(1);
            if (!app) throw new Error("Rescue Dispatch app is not configured.");

            const rescueRows = await db.select().from(appRecords).where(and(
                eq(appRecords.appId, app.id),
                eq(appRecords.orgId, orgId),
                eq(appRecords.collection, "active_rescues"),
            ));
            const rescueRow = rescueRows.find((row) => String((row.data as any)?.id) === requestId);
            if (!rescueRow) throw new Error(`Active rescue ${requestId} was not found.`);

            const rescue = rescueRow.data as Record<string, any>;
            const now = new Date();
            const eventId = `${requestId}-${stepCode || action}`.slice(0, 100);
            const eventData = {
                event_id: eventId,
                rescue_id: requestId,
                event_type: action,
                actor: "service-dispatch-pipeline",
                payload: { pipelineExecutionId: (context as any)?.pipelineExecutionId || null },
                created_at: now.toISOString(),
            };
            await db.insert(appRecords).values({
                appId: app.id,
                orgId,
                collection: "dispatch_events",
                recordId: eventId,
                data: eventData,
            }).onConflictDoUpdate({
                target: [appRecords.appId, appRecords.orgId, appRecords.collection, appRecords.recordId],
                set: { data: eventData, updatedAt: now },
            });

            const slaMinutes = rescue.priority === "Critical" ? 15 : rescue.priority === "High" ? 30 : rescue.priority === "Low" ? 120 : 60;
            const pipelineExecutionId = Number((context as any)?.pipelineExecutionId);
            const priorExecutionIds = Array.isArray(rescue.pipeline_execution_ids)
                ? rescue.pipeline_execution_ids.filter((value: unknown) => Number.isInteger(value))
                : [];
            const updates: Record<string, any> = {
                pipeline_last_action: action,
                pipeline_updated_at: now.toISOString(),
                pipeline_execution_ids: Number.isInteger(pipelineExecutionId)
                    ? Array.from(new Set([...priorExecutionIds, pipelineExecutionId]))
                    : priorExecutionIds,
            };

            if (action === "classify_dispatch_priority" && !rescue.sla_due_at) {
                updates.sla_due_at = new Date(new Date(rescue.opened_at || now).getTime() + slaMinutes * 60000).toISOString();
            }
            if (action === "write_active_rescue") updates.intake_pipeline_status = "completed";
            if (action === "request_provider_acceptance") updates.acceptance_requested_at = now.toISOString();
            if (action === "update_tracking_state") updates.assignment_pipeline_status = "completed";
            if (action === "watch_acceptance_window") updates.monitoring_status = "active";
            if (action === "hydrate_dispatcher_context") {
                updates.dispatcher_url = "/app/rescue-dispatch";
                updates.tracker_pipeline_status = "completed";
            }
            if (action === "close_active_rescue" && data.confirmClosure === true) {
                updates.status = "Closed";
                updates.closed_at = now.toISOString();
                updates.resolution_notes = data.resolutionNotes || "Closed by Operations Control";
                updates.monitoring_status = "completed";
            }

            if (action === "record_sla_metrics" && rescue.status === "Closed") {
                const openedAt = new Date(rescue.opened_at || now);
                const closedAt = new Date(rescue.closed_at || now);
                const totalMinutes = Math.max(0, Math.round((closedAt.getTime() - openedAt.getTime()) / 60000));
                const metricData = {
                    rescue_id: requestId,
                    priority: rescue.priority,
                    provider_id: rescue.providerId || null,
                    provider_name: rescue.provider_name || null,
                    opened_at: openedAt.toISOString(),
                    closed_at: closedAt.toISOString(),
                    total_minutes: totalMinutes,
                    sla_minutes: slaMinutes,
                    sla_met: totalMinutes <= slaMinutes,
                    recorded_at: now.toISOString(),
                };
                await db.insert(appRecords).values({
                    appId: app.id,
                    orgId,
                    collection: "dispatch_sla_metrics",
                    recordId: `${requestId}-sla`.slice(0, 100),
                    data: metricData,
                }).onConflictDoUpdate({
                    target: [appRecords.appId, appRecords.orgId, appRecords.collection, appRecords.recordId],
                    set: { data: metricData, updatedAt: now },
                });
                updates.closure_pipeline_status = "completed";
            }

            if (action === "update_provider_scores" && rescue.providerId) {
                const providerRows = await db.select().from(appRecords).where(and(
                    eq(appRecords.appId, app.id),
                    eq(appRecords.orgId, orgId),
                    eq(appRecords.collection, "service_providers"),
                ));
                const providerRow = providerRows.find((row) => String((row.data as any)?.providerId || (row.data as any)?.id) === String(rescue.providerId));
                if (providerRow) {
                    const provider = providerRow.data as Record<string, any>;
                    await db.update(appRecords).set({
                        data: {
                            ...provider,
                            current_load: Math.max(0, Number(provider.current_load ?? provider.currentLoad ?? 0) - 1),
                            completed_jobs: Number(provider.completed_jobs || 0) + 1,
                            last_completed_at: now.toISOString(),
                        },
                        updatedAt: now,
                    }).where(eq(appRecords.id, providerRow.id));
                }
                updates.learning_pipeline_status = "completed";
            }

            await db.update(appRecords).set({
                data: { ...rescue, ...updates },
                updatedAt: now,
            }).where(eq(appRecords.id, rescueRow.id));

            return JSON.stringify({
                success: true,
                action,
                stepCode,
                requestId,
                providerId: rescue.providerId || null,
                status: updates.status || rescue.status,
                slaDueAt: updates.sla_due_at || rescue.sla_due_at || null,
            });
        },
    },
    geo_discovery: {
        name: "geo_discovery",
        idempotency: "read-safe",
        label: "Discover Nearby Helpers",
        group: "Rescue",
        description: "Find qualified rescue helpers within a specific radius of a coordinate.",
        parameters: z.object({
            lat: z.number().describe("Latitude of the search center"),
            lng: z.number().describe("Longitude of the search center"),
            radiusKm: z.number().optional().default(20).describe("Search radius in kilometers"),
            limit: z.number().optional().default(5).describe("Maximum number of helpers to return")
        }),
        execute: async ({ lat, lng, radiusKm, limit }: any, context: ToolContext) => {
            try {
                const { rescueGeoService } = await import("../../../../domain/rescue/core/geo-service.js");
                const helperIds = await rescueGeoService.findNearbyHelpers(lat, lng, radiusKm, limit);

                if (helperIds.length === 0) {
                    return "No helpers found in the specified area.";
                }

                // In a real implementation, we would also fetch details from the Helper Dataset
                // For now, we return the IDs found in the geospatial index
                return `Found ${helperIds.length} nearby helpers: ${helperIds.join(", ")}`;
            } catch (error: any) {
                logger.error("geo_discovery tool failed:", error);
                return `Discovery failed: ${error.message}`;
            }
        }
    },
    rescue_dispatch: {
        name: "rescue_dispatch",

        idempotency: "none",
        label: "Initiate Rescue Dispatch",
        group: "Rescue",
        description: "Trigger a formal rescue coordination flow. This creates a rescue session, initiates the mission, and starts the discovery/dispatch process.",
        parameters: z.object({
            serviceType: z.string().describe("Type of service (e.g. tow, medical, security)"),
            userLat: z.number().describe("User's current latitude"),
            userLng: z.number().describe("User's current longitude"),
            address: z.string().optional().describe("User's physical address or landmark"),
            isDemoMode: z.boolean().optional().default(false).describe("Whether to run in high-fidelity demo/simulator mode")
        }),
        execute: async ({ serviceType, userLat, userLng, address, isDemoMode }: any, context: ToolContext) => {
            if (!context?.missionRunId || !context?.missionId) {
                return "Error: This tool must be called within an active Mission Run context.";
            }
            try {
                const { rescueService } = await import("../../../../domain/rescue/index.js");
                const session = await rescueService.initiateRescue({
                    missionId: context.missionId,
                    missionRunId: context.missionRunId,
                    orgId: context.organizationId || undefined,
                    serviceType,
                    userLocation: {
                        lat: userLat,
                        lng: userLng,
                        address,
                        resolvedBy: address ? 'map' : 'gps'
                    },
                    isDemoMode
                });

                return JSON.stringify({
                    type: 'rescue_status',
                    sessionId: session.id,
                    status: session.status,
                    message: `Rescue Dispatch Initiated! Session ID: ${session.id}. The Dispatcher Agent is now coordinating helpers.`
                });
            } catch (error: any) {
                logger.error("rescue_dispatch tool failed:", error);
                return `Dispatch failed: ${error.message}`;
            }
        }
    },
    geocoding: {
        name: "geocoding",

        idempotency: "read-safe",
        label: "Geocoding (Address <-> Lng/Lat)",
        group: "Rescue",
        description: "Convert a natural language address/landmark into Lng/Lat coordinates, or vice-versa (Reverse Geocoding).",
        parameters: z.object({
            address: z.string().optional().describe("Physical address or landmark to geocode"),
            lat: z.number().optional().describe("Latitude for reverse geocoding"),
            lng: z.number().optional().describe("Longitude for reverse geocoding")
        }),
        execute: async ({ address, lat, lng }: any, context: ToolContext) => {
            const { geocodingService } = await import("../../../../domain/rescue/index.js");

            if (address) {
                const result = await geocodingService.geocode(address);
                if (result) {
                    return JSON.stringify(result, null, 2);
                }
                return `Geocoding failed for "${address}". (Mock only supports Empire State Building, Golden Gate Bridge, and Acme Corp HQ)`;
            }

            if (lat !== undefined && lng !== undefined) {
                const result = await geocodingService.reverseGeocode(lat, lng);
                return JSON.stringify(result, null, 2);
            }

            return "Error: Please provide either an address or lat/lng pair.";
        }
    }
};


