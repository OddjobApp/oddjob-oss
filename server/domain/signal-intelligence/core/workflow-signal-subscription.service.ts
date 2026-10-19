/**
 * Signal → workflow delivery.
 *
 * The workflow twin of CycleSignalSubscriptionService: a subscription filters
 * an incoming event primitive with the same SubscriptionFilters vocabulary,
 * and a match starts a run of the workflow's ACTIVE deployment in the
 * subscription's environment — with the signal handed to the run as its input.
 * A run of a mutable draft is deliberately not possible: the release manifest
 * is what executes, so a signal can never race an in-flight edit.
 *
 * Dedupe and double-delivery mirror the cycle service's contract: the
 * `workflow_signal_deliveries` row is unique per (subscription, event
 * primitive) and is inserted BEFORE any side effect, so whichever delivery
 * path arrives second — the in-process bridge or the Kafka consumer —
 * is a no-op.
 *
 * `deliver` and `deliverByCorrelation` are system-level (they run inside the
 * ingest pipeline, not a request); the CRUD methods are ctx-scoped and gated
 * by the workflow's project role, the same gate every other workflow mutation
 * uses.
 */
import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { and, desc, eq } from "drizzle-orm";
import {
  causalGraphLinks,
  eventPrimitives,
  stateTransitionEvents,
  workflowDeployments,
  workflowSignalDeliveries,
  workflowSignalSubscriptions,
  type CausalGraphLink,
  type EventPrimitive,
  type StateTransitionEvent,
  type WorkflowSignalSubscription,
} from "@shared/schema/index.js";
import { requireOrgId, type OrgContext } from "@server/utils/auth-context.js";
import { signalFiltersSchema, type SignalFilters } from "@shared/workflow-signals.js";
import { signalMatchesFilters } from "./signal-subscription-filters.js";
import { workflowLifecycleService } from "@domain/pipeline/core/workflow-lifecycle.service.js";

const logger = createLogger("WorkflowSignalSubscriptionService");

type SignalContext = {
  event: EventPrimitive;
  transition: StateTransitionEvent;
  links: CausalGraphLink[];
};

export class WorkflowSignalSubscriptionService {
  // ---- ctx-scoped CRUD -------------------------------------------------------

  async list(ctx: OrgContext, workflowId: number) {
    const workflow = await workflowLifecycleService.getWorkflowRow(ctx, workflowId);
    await workflowLifecycleService.assertProjectRead(ctx, workflow.id);
    return db.select().from(workflowSignalSubscriptions).where(and(
      eq(workflowSignalSubscriptions.organizationId, requireOrgId(ctx)),
      eq(workflowSignalSubscriptions.workflowId, workflow.id),
    )).orderBy(desc(workflowSignalSubscriptions.createdAt));
  }

  async create(
    ctx: OrgContext,
    workflowId: number,
    input: {
      name: string;
      filters: unknown;
      environment?: string;
      cooldownMinutes?: number;
    },
  ) {
    const workflow = await workflowLifecycleService.getWorkflowRow(ctx, workflowId);
    await workflowLifecycleService.assertProjectRole(ctx, workflow.id, "editor");
    const filters = signalFiltersSchema.parse(input.filters ?? {});
    const [created] = await db.insert(workflowSignalSubscriptions).values({
      organizationId: requireOrgId(ctx),
      workflowId: workflow.id,
      name: input.name,
      filters,
      environment: input.environment ?? "production",
      cooldownMinutes: input.cooldownMinutes ?? 0,
      createdBy: ctx.userId,
    }).returning();
    return created;
  }

