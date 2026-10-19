/**
 * Copilot guide telemetry: which guided commands an org uses, and how users
 * rate the knowledge sources the Copilot cites. Every method takes a non-null
 * organizationId and reads or writes only that org's rows.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { copilotCommandEvents, copilotSourceReviews } from "@shared/schema/copilot-observability.js";

type NewCommandEvent = typeof copilotCommandEvents.$inferInsert;
type NewSourceReview = typeof copilotSourceReviews.$inferInsert;

export const copilotGuideTelemetryService = {
  async recordCommandEvent(organizationId: number, event: Omit<NewCommandEvent, "organizationId">) {
    const [row] = await db.insert(copilotCommandEvents).values({ ...event, organizationId }).returning();
    return row;
  },

  commandAnalytics(organizationId: number) {
    return db.select({
      commandId: copilotCommandEvents.commandId,
      surface: copilotCommandEvents.surface,
      riskLevel: copilotCommandEvents.riskLevel,
      requiresApproval: copilotCommandEvents.requiresApproval,
      uses: sql<number>`count(*)::int`,
      lastUsedAt: sql<string>`max(${copilotCommandEvents.createdAt})`,
    }).from(copilotCommandEvents)
      .where(eq(copilotCommandEvents.organizationId, organizationId))
      .groupBy(copilotCommandEvents.commandId, copilotCommandEvents.surface, copilotCommandEvents.riskLevel, copilotCommandEvents.requiresApproval);
  },

  async recordSourceReview(organizationId: number, review: Omit<NewSourceReview, "organizationId">) {
    const [row] = await db.insert(copilotSourceReviews).values({ ...review, organizationId }).returning();
    return row;
  },

  /** The org's past reviews of one source, for confidence calibration. */
  sourceReviewHistory(organizationId: number, sourceId: string) {
    return db.select({
      originalConfidence: copilotSourceReviews.originalConfidence,
      outcomeScore: copilotSourceReviews.outcomeScore,
    }).from(copilotSourceReviews).where(and(
      eq(copilotSourceReviews.organizationId, organizationId),
      eq(copilotSourceReviews.sourceId, sourceId),
    ));
  },
};
