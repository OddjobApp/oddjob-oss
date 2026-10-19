/**
 * Autonomous Action Service
 * Evaluates high-confidence events against organization policies and triggers
 * autonomous actions (spawn_cycle, create_rfc, update_compliance_check, modify_spatial_routing).
 *
 * Responsibilities:
 * - Evaluate events: only severity Critical/High AND confidence >= 0.8 qualify
 * - Match qualifying events against enabled action policies (sector + jurisdiction filters)
 * - Execute auto-approved actions within 60s via event bus
 * - Create pending approval requests for human-gated policies (24h timeout, escalation)
 * - Compute regional volatility (7-day rolling window: frequency × avgSeverity vs org threshold)
 * - Tighten/relax approval gates based on volatility
 * - Log all action executions to autonomous_action_logs table
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8
 */

import { db } from "@server/database_service.js";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import {
  autonomousActionPolicies,
  autonomousActionLogs,
  autonomousActionArtifacts,
  eventPrimitives,
  type EventPrimitive,
  type CausalGraphLink,
  type AutonomousActionPolicy,
  type ActionType,
  type ApprovalGate,
  type Severity,
} from "@shared/schema/index.js";
import { enqueueSpatialAction, enqueueSpatialOutcome } from "./spatial-kafka.service.js";
import { SPATIAL_EVENT_TOPICS } from "@shared/contracts/spatial-events.js";

const logger = createLogger("AutonomousActionService");

// ============================================================================
// CONSTANTS
// ============================================================================

/** Identifies this service as the origin of events on the cross-app bus. */
const SOURCE_APP = "signal-intelligence";

/** Qualifying severities for policy evaluation */
const QUALIFYING_SEVERITIES: Severity[] = ["Critical", "High"];

/** Minimum confidence score required for policy evaluation */
const MIN_CONFIDENCE_THRESHOLD = 0.8;

/** Auto-approve actions must execute within 60 seconds */
const AUTO_APPROVE_EXECUTION_TIMEOUT_MS = 60_000;

/** Approval requests expire after 24 hours */
const APPROVAL_TIMEOUT_MS = 24 * 60 * 60 * 1000;

/** Volatility rolling window in days */
const VOLATILITY_WINDOW_DAYS = 7;

/** Numeric severity weights for volatility calculation */
const SEVERITY_WEIGHTS: Record<string, number> = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

// ============================================================================
// INTERFACES
// ============================================================================

export interface VolatilityMetrics {
  jurisdiction: string;
  eventCount7d: number;
  avgSeverity7d: number;
  threshold: number;
  exceeds: boolean;
}

export interface ApprovalRequest {
  id: string;
  policyId: number;
  eventPrimitiveId: string;
  actionType: ActionType;
  affectedEntities: CausalGraphLink[];
  eventDetails: EventPrimitive;
  createdAt: Date;
  expiresAt: Date;
}

export interface ActionExecutionResult {
  success: boolean;
  actionType: ActionType;
  eventPrimitiveId: string;
  policyId: number;
  failureReason?: string;
  executedAt: Date;
  /**
   * What the handlers that consumed this action actually reported.
   *
   * Carried onto the outcome observation, where `blastRadius` is compared
   * against the world model's prediction. Absent when the action type has no
   * consumer able to measure anything.
   */
  metrics?: Record<string, number>;
}

/**
 * The result of dispatching one action onto the event bus.
 *
 * `executeAction` previously treated "publish() resolved" as success. It always
 * resolves: the bus catches every handler error, and an event type with no
 * registered handler at all publishes just as cleanly as one with a working
 * consumer. So the outcome observation feeding the prediction-error loop was
 * reporting that an event had been EMITTED, not that anything had been DONE,
 * and no prediction could ever be observed to be wrong.
 */
interface ActionDispatch {
  metrics?: Record<string, number>;
}

// ============================================================================
// SERVICE
// ============================================================================

