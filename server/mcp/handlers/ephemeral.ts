import { GetUserIntentInput } from "../tools/ephemeral.js";
import { db } from "../../database_service.js";
import { contactIntentStates, engagementLogs } from "@shared/schema/index.js";
import { and, eq, desc } from "drizzle-orm";
import { successResponse, errorResponse, type ToolContext } from "./utils.js";
import { requireToolOrgId } from "../../domain/tools/v1/capabilities/org-context.js";

/**
 * A visitor's intent state, within the caller's organization. The tables were
 * keyed only by browser fingerprint, so any caller could read any
 * organization's visitors; rows now carry their organization (migration 0157).
 */
export async function handleGetUserIntent(args: unknown, context?: ToolContext) {
    try {
        const input = GetUserIntentInput.parse(args);
        const organizationId = requireToolOrgId(context);

        // 1. Get latest state
        const [latestState] = await db
            .select()
            .from(contactIntentStates)
            .where(and(
                eq(contactIntentStates.organizationId, organizationId),
                eq(contactIntentStates.userFingerprint, input.fingerprint),
            ))
            .orderBy(desc(contactIntentStates.createdAt))
            .limit(1);

        // 2. Get recent engagements
        const engagements = await db
            .select()
            .from(engagementLogs)
            .where(and(
                eq(engagementLogs.organizationId, organizationId),
                eq(engagementLogs.userFingerprint, input.fingerprint),
            ))
            .orderBy(desc(engagementLogs.createdAt))
            .limit(5);

        if (!latestState) {
            return errorResponse(`No state found for user ${input.fingerprint}`);
        }

        return successResponse({
            current_state: {
                vector: latestState.stateVector,
                confidence: latestState.confidence,
                route: latestState.routePath,
                timestamp: latestState.createdAt
            },
            recent_engagements: engagements.map(e => ({
                strategy: e.strategyName,
                action: e.userAction,
                timestamp: e.createdAt
            }))
        }, `User is in state ${latestState.stateVector} (Confidence: ${latestState.confidence})`);

    } catch (error: any) {
        return errorResponse(error.message);
    }
}
