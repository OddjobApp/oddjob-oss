import { db } from "@server/database_service.js";
import { antigravityIncidents, missionRuns } from "@shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";
import { type ToolContext, successResponse, errorResponse, validateWithSchema } from "./utils.js";
import { ListIncidentsInput, GetIncidentInput, ResolveIncidentInput } from "../tools/antigravity.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AntigravityHandler");

export async function handleListAntigravityIncidents(args: unknown, context?: ToolContext) {
    const v = validateWithSchema(args, ListIncidentsInput);
    if ('isError' in v) return v;

    try {
        const { status, limit } = v;
        const conditions = [];
        if (status) conditions.push(eq(antigravityIncidents.status, status));

        const incidents = await db.select()
            .from(antigravityIncidents)
            .where(conditions.length > 0 ? and(...conditions) : undefined)
            .orderBy(desc(antigravityIncidents.createdAt))
            .limit(limit);

        return successResponse({ incidents });
    } catch (err: any) {
        return errorResponse(`Failed to list incidents: ${err.message}`);
    }
}

export async function handleGetIncidentContext(args: unknown, context?: ToolContext) {
    const v = validateWithSchema(args, GetIncidentInput);
    if ('isError' in v) return v;

    try {
        const { incidentId } = v;
        const [incident] = await db.select()
            .from(antigravityIncidents)
            .where(eq(antigravityIncidents.id, incidentId))
            .limit(1);

        if (!incident) return errorResponse(`Incident ${incidentId} not found`);

        return successResponse({ incident });
    } catch (err: any) {
        return errorResponse(`Failed to get incident context: ${err.message}`);
    }
}

export async function handleResolveAntigravityIncident(args: unknown, context?: ToolContext) {
    const v = validateWithSchema(args, ResolveIncidentInput);
    if ('isError' in v) return v;

    try {
        const { incidentId, resolution, strategy } = v;
        
        const [incident] = await db.select()
            .from(antigravityIncidents)
            .where(eq(antigravityIncidents.id, incidentId))
            .limit(1);

        if (!incident) return errorResponse(`Incident ${incidentId} not found`);

        // 1. Update Incident
        await db.update(antigravityIncidents)
            .set({
                status: "resolved",
                resolution,
                resolvedAt: new Date(),
                updatedAt: new Date()
            })
            .where(eq(antigravityIncidents.id, incidentId));

        // 2. Transition Mission Run back to active or target strategy
        // In Mach 2, we update the mission run status and context
        await db.update(missionRuns)
            .set({
                status: "running", // Transition from "escalated" back to "running"
                updatedAt: new Date()
            })
            .where(eq(missionRuns.id, incident.missionRunId));

        logger.info(`Incident ${incidentId} resolved via Antigravity. Mission ${incident.missionRunId} resuming with strategy ${strategy}.`);

        return successResponse({ 
            success: true, 
            message: `Incident ${incidentId} resolved. Mission Run ${incident.missionRunId} has been resumed.`,
            resolution,
            strategy
        });
    } catch (err: any) {
        return errorResponse(`Failed to resolve incident: ${err.message}`);
    }
}

/**
 * Internal escalation helper (not exposed as tool, called by WorkflowHealingService)
 */
export async function escalateToAntigravity(data: {
    missionRunId: number;
    description: string;
    context: any;
}) {
    try {
        const [incident] = await db.insert(antigravityIncidents).values({
            missionRunId: data.missionRunId,
            description: data.description,
            context: data.context,
            status: "pending"
        }).returning();

        // Mark mission run as escalated/paused
        await db.update(missionRuns)
            .set({
                status: "failed", // For now using failed as a pause state or we should add "escalated"
                missionContext: {
                    ...(data.context.blackboardSnapshot || {}),
                    escalation_id: incident.id,
                    last_error: { message: data.description }
                },
                updatedAt: new Date()
            })
            .where(eq(missionRuns.id, data.missionRunId));

        return incident;
    } catch (err: any) {
        logger.error(`Escalation failed: ${err.message}`);
        throw err;
    }
}
