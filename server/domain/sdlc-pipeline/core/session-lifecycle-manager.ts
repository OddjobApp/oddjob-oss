/**
 * Session Lifecycle Manager
 *
 * Manages generation session state transitions, TTL enforcement, and lifecycle
 * event emission for the SDLC code generation pipeline.
 *
 * State machine:
 *   pending  → active       (on session creation/launch)
 *   active   → paused       (on budget_exceeded)
 *   active   → completed    (on last phase_completed)
 *   active   → failed       (on phase_failed with no rescue)
 *   active   → timed_out    (on ttl_expired)
 *   active   → cancelled    (on user cancel)
 *   paused   → active       (on budget approved / resume)
 *   paused   → cancelled    (on user cancel while paused)
 */

import { db } from "@server/database_service.js";
import { generationSessions } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { eventStream } from "@server/domain/core/infrastructure/event-stream.service.js";
import { createLogger } from "@server/utils/logger.js";
import type { SessionStatus, SessionEvent, PipelineLifecycleEvent } from "./types.js";

const logger = createLogger("SessionLifecycleManager");

// ============================================================================
// STATE MACHINE DEFINITION
// ============================================================================

/**
 * Valid state transitions map.
 * Key = current status, Value = set of statuses that can be transitioned to.
 */
const VALID_TRANSITIONS: Record<SessionStatus, Set<SessionStatus>> = {
  pending: new Set(["active"]),
  active: new Set(["paused", "completed", "failed", "timed_out", "cancelled", "blocked"]),
  paused: new Set(["active", "cancelled"]),
  completed: new Set(),
  failed: new Set(),
  timed_out: new Set(),
  cancelled: new Set(),
  blocked: new Set(["active", "failed", "cancelled"]),
};

/**
 * Derive the target status from a SessionEvent given the current status.
 */
function resolveTargetStatus(currentStatus: SessionStatus, event: SessionEvent): SessionStatus | null {
  switch (event.type) {
    case "phase_started":
      // phase_started transitions pending → active (initial launch)
      if (currentStatus === "pending") return "active";
      // phase_started also resumes paused → active (budget approved / resume)
      if (currentStatus === "paused") return "active";
      // If already active, no status change needed — it's an informational event
      if (currentStatus === "active") return null;
      return null;

    case "phase_completed":
      // phase_completed on an active session can trigger completion
      // The orchestrator decides when the last phase is done and sends this event
      // For lifecycle purposes, we only transition to 'completed' when explicitly indicated
      // The orchestrator will call transition with the appropriate context
      if (currentStatus === "active") return "completed";
      return null;

    case "phase_failed":
      if (currentStatus === "active") return "failed";
      return null;

    case "budget_exceeded":
      if (currentStatus === "active") return "paused";
      return null;

    case "ttl_expired":
      if (currentStatus === "active") return "timed_out";
      return null;

    case "cancelled":
      if (currentStatus === "active" || currentStatus === "paused") return "cancelled";
      return null;
  }
}

// ============================================================================
// TRANSITION
// ============================================================================

/**
 * Validate and execute a session state transition.
 *
 * 1. Loads the current session from DB
 * 2. Resolves the target status from the event
 * 3. Validates the transition is legal
 * 4. Updates the DB
 * 5. Emits a lifecycle event
 *
 * Throws if the session doesn't exist or the transition is illegal.
 */