export class AutonomousActionService {
  /**
   * Evaluate an event against the organization's autonomous action policies.
   * Only events with severity Critical/High AND confidence >= 0.8 qualify.
   * Events not meeting this threshold are silently ignored (no policy evaluation).
   *
   * Requirements: 17.1
   */
  async evaluateEvent(
    event: EventPrimitive,
    links: CausalGraphLink[]
  ): Promise<void> {
    // Gate: Only Critical/High severity AND confidence >= 0.8 qualify
    if (!this.qualifiesForEvaluation(event)) {
      logger.debug(
        `Event ${event.id} does not qualify for autonomous action evaluation ` +
          `(severity=${event.severity}, confidence=${event.confidenceScore})`
      );
      return;
    }

    // Check regional volatility and tighten gates if needed
    await this.checkAndUpdateVolatility(event.organizationId, event.jurisdiction);

    // Match against enabled policies
    const matchedPolicies = await this.matchPolicies(event);

    if (matchedPolicies.length === 0) {
      logger.debug(`No policies matched for event ${event.id}`);
      return;
    }

    // Process each matched policy
    for (const policy of matchedPolicies) {
      if (policy.effectiveApprovalGate === "auto_approve") {
        await this.executeAction(policy, event, links);
      } else {
        await this.createApprovalRequest(policy, event, links);
      }
    }
  }

  /**
   * Check if an event qualifies for policy evaluation.
   * Must be Critical/High severity AND confidence >= 0.8.
   *
   * Requirements: 17.1
   */
  qualifiesForEvaluation(event: EventPrimitive): boolean {
    const hasSeverity = QUALIFYING_SEVERITIES.includes(event.severity as Severity);
    const hasConfidence = event.confidenceScore >= MIN_CONFIDENCE_THRESHOLD;
    return hasSeverity && hasConfidence;
  }

  /**
   * Match an event against the organization's enabled action policies.
   * Filters by sector and jurisdiction from the policy's triggerCondition.
   *
   * A policy matches if:
   * - It is enabled
   * - The event's severity meets or exceeds the policy's minSeverity
   * - The event's targetSector matches the policy's sectorFilter (or sectorFilter is empty/absent)
   * - The event's jurisdiction matches the policy's jurisdictionFilter (or jurisdictionFilter is empty/absent)
   *
   * Requirements: 17.2
   */
  async matchPolicies(event: EventPrimitive): Promise<AutonomousActionPolicy[]> {
    // Get all enabled policies for the organization
    const policies = await db
      .select()
      .from(autonomousActionPolicies)
      .where(
        and(
          eq(autonomousActionPolicies.organizationId, event.organizationId),
          eq(autonomousActionPolicies.enabled, true)
        )
      );

    // Filter policies by trigger condition
    return policies.filter((policy) => {
      const condition = policy.triggerCondition as {
        minSeverity?: Severity;
        sectorFilter?: string[];
        jurisdictionFilter?: string[];
      };

      // Check severity threshold
      if (condition.minSeverity) {
        const eventSeverityWeight = SEVERITY_WEIGHTS[event.severity] ?? 0;
        const requiredSeverityWeight = SEVERITY_WEIGHTS[condition.minSeverity] ?? 0;
        if (eventSeverityWeight < requiredSeverityWeight) {
          return false;
        }
      }

      // Check sector filter (empty means all sectors match)
      if (condition.sectorFilter && condition.sectorFilter.length > 0) {
        const sectorMatch = condition.sectorFilter.some(
          (s) => s.toLowerCase() === event.targetSector.toLowerCase()
        );
        if (!sectorMatch) return false;
      }

      // Check jurisdiction filter (empty means all jurisdictions match)
      if (condition.jurisdictionFilter && condition.jurisdictionFilter.length > 0) {
        const jurisdictionMatch = condition.jurisdictionFilter.some(
          (j) => j.toLowerCase() === event.jurisdiction.toLowerCase()
        );
        if (!jurisdictionMatch) return false;
      }

      return true;
    });
  }

