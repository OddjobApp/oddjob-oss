/**
 * Signal Bulk Actions REST API Route
 * Endpoint for performing bulk triage actions on signals:
 * dismiss, escalate, snooze.
 *
 * POST /api/signals/bulk-action — Execute bulk action on signal IDs
 *
 * Requirements: 4.5, 4.6, 4.10, 4.11
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { and, eq, inArray } from "drizzle-orm";
import { signalActionsService } from "../core/signal-actions.service.js";
import {
  eventPrimitives,
  signalActions,
  bulkActionTypes,
  snoozeDurations,
  type BulkActionType,
  type SnoozeDuration,
} from "@shared/schema/index.js";

const logger = createLogger("SignalBulkActions");

export const signalBulkActionsRouter = Router();
signalBulkActionsRouter.use(requireAuth);

/** Map snooze duration strings to milliseconds */
const SNOOZE_DURATION_MS: Record<SnoozeDuration, number> = {
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

/**
 * POST /api/signals/bulk-action
 * Execute a bulk triage action on a set of signals.
 *
 * Body: {
 *   action: 'dismiss' | 'escalate' | 'snooze',
 *   signalIds: string[],
 *   metadata?: { snoozeDuration?: '15m' | '1h' | '4h' | '24h' }
 * }
 *
 * Returns 200 with { success: true, affected: number, action, signalIds }
 * Returns 400 on validation error
 * Returns 403 if no org context
 */
signalBulkActionsRouter.post("/bulk-action", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const { action, signalIds, metadata } = req.body;

  // Validate action
  if (!action || !bulkActionTypes.includes(action as BulkActionType)) {
    return res.status(400).json({
      error: `Invalid action. Must be one of: ${bulkActionTypes.join(", ")}`,
    });
  }

  // Validate signalIds
  if (!Array.isArray(signalIds) || signalIds.length === 0) {
    return res.status(400).json({
      error: "signalIds must be a non-empty array of signal IDs",
    });
  }

  if (signalIds.some((id: unknown) => typeof id !== "string" || id.trim().length === 0)) {
    return res.status(400).json({
      error: "Each signalId must be a non-empty string",
    });
  }

  // Validate snooze duration if action is snooze
  let snoozedUntil: Date | null = null;
  if (action === "snooze") {
    const snoozeDuration = metadata?.snoozeDuration;
    if (!snoozeDuration || !snoozeDurations.includes(snoozeDuration as SnoozeDuration)) {
      return res.status(400).json({
        error: `Snooze action requires metadata.snoozeDuration. Must be one of: ${snoozeDurations.join(", ")}`,
      });
    }
    snoozedUntil = new Date(Date.now() + SNOOZE_DURATION_MS[snoozeDuration as SnoozeDuration]);
  }

  // Verify signals exist and belong to the org
  const validSignalIds = await signalActionsService.filterOwnedSignalIds(orgId, signalIds);

  if (validSignalIds.length === 0) {
    return res.status(400).json({
      error: "None of the provided signal IDs belong to your organization or exist",
    });
  }

  const inserted = await signalActionsService.applyBulkAction(orgId, {
    action: action as string,
    signalIds: validSignalIds,
    performedBy: orgContext.userId,
    snoozedUntil,
  });

  logger.info(
    `Bulk action '${action}' applied to ${inserted.length} signals for org ${orgId} by ${orgContext.userId}`,
  );

  res.json({
    success: true,
    affected: inserted.length,
    action,
    signalIds: validSignalIds,
  });
}));
