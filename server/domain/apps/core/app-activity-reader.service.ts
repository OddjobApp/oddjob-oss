import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { appTelemetry } from "@shared/schema/index.js";
import { resolveAppForRecords, type ReaderCtx } from "./app-records-reader.service.js";

/** Persisted app-reported telemetry, never an execution receipt or a room binding. */
export async function readAppActivity(ctx: ReaderCtx, appHint: string, limit = 10, beforeId?: number) {
  const app = await resolveAppForRecords(ctx, appHint);
  const size = Math.min(10, Math.max(1, Math.floor(limit)));
  const rows = await db.select({ id: appTelemetry.id, event: appTelemetry.event,
    level: appTelemetry.level, timestamp: appTelemetry.createdAt }).from(appTelemetry)
    .where(and(eq(appTelemetry.appId, app.id), eq(appTelemetry.orgId, ctx.organizationId),
      beforeId ? lt(appTelemetry.id, beforeId) : undefined))
    .orderBy(desc(appTelemetry.id)).limit(size + 1);
  const events = rows.slice(0, size);
  return { app, source: "app_telemetry", scope: "app-wide within the authorized organization; not room-specific",
    evidence: "Persisted app-reported event names. Not proof of successful tool execution, approvals or completed missions. Metadata is omitted.",
    events, returned: events.length, nextBeforeId: rows.length > size ? events.at(-1)?.id ?? null : null };
}