  /**
   * Execute an autonomous action for an auto-approved policy.
   * Must complete within 60 seconds. Logs the execution result.
   *
   * Requirements: 17.3, 17.6, 17.7
   */
  async executeAction(
    policy: AutonomousActionPolicy,
    event: EventPrimitive,
    links?: CausalGraphLink[]
  ): Promise<ActionExecutionResult> {
    const executedAt = new Date();
    let result: ActionExecutionResult;

    try {
      // Execute the action type. Each returns what its handlers reported, and
      // throws when nothing actually performed the work.
      let dispatched: ActionDispatch;
      switch (policy.actionType as ActionType) {
        case "spawn_cycle":
          dispatched = await this.spawnCycle(event, links ?? []);
          break;
        case "create_rfc":
          dispatched = await this.createRfc(event, links ?? [], policy.id);
          break;
        case "update_compliance_check":
          dispatched = await this.updateComplianceCheck(event, links ?? [], policy.id);
          break;
        case "modify_spatial_routing":
          dispatched = await this.modifySpatialRouting(event, links ?? [], policy.id);
          break;
        default:
          throw new Error(`Unknown action type: ${policy.actionType}`);
      }

      result = {
        success: true,
        actionType: policy.actionType as ActionType,
        eventPrimitiveId: event.id,
        policyId: policy.id,
        executedAt,
        metrics: dispatched.metrics,
      };

      logger.info(
        `Autonomous action executed: policy=${policy.id}, type=${policy.actionType}, event=${event.id}`
      );
    } catch (error) {
      const failureReason = error instanceof Error ? error.message : "Unknown execution error";

      result = {
        success: false,
        actionType: policy.actionType as ActionType,
        eventPrimitiveId: event.id,
        policyId: policy.id,
        failureReason,
        executedAt,
      };

      logger.error(
        `Autonomous action failed: policy=${policy.id}, type=${policy.actionType}, event=${event.id}, reason=${failureReason}`
      );
    }

    // Log the execution regardless of success/failure
    await this.logExecution(event, policy, result);

    return result;
  }