  async update(
    ctx: OrgContext,
    workflowId: number,
    id: number,
    patch: {
      name?: string;
      enabled?: boolean;
      filters?: unknown;
      environment?: string;
      cooldownMinutes?: number;
    },
  ) {
    const workflow = await workflowLifecycleService.getWorkflowRow(ctx, workflowId);
    await workflowLifecycleService.assertProjectRole(ctx, workflow.id, "editor");
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.enabled !== undefined) values.enabled = patch.enabled;
    if (patch.environment !== undefined) values.environment = patch.environment;
    if (patch.cooldownMinutes !== undefined) values.cooldownMinutes = patch.cooldownMinutes;
    if (patch.filters !== undefined) values.filters = signalFiltersSchema.parse(patch.filters);
    const [updated] = await db.update(workflowSignalSubscriptions)
      .set(values)
      .where(and(
        eq(workflowSignalSubscriptions.id, id),
        eq(workflowSignalSubscriptions.workflowId, workflow.id),
        eq(workflowSignalSubscriptions.organizationId, requireOrgId(ctx)),
      ))
      .returning();
    return updated ?? null;
  }

  async remove(ctx: OrgContext, workflowId: number, id: number) {
    const workflow = await workflowLifecycleService.getWorkflowRow(ctx, workflowId);
    await workflowLifecycleService.assertProjectRole(ctx, workflow.id, "editor");
    const [deleted] = await db.delete(workflowSignalSubscriptions)
      .where(and(
        eq(workflowSignalSubscriptions.id, id),
        eq(workflowSignalSubscriptions.workflowId, workflow.id),
        eq(workflowSignalSubscriptions.organizationId, requireOrgId(ctx)),
      ))
      .returning();
    return deleted ?? null;
  }

  async deliveries(ctx: OrgContext, workflowId: number, limit = 50) {
    const workflow = await workflowLifecycleService.getWorkflowRow(ctx, workflowId);
    await workflowLifecycleService.assertProjectRead(ctx, workflow.id);
    return db.select().from(workflowSignalDeliveries).where(and(
      eq(workflowSignalDeliveries.organizationId, requireOrgId(ctx)),
      eq(workflowSignalDeliveries.workflowId, workflow.id),
    )).orderBy(desc(workflowSignalDeliveries.deliveredAt)).limit(Math.min(limit, 200));
  }

  // ---- delivery ---------------------------------------------------------------

  /**
   * Fan one assessed signal out to every enabled workflow subscription in the
   * org. Returns the number of runs actually started. A throwing subscription
   * is logged and skipped — one bad row must not starve the others, and the
   * transition that produced the signal is already committed.
   */
  async deliver(
    event: EventPrimitive,
    transition: StateTransitionEvent,
    links: CausalGraphLink[],
  ): Promise<number> {
    const subscriptions = await db.select().from(workflowSignalSubscriptions).where(and(
      eq(workflowSignalSubscriptions.organizationId, event.organizationId),
      eq(workflowSignalSubscriptions.enabled, true),
    )).orderBy(workflowSignalSubscriptions.id);

    let started = 0;
    for (const subscription of subscriptions) {
      try {
        if (!signalMatchesFilters((subscription.filters ?? {}) as SignalFilters, event, links)) continue;
        if (this.inCooldown(subscription)) continue;

        // Dedupe first, side effects second: the unique (subscription, event)
        // row is what makes the two delivery paths safe to run both.
        const [delivery] = await db.insert(workflowSignalDeliveries).values({
          organizationId: event.organizationId,
          subscriptionId: subscription.id,
          workflowId: subscription.workflowId,
          eventPrimitiveId: event.id,
          disposition: "started",
          payload: {
            eventType: event.eventType,
            severity: event.severity,
            confidence: event.confidenceScore,
            variables: transition.environmentVariables,
          },
        }).onConflictDoNothing().returning();
        if (!delivery) continue;

        const workflow = await workflowLifecycleService.getByIdSystem(subscription.workflowId);
        if (!workflow) {
          await this.markDelivery(delivery.id, "error", delivery.payload, `Workflow ${subscription.workflowId} no longer exists`);
          continue;
        }

        const active = await workflowLifecycleService.resolveActiveRelease(
          workflow.draftPipelineId,
          subscription.environment,
        );
        if (!active) {
          const [paused] = await db.select({ id: workflowDeployments.id })
            .from(workflowDeployments)
            .where(and(
              eq(workflowDeployments.workflowId, workflow.id),
              eq(workflowDeployments.environment, subscription.environment),
              eq(workflowDeployments.status, "paused"),
            ))
            .limit(1);
          await this.markDelivery(
            delivery.id,
            paused ? "skipped:paused" : "skipped:no_active_deployment",
            delivery.payload,
          );
        } else {
          // Stamp the row with what the run was launched against before the
          // run starts — it reads correctly even while pipelineExecutionId is
          // still pending.
          await db.update(workflowSignalDeliveries).set({
            releaseId: active.releaseId,
            deploymentId: active.deploymentId,
          }).where(eq(workflowSignalDeliveries.id, delivery.id));
          started++;

          // Fire-and-forget: deliver() runs on the ingest hot path — every
          // signal for the org funnels through emitStateTransition — so a
          // minutes-long workflow run must not queue every later signal
          // behind it. The cycle path meets the same constraint by queueing
          // work rather than running it inline; the launch is detached here
          // for the same reason. The completion handler lands
          // pipelineExecutionId on success, or flips the row to 'error'.
          const { pipelineExecutor } = await import("@server/core/pipeline-executor.js");
          void pipelineExecutor.executePipeline(
            workflow.draftPipelineId,
            "system-signal-trigger",
            null,
            null,
            {
              signal: {
                id: event.id,
                eventType: event.eventType,
                severity: event.severity,
                confidence: event.confidenceScore,
                occurredAt: (event as any).occurredAt ?? event.createdAt,
                variables: transition.environmentVariables,
                subscriptionId: subscription.id,
              },
            },
            undefined,
            undefined,
            undefined,
            undefined,
            { workflowReleaseId: active.releaseId, workflowDeploymentId: active.deploymentId },
          ).then((result) => {
            if (!result.success) throw new Error(result.error ?? "pipeline execution failed");
            logger.info(
              `Signal ${event.id} started workflow ${workflow.id} run ${result.executionId} ` +
              `(release ${active.releaseId}, subscription ${subscription.id})`,
            );
            return db.update(workflowSignalDeliveries)
              .set({ pipelineExecutionId: result.executionId })
              .where(eq(workflowSignalDeliveries.id, delivery.id));
          }).catch((executeError) => {
            const message = executeError instanceof Error ? executeError.message : String(executeError);
            logger.error(`Workflow signal delivery ${delivery.id} failed to start a run: ${message}`);
            return this.markDelivery(delivery.id, "error", delivery.payload, message);
          });
        }

        await db.update(workflowSignalSubscriptions)
          .set({ lastDeliveredAt: new Date(), updatedAt: new Date() })
          .where(eq(workflowSignalSubscriptions.id, subscription.id));
      } catch (subscriptionError) {
        logger.error(
          `Workflow signal subscription ${subscription.id} failed for event ${event.id}`,
          subscriptionError,
        );
      }
    }
    return started;
  }

  /**
   * The Kafka-consumer twin of `deliverByCorrelation` on the cycle service:
   * rebuild the signal from its correlation and run the same delivery, so a
   * consumer on another instance reaches workflows too. The unique delivery
   * row absorbs whichever path arrives second.
   */
  async deliverByCorrelation(organizationId: number, correlationId: string): Promise<number> {
    const context = await this.resolveSignalContext(organizationId, correlationId);
    if (!context) {
      logger.debug(`No signal context for correlation ${correlationId}; nothing to deliver`);
      return 0;
    }
    return this.deliver(context.event, context.transition, context.links);
  }

  private async resolveSignalContext(
    organizationId: number,
    correlationId: string,
  ): Promise<SignalContext | null> {
    const [event] = await db.select().from(eventPrimitives)
      .where(and(
        eq(eventPrimitives.id, correlationId),
        eq(eventPrimitives.organizationId, organizationId),
      )).limit(1);
    if (!event) return null;

    const [links, [transition]] = await Promise.all([
      db.select().from(causalGraphLinks).where(eq(causalGraphLinks.eventPrimitiveId, event.id)),
      db.select().from(stateTransitionEvents)
        .where(eq(stateTransitionEvents.eventPrimitiveId, event.id))
        .orderBy(desc(stateTransitionEvents.createdAt)).limit(1),
    ]);

    if (!transition) return null;
    return { event, transition, links };
  }

  /**
   * `lastDeliveredAt + cooldownMinutes > now` throttles a subscription that
   * just acted — the deliberate fleet-wide mute the cooldown is for.
   */
  private inCooldown(subscription: WorkflowSignalSubscription): boolean {
    if (subscription.cooldownMinutes <= 0 || !subscription.lastDeliveredAt) return false;
    return subscription.lastDeliveredAt.getTime() + subscription.cooldownMinutes * 60_000 > Date.now();
  }

  private async markDelivery(
    deliveryId: string,
    disposition: string,
    priorPayload: unknown,
    error?: string,
  ) {
    const payload = {
      ...((priorPayload ?? {}) as Record<string, unknown>),
      ...(error ? { error } : {}),
    };
    await db.update(workflowSignalDeliveries)
      .set({ disposition, payload })
      .where(eq(workflowSignalDeliveries.id, deliveryId));
  }
}

export const workflowSignalSubscriptionService = new WorkflowSignalSubscriptionService();
