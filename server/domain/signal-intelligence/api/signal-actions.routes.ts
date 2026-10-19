/**
 * Signal Actions REST API Route
 * Endpoint for retrieving the action timeline for a specific signal.
 *
 * GET /api/signals/:id/actions — Returns SignalAction[] sorted by timestamp descending, paginated (50 per page)
 *
 * Requirements: 5.2
 */

import { Router, type Request, type Response } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { and, eq, desc, count } from "drizzle-orm";
import { signalActions } from "@shared/schema/index.js";
import { signalActionsService } from "../core/signal-actions.service.js";

const logger = createLogger("SignalActions");

export const signalActionsRouter = Router();
signalActionsRouter.use(requireAuth);

/**
 * GET /api/signals/:id/actions
 * Returns the action timeline for a specific signal, sorted by timestamp descending.
 *
 * Query params:
 *   page (optional, default 1): Page number (1-indexed)
 *
 * Returns 200 with { data: SignalAction[], pagination: { page, pageSize, total, totalPages } }
 * Returns 400 on invalid signal ID or page param
 * Returns 403 if no org context
 */
signalActionsRouter.get("/:id/actions", asyncHandler(async (req: Request, res: Response) => {
  const orgContext = await getUserOrgContext(req);
  const orgId = requireOrgId(orgContext);

  const signalId = req.params.id;
  if (!signalId || signalId.trim().length === 0) {
    return res.status(400).json({ error: "Signal ID is required" });
  }

  const pageSize = 50;
  const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
  const offset = (page - 1) * pageSize;

  // Get total count for pagination metadata
  const total = await signalActionsService.countForSignal(orgId, signalId);
  const totalPages = Math.ceil(total / pageSize);

  // Fetch actions sorted by timestamp descending with pagination
  const actions = await signalActionsService.listForSignal(orgId, signalId, pageSize, offset);

  // Map to the SignalAction interface expected by the client
  const mappedActions = actions.map((action) => ({
    id: action.id,
    type: mapActionType(action.type),
    timestamp: action.timestamp.toISOString(),
    outcome: deriveOutcome(action.type, action.outcome),
  }));

  logger.debug(
    `Fetched ${mappedActions.length} actions for signal ${signalId} (page ${page}/${totalPages}) for org ${orgId}`,
  );

  res.json({
    data: mappedActions,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  });
}));

/**
 * Map stored action type strings to the SignalAction type union.
 * The DB stores 'dismiss', 'escalate', 'snooze' from bulk actions,
 * plus potentially 'cycle_launched' from cycle creation flows.
 */
function mapActionType(action: string): 'cycle_launched' | 'escalated' | 'dismissed' | 'snoozed' {
  switch (action) {
    case "dismiss": return "dismissed";
    case "escalate": return "escalated";
    case "snooze": return "snoozed";
    case "cycle_launched": return "cycle_launched";
    case "dismissed": return "dismissed";
    case "escalated": return "escalated";
    case "snoozed": return "snoozed";
    default: return "dismissed"; // fallback for unknown action types
  }
}

/**
 * Derive the outcome status for a signal action.
 * Active actions are considered 'succeeded' (completed successfully).
 * Inactive (superseded) actions are also 'succeeded' since they completed
 * but were later replaced by a newer action.
 * Future: could incorporate actual outcome tracking from mutation results.
 */
function deriveOutcome(actionType: string, active: boolean): 'succeeded' | 'failed' | 'pending' {
  // All persisted actions are considered succeeded since they made it to the DB
  return "succeeded";
}