export async function transition(sessionId: string, event: SessionEvent): Promise<void> {
  // Load current session
  const [session] = await db
    .select({
      id: generationSessions.id,
      status: generationSessions.status,
      organizationId: generationSessions.organizationId,
    })
    .from(generationSessions)
    .where(eq(generationSessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const currentStatus = session.status as SessionStatus;
  const targetStatus = resolveTargetStatus(currentStatus, event);

  // If there's no status change (informational event like phase_started on active session),
  // still emit the event but skip DB update
  if (targetStatus === null) {
    // Emit informational event without status change
    const lifecycleEvent = buildLifecycleEvent(sessionId, session.organizationId!, event);
    if (lifecycleEvent) {
      emitEvent(lifecycleEvent);
    }
    return;
  }

  // Validate the transition is legal
  const allowedTargets = VALID_TRANSITIONS[currentStatus];
  if (!allowedTargets || !allowedTargets.has(targetStatus)) {
    throw new Error(
      `Illegal state transition: ${currentStatus} → ${targetStatus} (event: ${event.type}) for session ${sessionId}`
    );
  }

  // Build the DB update
  const now = new Date();
  const updateData: Record<string, unknown> = {
    status: targetStatus,
    updatedAt: now,
  };

  // Set completedAt for terminal states
  if (targetStatus === "completed" || targetStatus === "failed" || targetStatus === "timed_out" || targetStatus === "cancelled") {
    updateData.completedAt = now;
  }

  // Update DB
  await db
    .update(generationSessions)
    .set(updateData)
    .where(eq(generationSessions.id, sessionId));

  logger.info(
    `Session ${sessionId} transitioned: ${currentStatus} → ${targetStatus} (event: ${event.type})`
  );

  // Emit lifecycle event
  const lifecycleEvent = buildLifecycleEvent(sessionId, session.organizationId!, event, targetStatus);
  if (lifecycleEvent) {
    emitEvent(lifecycleEvent);
  }
}

// ============================================================================
// TTL ENFORCEMENT
// ============================================================================

/**
 * Check whether the session has exceeded its TTL and transition to timed_out if so.
 *
 * Uses the session's `startedAt` and `ttlHours` fields. If either is missing,
 * TTL enforcement is a no-op.
 */
export async function enforceTtl(sessionId: string): Promise<void> {
  const [session] = await db
    .select({
      id: generationSessions.id,
      status: generationSessions.status,
      startedAt: generationSessions.startedAt,
      ttlHours: generationSessions.ttlHours,
    })
    .from(generationSessions)
    .where(eq(generationSessions.id, sessionId))
    .limit(1);

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // Only enforce TTL on active sessions
  if (session.status !== "active") {
    return;
  }

  // If no TTL configured, nothing to enforce
  if (!session.ttlHours || !session.startedAt) {
    return;
  }

  const elapsedMs = Date.now() - session.startedAt.getTime();
  const ttlMs = session.ttlHours * 60 * 60 * 1000;

  if (elapsedMs > ttlMs) {
    logger.warn(
      `Session ${sessionId} exceeded TTL (${session.ttlHours}h). Elapsed: ${Math.round(elapsedMs / 1000 / 60)}min. Transitioning to timed_out.`
    );
    await transition(sessionId, { type: "ttl_expired" });
  }
}

// ============================================================================
// EVENT EMISSION
// ============================================================================

/**
 * Emit a pipeline lifecycle event to the event stream service.
 */
export function emitEvent(event: PipelineLifecycleEvent): void {
  const eventType = `pipeline.${event.eventType}`;

  eventStream.publish(
    eventType,
    event.payload,
    {
      organizationId: event.orgId,
      subject: `session:${event.sessionId}`,
    },
    "pipeline-orchestrator"
  ).catch((err) => {
    logger.error(`Failed to emit lifecycle event ${eventType} for session ${event.sessionId}:`, err);
  });

  logger.debug(
    `Emitted lifecycle event: ${eventType} for session ${event.sessionId}`
  );
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Build a PipelineLifecycleEvent from a SessionEvent and transition context.
 */
function buildLifecycleEvent(
  sessionId: string,
  orgId: number,
  event: SessionEvent,
  targetStatus?: SessionStatus
): PipelineLifecycleEvent | null {
  const timestamp = new Date();

  switch (event.type) {
    case "phase_started":
      return {
        eventType: "phase_started",
        sessionId,
        orgId,
        timestamp,
        payload: { phase: event.phase },
      };

    case "phase_completed":
      return {
        eventType: targetStatus === "completed" ? "session_completed" : "phase_completed",
        sessionId,
        orgId,
        timestamp,
        payload: { phase: event.phase },
      };

    case "phase_failed":
      return {
        eventType: "phase_failed",
        sessionId,
        orgId,
        timestamp,
        payload: { phase: event.phase, error: event.error },
      };

    case "budget_exceeded":
      return {
        eventType: "budget_alert",
        sessionId,
        orgId,
        timestamp,
        payload: { reason: "budget_exceeded" },
      };

    case "ttl_expired":
      return {
        eventType: "session_completed",
        sessionId,
        orgId,
        timestamp,
        payload: { reason: "ttl_expired", finalStatus: "timed_out" },
      };

    case "cancelled":
      return {
        eventType: "session_completed",
        sessionId,
        orgId,
        timestamp,
        payload: { reason: "cancelled", cancelReason: event.reason },
      };
  }
}

// ============================================================================
// EXPORTED SERVICE OBJECT
// ============================================================================

export const sessionLifecycleManager = {
  transition,
  enforceTtl,
  emitEvent,
};