  /**
   * Create a pending approval request for a human-gated policy.
   * Holds execution until operator approves or 24-hour timeout expires.
   *
   * Requirements: 17.4
   */
  async createApprovalRequest(
    policy: AutonomousActionPolicy,
    event: EventPrimitive,
    links?: CausalGraphLink[]
  ): Promise<ApprovalRequest> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + APPROVAL_TIMEOUT_MS);

    const approvalRequest: ApprovalRequest = {
      id: `approval-${policy.id}-${event.id}`,
      policyId: policy.id,
      eventPrimitiveId: event.id,
      actionType: policy.actionType as ActionType,
      affectedEntities: links ?? [],
      eventDetails: event,
      createdAt: now,
      expiresAt,
    };

    // Persist the approval and action event atomically.
    await db.transaction(async tx => {
      await tx.insert(autonomousActionLogs).values({
        organizationId: event.organizationId,
        eventPrimitiveId: event.id,
        policyId: policy.id,
        actionType: policy.actionType,
        approvalStatus: "pending",
        outcome: null,
      });
      await enqueueSpatialAction(tx, event.organizationId, {
        actionId: approvalRequest.id,
        signalId: event.id,
        actionType: policy.actionType,
        entityRefs: (links ?? []).map(link => ({ type: link.targetEntityType, id: link.targetEntityId })),
        requiresApproval: true,
        rationale: `Awaiting approval for policy ${policy.id}`,
      }, event.id);
    });

    logger.info(
      `Approval request created: policy=${policy.id}, event=${event.id}, expires=${expiresAt.toISOString()}`
    );

    return approvalRequest;
  }

  /**
   * Compute regional volatility metrics for a jurisdiction.
   * Uses a 7-day rolling window of Event Primitive frequency multiplied by average severity.
   *
   * Formula: volatility = eventCount7d × avgSeverityWeight
   * Threshold comparison: volatility > org configured threshold → exceeds = true
   *
   * Requirements: 17.8
   */
  async computeRegionalVolatility(
    orgId: number,
    jurisdiction: string,
    threshold: number = 50
  ): Promise<VolatilityMetrics> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - VOLATILITY_WINDOW_DAYS);

    // Query events in the jurisdiction within the 7-day window
    const events = await db
      .select({
        severity: eventPrimitives.severity,
      })
      .from(eventPrimitives)
      .where(
        and(
          eq(eventPrimitives.organizationId, orgId),
          eq(eventPrimitives.jurisdiction, jurisdiction),
          gte(eventPrimitives.createdAt, cutoffDate)
        )
      );

    const eventCount7d = events.length;

    // Compute average severity weight
    const totalSeverityWeight = events.reduce((sum, e) => {
      return sum + (SEVERITY_WEIGHTS[e.severity] ?? 1);
    }, 0);
    const avgSeverity7d = eventCount7d > 0 ? totalSeverityWeight / eventCount7d : 0;

    // Volatility = frequency × avgSeverity
    const volatilityScore = eventCount7d * avgSeverity7d;
    const exceeds = volatilityScore > threshold;

    return {
      jurisdiction,
      eventCount7d,
      avgSeverity7d,
      threshold,
      exceeds,
    };
  }

  /**
   * Tighten approval gates for a jurisdiction.
   * Converts all "auto_approve" policies affecting the jurisdiction to "require_human_approval".
   *
   * Requirements: 17.8
   */
  async tightenApprovalGates(orgId: number, jurisdiction: string): Promise<void> {
    // Find all enabled policies for this org that affect the jurisdiction
    const policies = await db
      .select()
      .from(autonomousActionPolicies)
      .where(
        and(
          eq(autonomousActionPolicies.organizationId, orgId),
          eq(autonomousActionPolicies.enabled, true),
          eq(autonomousActionPolicies.approvalGate, "auto_approve")
        )
      );

    // Filter to policies that affect this jurisdiction
    const affectedPolicies = policies.filter((policy) => {
      const condition = policy.triggerCondition as {
        jurisdictionFilter?: string[];
      };
      // A policy affects a jurisdiction if:
      // 1. It has no jurisdiction filter (applies globally)
      // 2. Its jurisdiction filter includes the jurisdiction
      if (!condition.jurisdictionFilter || condition.jurisdictionFilter.length === 0) {
        return true;
      }
      return condition.jurisdictionFilter.some(
        (j) => j.toLowerCase() === jurisdiction.toLowerCase()
      );
    });

    // Tighten each affected policy
    for (const policy of affectedPolicies) {
      await db
        .update(autonomousActionPolicies)
        .set({
          effectiveApprovalGate: "require_human_approval",
          volatilityOverride: true,
          updatedAt: new Date(),
        })
        .where(eq(autonomousActionPolicies.id, policy.id));
    }

    if (affectedPolicies.length > 0) {
      logger.info(
        `Tightened ${affectedPolicies.length} approval gates for jurisdiction=${jurisdiction}, org=${orgId}`
      );
    }
  }

  /**
   * Relax approval gates for a jurisdiction.
   * Restores "auto_approve" policies that were tightened by volatility override.
   *
   * Requirements: 17.8
   */
  async relaxApprovalGates(orgId: number, jurisdiction: string): Promise<void> {
    // Find all policies with volatility override active for this org
    const policies = await db
      .select()
      .from(autonomousActionPolicies)
      .where(
        and(
          eq(autonomousActionPolicies.organizationId, orgId),
          eq(autonomousActionPolicies.enabled, true),
          eq(autonomousActionPolicies.volatilityOverride, true)
        )
      );

    // Filter to policies that affect this jurisdiction
    const affectedPolicies = policies.filter((policy) => {
      const condition = policy.triggerCondition as {
        jurisdictionFilter?: string[];
      };
      if (!condition.jurisdictionFilter || condition.jurisdictionFilter.length === 0) {
        return true;
      }
      return condition.jurisdictionFilter.some(
        (j) => j.toLowerCase() === jurisdiction.toLowerCase()
      );
    });

    // Relax each affected policy
    for (const policy of affectedPolicies) {
      await db
        .update(autonomousActionPolicies)
        .set({
          effectiveApprovalGate: policy.approvalGate, // Restore original gate
          volatilityOverride: false,
          updatedAt: new Date(),
        })
        .where(eq(autonomousActionPolicies.id, policy.id));
    }

    if (affectedPolicies.length > 0) {
      logger.info(
        `Relaxed ${affectedPolicies.length} approval gates for jurisdiction=${jurisdiction}, org=${orgId}`
      );
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Check and update volatility for a jurisdiction. If volatility exceeds
   * the threshold, tighten gates; otherwise relax them.
   */
  private async checkAndUpdateVolatility(
    orgId: number,
    jurisdiction: string
  ): Promise<void> {
    const metrics = await this.computeRegionalVolatility(orgId, jurisdiction);

    if (metrics.exceeds) {
      await this.tightenApprovalGates(orgId, jurisdiction);
    } else {
      await this.relaxApprovalGates(orgId, jurisdiction);
    }
  }

  /**
   * Log an action execution to the autonomous_action_logs table.
   * Logs both successful and failed executions.
   *
   * Requirements: 17.7
   */
  private async logExecution(
    event: EventPrimitive,
    policy: AutonomousActionPolicy,
    result: ActionExecutionResult
  ): Promise<void> {
    const actionId = `policy-${policy.id}-signal-${event.id}`;
    let outcomeEventId: string | undefined;
    await db.transaction(async tx => {
      await tx.insert(autonomousActionLogs).values({
        organizationId: event.organizationId,
        eventPrimitiveId: event.id,
        policyId: policy.id,
        actionType: policy.actionType,
        approvalStatus: "auto_approved",
        executedAt: result.executedAt,
        outcome: result.success ? "success" : "failure",
        failureReason: result.failureReason ?? null,
      });
      const requestEventId = await enqueueSpatialAction(tx, event.organizationId, {
        actionId,
        signalId: event.id,
        actionType: policy.actionType,
        entityRefs: [],
        requiresApproval: false,
        rationale: `Matched autonomy policy ${policy.id}`,
      }, event.id);
      // `metrics` is what makes the magnitude half of the prediction-error
      // comparison possible. Without it `computeSurprise` skipped the
      // blastRadius branch entirely, so the only reachable surprise was an
      // outcome mismatch — which itself could never happen while every action
      // reported success.
      outcomeEventId = await enqueueSpatialOutcome(tx, event.organizationId, {
        actionId,
        signalId: event.id,
        outcome: result.success ? 'succeeded' : 'failed',
        summary: result.failureReason,
        metrics: result.metrics,
      }, event.id, requestEventId);
    });

    // Evaluated here, not only on the Kafka consumer that also receives this
    // outcome. The consumer path only runs when a broker is configured, and
    // KAFKA_ENABLED defaults to false — so without this the entire
    // prediction-error loop is dark on default configuration.
    //
    // Safe to run in both places: the surprise event id is derived from the
    // observation, so the outbox dedupes the publish, and the delivery row's
    // surprise stamp dedupes the cycle effect.
    if (outcomeEventId) {
      const { spatialSurpriseService } = await import('./spatial-surprise.service.js');
      await spatialSurpriseService.evaluateOutcome({
        eventId: outcomeEventId,
        eventType: SPATIAL_EVENT_TOPICS.action,
        type: 'observation',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        organizationId: event.organizationId,
        producer: 'signal-intelligence',
        correlationId: event.id,
        subject: `action:${actionId}`,
        payload: {
          actionId,
          signalId: event.id,
          outcome: result.success ? 'succeeded' : 'failed',
          summary: result.failureReason,
          metrics: result.metrics,
        },
      });
    }
  }

  /**
   * Publishes an action onto the cross-app bus and turns what the handlers
   * reported into a verdict.
   *
   * Throws when nothing did the work, which `executeAction` records as a
   * failed action. Two cases matter and both used to read as success:
   *
   *  - **No registered handler.** The action was announced to an empty room.
   *    Only `spawn_cycle` currently has a consumer, so `create_rfc`,
   *    `update_compliance_check` and `modify_spatial_routing` have been
   *    reporting success for doing nothing at all.
   *  - **Every handler failed.** The bus contains handler errors by design so
   *    one bad consumer cannot break a fan-out; that containment used to also
   *    hide the failure from the publisher.
   *
   * A partial failure — some handlers succeeded, some did not — counts as
   * success with the failure recorded in the detail, because the action did
   * take effect somewhere.
   */
  private async dispatch(
    type: any,
    organizationId: number,
    payload: Record<string, unknown>,
  ): Promise<ActionDispatch> {
    const { crossAppEventBus } = await import("@domain/org/core/event-bus.service.js");

    const { outcomes } = await crossAppEventBus.publishWithResults({
      type,
      organizationId,
      sourceApp: SOURCE_APP,
      payload,
    } as any);

    const acted = outcomes.filter((o) => o.status === "succeeded");

    if (outcomes.length === 0) {
      throw new Error(
        `No handler is registered for ${String(type)}; the action was published but nothing performed it`,
      );
    }
    if (acted.length === 0) {
      const reasons = outcomes
        .map((o) => `${o.name}: ${o.status}${o.detail ? ` (${o.detail})` : ""}`)
        .join("; ");
      throw new Error(`No handler completed ${String(type)} — ${reasons}`);
    }

    // Merge what the successful handlers measured. Later handlers win on a key
    // collision; in practice one consumer measures any given quantity.
    const metrics = acted.reduce<Record<string, number>>(
      (all, o) => ({ ...all, ...(o.metrics ?? {}) }),
      {},
    );

    return { metrics: Object.keys(metrics).length ? metrics : undefined };
  }

  /**
   * Spawn a new Cycle linked to the triggering event and affected entities.
   * Priority is derived from event severity.
   *
   * Requirements: 17.6
   */
  private async spawnCycle(
    event: EventPrimitive,
    links: CausalGraphLink[]
  ): Promise<ActionDispatch> {
    // publish(), not emit(): raw emit only reaches EventEmitter listeners, so it
    // would skip every handler registered through registerHandler() and never
    // write the event log. `dispatch` uses publishWithResults so the handler's
    // verdict — and the blast radius it actually scoped the cycle to — comes
    // back rather than being discarded.
    const { CrossAppEventType } = await import("@domain/org/core/event-bus.service.js");

    return this.dispatch(
      CrossAppEventType.AUTONOMOUS_ACTION_SPAWN_CYCLE,
      event.organizationId,
      {
        eventPrimitiveId: event.id,
        organizationId: event.organizationId,
        severity: event.severity,
        jurisdiction: event.jurisdiction,
        targetSector: event.targetSector,
        affectedEntityIds: links.map((l) => l.targetEntityId),
        priority: this.severityToPriority(event.severity),
        triggerContext: {
          eventType: event.eventType,
          confidenceScore: event.confidenceScore,
          rawText: event.rawText,
        },
      },
    );
  }

  /**
   * Open an RFC proposing a change of posture in response to the signal.
   *
   * The handler records it as an artifact requiring human scoping — the policy
   * authorised RAISING the request, not acting on it.
   */
  private async createRfc(
    event: EventPrimitive,
    links: CausalGraphLink[],
    policyId: number,
  ): Promise<ActionDispatch> {
    return this.dispatchArtifactAction(
      "AUTONOMOUS_ACTION_CREATE_RFC",
      event,
      links,
      policyId,
    );
  }

  /**
   * Flag the signal for compliance review.
   *
   * Records that a review is warranted; it does not assess or attest to
   * anything, because the platform has compliance schemas but no control store
   * to assess against.
   */
  private async updateComplianceCheck(
    event: EventPrimitive,
    links: CausalGraphLink[],
    policyId: number,
  ): Promise<ActionDispatch> {
    return this.dispatchArtifactAction(
      "AUTONOMOUS_ACTION_UPDATE_COMPLIANCE_CHECK",
      event,
      links,
      policyId,
    );
  }

  /**
   * Record an advisory routing directive covering the affected assets.
   *
   * Advisory by design: re-routing live assets unattended on an automated
   * signal is not a decision this policy is authorised to take, so the artifact
   * carries the recommendation and the assets it covers until acknowledged.
   */
  private async modifySpatialRouting(
    event: EventPrimitive,
    links: CausalGraphLink[],
    policyId: number,
  ): Promise<ActionDispatch> {
    return this.dispatchArtifactAction(
      "AUTONOMOUS_ACTION_MODIFY_SPATIAL_ROUTING",
      event,
      links,
      policyId,
    );
  }

  /**
   * Shared dispatch for the three action types backed by an artifact.
   *
   * They differ only in which event type they publish; the payload is identical,
   * and the handler decides what the artifact says. Keeping the payload in one
   * place is what stopped `affectedEntityIds` being present on spawn_cycle and
   * missing everywhere else — which is why blast radius was only ever observable
   * for one of the four action types.
   */
  private async dispatchArtifactAction(
    eventTypeKey:
      | "AUTONOMOUS_ACTION_CREATE_RFC"
      | "AUTONOMOUS_ACTION_UPDATE_COMPLIANCE_CHECK"
      | "AUTONOMOUS_ACTION_MODIFY_SPATIAL_ROUTING",
    event: EventPrimitive,
    links: CausalGraphLink[],
    policyId: number,
  ): Promise<ActionDispatch> {
    const { CrossAppEventType } = await import("@domain/org/core/event-bus.service.js");

    return this.dispatch(CrossAppEventType[eventTypeKey], event.organizationId, {
      eventPrimitiveId: event.id,
      organizationId: event.organizationId,
      policyId,
      eventType: event.eventType,
      severity: event.severity,
      jurisdiction: event.jurisdiction,
      targetSector: event.targetSector,
      affectedEntityIds: links.map((l) => l.targetEntityId),
      triggerContext: {
        eventType: event.eventType,
        confidenceScore: event.confidenceScore,
        rawText: event.rawText,
      },
    });
  }

  /**
   * Convert severity to numeric priority for cycle creation.
   */
  private severityToPriority(severity: string): number {
    switch (severity) {
      case "Critical":
        return 1;
      case "High":
        return 2;
      case "Medium":
        return 3;
      case "Low":
        return 4;
      default:
        return 5;
    }
  }

  // ---- Route-backing queries -------------------------------------------------
  // These sit here rather than in signal-intelligence.routes.ts because route
  // handlers must not touch db directly (lint:arch / Deep Module).

  /** Event primitives matching an operator's filters, newest first. */
  async searchEventPrimitives(orgId: number, filters: {
    severity?: string;
    sector?: string;
    jurisdiction?: string;
    startTime?: string;
    endTime?: string;
    limit: number;
  }) {
    const conditions = [eq(eventPrimitives.organizationId, orgId)];
    if (filters.severity) conditions.push(eq(eventPrimitives.severity, filters.severity));
    if (filters.sector) conditions.push(eq(eventPrimitives.targetSector, filters.sector));
    if (filters.jurisdiction) conditions.push(eq(eventPrimitives.jurisdiction, filters.jurisdiction));
    if (filters.startTime) conditions.push(gte(eventPrimitives.extractionTimestamp, new Date(filters.startTime)));
    if (filters.endTime) conditions.push(lte(eventPrimitives.extractionTimestamp, new Date(filters.endTime)));

    return await db
      .select()
      .from(eventPrimitives)
      .where(and(...conditions))
      .orderBy(desc(eventPrimitives.extractionTimestamp))
      .limit(filters.limit);
  }

  async listPolicies(orgId: number) {
    return await db
      .select()
      .from(autonomousActionPolicies)
      .where(eq(autonomousActionPolicies.organizationId, orgId))
      .orderBy(desc(autonomousActionPolicies.createdAt));
  }

  async createPolicy(orgId: number, values: Record<string, any>) {
    const [created] = await db
      .insert(autonomousActionPolicies)
      .values({ ...values, organizationId: orgId } as any)
      .returning();
    return created;
  }

  async listArtifacts(orgId: number, filters: { status?: string; kind?: string; eventPrimitiveId?: string; limit: number }) {
    const conditions = [eq(autonomousActionArtifacts.organizationId, orgId)];
    if (filters.status) conditions.push(eq(autonomousActionArtifacts.status, filters.status));
    if (filters.kind) conditions.push(eq(autonomousActionArtifacts.kind, filters.kind));
    if (filters.eventPrimitiveId !== undefined) {
      conditions.push(eq(autonomousActionArtifacts.eventPrimitiveId, filters.eventPrimitiveId as any));
    }
    return await db
      .select()
      .from(autonomousActionArtifacts)
      .where(and(...conditions))
      .orderBy(desc(autonomousActionArtifacts.createdAt))
      .limit(filters.limit);
  }

  // artifact ids are uuids, not serials — see autonomousActionArtifacts.id
  async updateArtifactStatus(id: string, orgId: number, status: string, resolvedBy: string | null, terminal: boolean) {
    const [updated] = await db
      .update(autonomousActionArtifacts)
      .set({
        status,
        resolvedBy: terminal ? resolvedBy : null,
        resolvedAt: terminal ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(and(eq(autonomousActionArtifacts.id, id), eq(autonomousActionArtifacts.organizationId, orgId)))
      .returning();
    return updated;
  }

  async getActionLog(id: number, orgId: number) {
    const [actionLog] = await db
      .select()
      .from(autonomousActionLogs)
      .where(and(eq(autonomousActionLogs.id, id), eq(autonomousActionLogs.organizationId, orgId)))
      .limit(1);
    return actionLog;
  }

  /**
   * Both decision writers carry the org in the WHERE clause. The route verified
   * ownership with a prior read, but filtering on id alone left the write itself
   * unscoped — a second caller reaching these directly would not be constrained.
   */
  async approveActionLog(id: number, orgId: number) {
    const [updated] = await db
      .update(autonomousActionLogs)
      .set({ approvalStatus: "approved", executedAt: new Date(), outcome: "success" })
      .where(and(eq(autonomousActionLogs.id, id), eq(autonomousActionLogs.organizationId, orgId)))
      .returning();
    return updated;
  }

  async rejectActionLog(id: number, orgId: number, reason?: string) {
    const [updated] = await db
      .update(autonomousActionLogs)
      .set({
        approvalStatus: "rejected",
        outcome: "failure",
        failureReason: reason || "Rejected by operator",
      })
      .where(and(eq(autonomousActionLogs.id, id), eq(autonomousActionLogs.organizationId, orgId)))
      .returning();
    return updated;
  }
}

// ============================================================================
// SINGLETON EXPORT
// ============================================================================

export const autonomousActionService = new AutonomousActionService();
