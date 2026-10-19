import { db } from "@server/database_service.js";
import { createLogger } from "@server/utils/logger.js";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import {
  cycleSignalDeliveries,
  cycleSignalSubscriptions,
  cycleWorldStates,
  missionRuns,
  missions,
  operationalCycles,
  eventPrimitives,
  causalGraphLinks,
  stateTransitionEvents,
  type CausalGraphLink,
  type EventPrimitive,
  type StateTransitionEvent,
  type CycleSignalSubscription,
  type MissionRun,
} from "@shared/schema/index.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";
import { subscriptionRuleEngine } from "./subscription-rule-engine.service.js";
import { queueMissionCycle } from "@domain/mission/infrastructure/dynamic-mission-queue.js";
import {
  signalMatchesFilters,
  type SubscriptionFilters,
} from "./signal-subscription-filters.js";

// Re-exported so existing importers and workflow subscriptions share the type.
export type { SubscriptionFilters } from "./signal-subscription-filters.js";

const logger = createLogger("CycleSignalSubscriptionService");

/**
 * The mode a surprise is delivered at, given the subscription's configured one.
 *
 * A floor, not an override: prediction error is always worth at least a replan,
 * so a `context_only` subscription cannot silently swallow it — but an operator
 * who asked for a gate gets their gate, because pausing is a stronger response
 * than re-queueing, not a weaker one.
 */
export const SURPRISE_FLOOR: Record<string, string> = {
  context_only: "replan",
  notify: "replan",
  replan: "replan",
  trigger: "trigger",
  gate: "gate",
};

export class CycleSignalSubscriptionService {
  async getOperationalCycle(cycleId: number, orgId: number) {
    const [cycle] = await db
      .select()
      .from(operationalCycles)
      .where(and(eq(operationalCycles.id, cycleId), eq(operationalCycles.organizationId, orgId)))
      .limit(1);
    return cycle ?? null;
  }

  async createSubscription(values: any) {
    const [created] = await db.insert(cycleSignalSubscriptions).values(values).returning();
    return created;
  }

  async updateSubscription(id: number, orgId: number, values: any) {
    const [updated] = await db
      .update(cycleSignalSubscriptions)
      .set(values)
      .where(and(eq(cycleSignalSubscriptions.id, id), eq(cycleSignalSubscriptions.organizationId, orgId)))
      .returning();
    return updated ?? null;
  }

  async disableSubscription(id: number, orgId: number) {
    const [disabled] = await db
      .update(cycleSignalSubscriptions)
      .set({ enabled: false, updatedAt: new Date() })
      .where(and(eq(cycleSignalSubscriptions.id, id), eq(cycleSignalSubscriptions.organizationId, orgId)))
      .returning();
    return disabled ?? null;
  }

  async list(orgId: number, cycleId?: number) {
    const conditions = [eq(cycleSignalSubscriptions.organizationId, orgId)];
    if (cycleId) conditions.push(eq(cycleSignalSubscriptions.cycleId, cycleId));
    return db.select().from(cycleSignalSubscriptions)
      .where(and(...conditions))
      .orderBy(desc(cycleSignalSubscriptions.createdAt));
  }

  async getWorldState(orgId: number, cycleId: number) {
    const [state] = await db.select().from(cycleWorldStates).where(and(
      eq(cycleWorldStates.organizationId, orgId),
      eq(cycleWorldStates.cycleId, cycleId),
    )).limit(1);
    return state ?? null;
  }

  async getDeliveries(orgId: number, cycleId: number, limit = 50) {
    return db.select().from(cycleSignalDeliveries).where(and(
      eq(cycleSignalDeliveries.organizationId, orgId),
      eq(cycleSignalDeliveries.cycleId, cycleId),
    )).orderBy(desc(cycleSignalDeliveries.deliveredAt)).limit(Math.min(limit, 200));
  }

  async deliver(
    event: EventPrimitive,
    transition: StateTransitionEvent,
    links: CausalGraphLink[],
  ): Promise<number> {
    // Evaluate GRIE Named Rule Suites asynchronously for advanced cognitive & fuzzy rules.
    // Deliberately not awaited: a slow LLM judge must not stall cycle delivery.
    // Per-rule failures are recorded as `error` audit rows inside evaluateEvent;
    // this catch only covers a failure of the whole pass.
    subscriptionRuleEngine.evaluateEvent(event, links).catch((err) => {
      logger.error(
        `Rule evaluation pass failed for event ${event.id}: ${err?.message ?? String(err)}`,
      );
    });

    // Ordered by id so two subscriptions competing over one cycle resolve the
    // same way every time. Unordered, which of two gates pauses the cycle and
    // which reports `noop:cycle_paused` was down to the planner.
    const subscriptions = await db.select().from(cycleSignalSubscriptions).where(and(
      eq(cycleSignalSubscriptions.organizationId, event.organizationId),
      eq(cycleSignalSubscriptions.enabled, true),
    )).orderBy(cycleSignalSubscriptions.id);

    let delivered = 0;
    for (const subscription of subscriptions) {
      if (!this.matches(subscription, event, links)) continue;
      if (await this.inCooldown(subscription, event)) continue;

      const [delivery] = await db.insert(cycleSignalDeliveries).values({
        organizationId: event.organizationId,
        subscriptionId: subscription.id,
        cycleId: subscription.cycleId,
        eventPrimitiveId: event.id,
        stateTransitionId: transition.id,
        disposition: subscription.deliveryMode,
        payload: {
          eventType: event.eventType,
          severity: event.severity,
          confidence: event.confidenceScore,
          variables: transition.environmentVariables,
        },
      }).onConflictDoNothing().returning();

      if (!delivery) continue;
      const effect = await this.projectWorldState(subscription, event, transition);

      // `disposition` records what was ASKED for; `appliedEffect` records what
      // happened. They diverge whenever a mode could not act — a gate on an
      // already-paused cycle, a replan with nothing running — and without both
      // there is no way to tell a working subscription from an inert one.
      await db.update(cycleSignalDeliveries)
        .set({ payload: { ...(delivery.payload as Record<string, unknown>), appliedEffect: effect } })
        .where(eq(cycleSignalDeliveries.id, delivery.id));

      await db.update(cycleSignalSubscriptions)
        .set({ lastDeliveredAt: new Date(), updatedAt: new Date() })
        .where(eq(cycleSignalSubscriptions.id, subscription.id));
      delivered++;
    }
    return delivered;
  }

  /**
   * A surprise means the world diverged from what the model predicted, which is
   * the signal most worth disturbing a cycle over — and until now nothing
   * consumed it.
   *
   * It is routed through the ordinary delivery machinery rather than a parallel
   * one: a surprise is still a signal about the same event primitive, so the
   * subscriptions, filters and delivery modes that already exist are exactly the
   * right vocabulary. It reconstructs the original signal from the correlation
   * both sides share.
   *
   * The mode is escalated to a floor of `replan` (see SURPRISE_FLOOR): a
   * subscription configured `context_only` must not silently swallow the news
   * that a prediction was wrong, but a stronger configured choice is kept.
   *
   * Cooldown is deliberately NOT applied. A cooldown throttles routine signal
   * traffic; a surprise is exceptional by construction, having already passed an
   * error threshold to exist. Repetition is bounded instead by the delivery
   * row's uniqueness — one surprise per subscription per event primitive.
   */
  async deliverSurprise(input: {
    organizationId: number;
    correlationId: string;
    surprise: Record<string, unknown>;
  }): Promise<number> {
    const context = await this.resolveSignalContext(input.organizationId, input.correlationId);
    if (!context) {
      logger.debug(`Surprise for unknown correlation ${input.correlationId}; nothing to deliver`);
      return 0;
    }
    const { event, transition, links } = context;

    const subscriptions = await db.select().from(cycleSignalSubscriptions).where(and(
      eq(cycleSignalSubscriptions.organizationId, input.organizationId),
      eq(cycleSignalSubscriptions.enabled, true),
    )).orderBy(cycleSignalSubscriptions.id);

    let delivered = 0;
    for (const subscription of subscriptions) {
      if (!this.matches(subscription, event, links)) continue;

      // The routine delivery for this signal already occupies the unique
      // (subscription, event) slot, so the surprise amends that row instead of
      // inserting a second one it would collide with. The stamp is also what
      // makes this idempotent across the two callers — the Kafka consumer and
      // the in-process path that runs when the broker is off.
      const [existing] = await db.select().from(cycleSignalDeliveries).where(and(
        eq(cycleSignalDeliveries.subscriptionId, subscription.id),
        eq(cycleSignalDeliveries.eventPrimitiveId, event.id),
      )).limit(1);

      const priorPayload = (existing?.payload as Record<string, unknown>) ?? {};
      if (priorPayload.surpriseAppliedAt) continue;

      const mode = SURPRISE_FLOOR[subscription.deliveryMode] ?? "replan";
      const runs = await db.select().from(missionRuns).where(and(
        eq(missionRuns.cycleId, subscription.cycleId),
        inArray(missionRuns.status, ["active", "paused", "waiting_on_human", "waiting_on_file"]),
      ));

      // Agents have to be told WHY they are replanning. Re-queueing a mission
      // whose context does not mention the prediction error just repeats the
      // work that produced it.
      await this.recordSurpriseContext(subscription, runs, input.surprise);

      const effect = await this.applyDeliveryMode(
        { ...subscription, deliveryMode: mode } as CycleSignalSubscription,
        event,
        runs,
      );

      const payload = {
        ...priorPayload,
        surprise: input.surprise,
        surpriseAppliedAt: new Date().toISOString(),
        surpriseMode: mode,
        surpriseEffect: effect,
      };

      if (existing) {
        await db.update(cycleSignalDeliveries).set({ payload })
          .where(eq(cycleSignalDeliveries.id, existing.id));
      } else {
        // No routine delivery happened — the filters may have changed, or this
        // signal predates the subscription. The surprise still stands on its own.
        await db.insert(cycleSignalDeliveries).values({
          organizationId: input.organizationId,
          subscriptionId: subscription.id,
          cycleId: subscription.cycleId,
          eventPrimitiveId: event.id,
          stateTransitionId: transition?.id ?? null,
          disposition: mode,
          payload,
        }).onConflictDoNothing();
      }

      logger.info(
        `Surprise delivered to cycle ${subscription.cycleId} ` +
        `(${subscription.deliveryMode} -> ${mode} -> ${effect})`,
      );
      delivered++;
    }

    return delivered;
  }

  /**
   * Rebuilds the signal a correlation refers to: the event primitive, its latest
   * state transition and its causal links.
   *
   * Both stream-driven entry points need this. An event on the wire carries only
   * a correlation, while `deliver` works on the rows the assessment was built
   * from — this is the bridge between the two.
   */
  private async resolveSignalContext(
    organizationId: number,
    correlationId: string,
  ): Promise<{ event: EventPrimitive; transition: StateTransitionEvent; links: CausalGraphLink[] } | null> {
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

    // Delivery is defined in terms of a transition; without one there is nothing
    // to project into world state.
    if (!transition) return null;
    return { event, transition, links };
  }

  /**
   * Delivery driven by the durable stream instead of the in-process call.
   *
   * `world-model-bridge` calls `deliver` directly the moment it assesses a
   * signal, which is immediate but bound to one instance: if that process dies
   * between committing the transition and delivering, no cycle ever hears about
   * it, and a consumer running elsewhere would not pick it up. This is the same
   * work reached from the assessment event, so it survives the instance.
   *
   * Both paths run, deliberately. Removing the in-process one would make cycle
   * delivery depend on a broker, and KAFKA_ENABLED defaults to false — the same
   * way the surprise loop was dark until it was evaluated in-process too.
   * Running both is safe because every side effect in `deliver` is gated behind
   * an insert into a table unique on (subscription, event primitive): the second
   * arrival inserts nothing, so it projects nothing, re-queues nothing and
   * pauses nothing. Whichever path arrives first wins; the other is a no-op.
   */
  async deliverByCorrelation(organizationId: number, correlationId: string): Promise<number> {
    const context = await this.resolveSignalContext(organizationId, correlationId);
    if (!context) {
      logger.debug(`No signal context for correlation ${correlationId}; nothing to deliver`);
      return 0;
    }
    return this.deliver(context.event, context.transition, context.links);
  }

  /** Puts the prediction error where a replanning agent will actually read it. */
  private async recordSurpriseContext(
    subscription: CycleSignalSubscription,
    runs: MissionRun[],
    surprise: Record<string, unknown>,
  ): Promise<void> {
    const entry = { ...surprise, receivedAt: new Date().toISOString() };

    for (const run of runs) {
      const current = (run.missionContext as Record<string, any>) ?? {};
      await db.update(missionRuns)
        .set({ missionContext: { ...current, lastSurprise: entry }, updatedAt: new Date() })
        .where(eq(missionRuns.id, run.id));
    }

    const missionIds = [...new Set(runs.map(run => run.missionId).filter((id): id is number => id != null))];
    if (missionIds.length === 0) return;

    const missionRows = await db.select().from(missions).where(inArray(missions.id, missionIds));
    for (const mission of missionRows) {
      const blackboard = (mission.blackboard as Record<string, any>) ?? {};
      await db.update(missions)
        .set({ blackboard: { ...blackboard, last_surprise: entry }, updatedAt: new Date() })
        .where(eq(missions.id, mission.id));
    }
  }

  private matches(subscription: CycleSignalSubscription, event: EventPrimitive, links: CausalGraphLink[]) {
    return signalMatchesFilters((subscription.filters ?? {}) as SubscriptionFilters, event, links);
  }

  /**
   * Whether this subscription is still throttled FOR THIS SUBJECT.
   *
   * Cooldown used to key on `subscription.lastDeliveredAt` alone, which made it
   * a fleet-wide mute: one vessel's signal silenced every other vessel on the
   * same subscription for the whole window, so a Rotterdam congestion signal
   * could swallow an unrelated Hormuz one. The failure mode is silence, which
   * is the hardest kind to notice.
   *
   * A cooldown is meant to stop the same thing being reported repeatedly, and
   * "the same thing" is per tracked entity — the same reading the persistence
   * gate already takes (`spatial_condition_state` is keyed condition+subject).
   * Signals with no subject share the `__global__` bucket, which restores the
   * old behaviour for single-asset feeds, where it was correct.
   */
  private async inCooldown(
    subscription: CycleSignalSubscription,
    event: EventPrimitive,
  ): Promise<boolean> {
    if (subscription.cooldownMinutes <= 0) return false;

    const subjectId = (event as any).subjectId ?? null;
    const since = new Date(Date.now() - subscription.cooldownMinutes * 60_000);

    // The most recent delivery on this subscription for the same subject. Read
    // from the delivery rows rather than a column so the window is per subject
    // without widening the subscriptions table.
    const [recent] = await db
      .select({ deliveredAt: cycleSignalDeliveries.deliveredAt })
      .from(cycleSignalDeliveries)
      .innerJoin(
        eventPrimitives,
        eq(cycleSignalDeliveries.eventPrimitiveId, eventPrimitives.id),
      )
      .where(and(
        eq(cycleSignalDeliveries.subscriptionId, subscription.id),
        gte(cycleSignalDeliveries.deliveredAt, since),
        subjectId == null
          ? isNull(eventPrimitives.subjectId)
          : eq(eventPrimitives.subjectId, subjectId),
      ))
      .orderBy(desc(cycleSignalDeliveries.deliveredAt))
      .limit(1);

    return Boolean(recent);
  }

  private async projectWorldState(
    subscription: CycleSignalSubscription,
    event: EventPrimitive,
    transition: StateTransitionEvent,
  ): Promise<string> {
    const projection = (subscription.stateProjection ?? {}) as Record<string, any>;
    const namespace = typeof projection.namespace === "string" ? projection.namespace : "external_environment";
    const variables = (transition.environmentVariables ?? {}) as Record<string, any>;
    const change = {
      eventId: event.id,
      transitionId: transition.id,
      eventType: event.eventType,
      severity: event.severity,
      confidence: event.confidenceScore,
      summary: event.rawText?.slice(0, 500) || `${event.eventType} affecting ${event.targetSector}`,
      receivedAt: new Date().toISOString(),
    };

    const [existing] = await db.select().from(cycleWorldStates)
      .where(eq(cycleWorldStates.cycleId, subscription.cycleId)).limit(1);
    const nextVersion = (existing?.version ?? 0) + 1;
    const nextVariables = { ...((existing?.variables as Record<string, any>) ?? {}), ...variables };
    const nextChanges = [...(((existing?.materialChanges as any[]) ?? []).slice(-49)), change];

    if (existing) {
      await db.update(cycleWorldStates).set({
        version: nextVersion,
        variables: nextVariables,
        materialChanges: nextChanges,
        lastEventPrimitiveId: event.id,
        lastStateTransitionId: transition.id,
        updatedAt: new Date(),
      }).where(eq(cycleWorldStates.id, existing.id));
    } else {
      await db.insert(cycleWorldStates).values({
        organizationId: event.organizationId,
        cycleId: subscription.cycleId,
        version: nextVersion,
        variables: nextVariables,
        materialChanges: nextChanges,
        lastEventPrimitiveId: event.id,
        lastStateTransitionId: transition.id,
      });
    }

    const runs = await db.select().from(missionRuns).where(and(
      eq(missionRuns.cycleId, subscription.cycleId),
      inArray(missionRuns.status, ["active", "paused", "waiting_on_human", "waiting_on_file"]),
    ));

    for (const run of runs) {
      const current = (run.missionContext as Record<string, any>) ?? {};
      await db.update(missionRuns).set({ missionContext: {
        ...current,
        worldState: {
          ...(current.worldState ?? {}),
          [namespace]: { version: nextVersion, variables: nextVariables, materialChanges: nextChanges },
        },
        triggerEvent: change,
      }, updatedAt: new Date() }).where(eq(missionRuns.id, run.id));
    }

    const missionIds = [...new Set(runs.map(run => run.missionId).filter((id): id is number => id != null))];
    if (missionIds.length) {
      const missionRows = await db.select().from(missions).where(inArray(missions.id, missionIds));
      for (const mission of missionRows) {
        const blackboard = (mission.blackboard as Record<string, any>) ?? {};
        await db.update(missions).set({ blackboard: {
          ...blackboard,
          [namespace]: { version: nextVersion, variables: nextVariables, materialChanges: nextChanges },
          last_signal: change,
        }, updatedAt: new Date() }).where(eq(missions.id, mission.id));
      }
    }

    await eventStream.publish("signal.world_state.updated", {
      cycleId: subscription.cycleId,
      subscriptionId: subscription.id,
      deliveryMode: subscription.deliveryMode,
      worldStateVersion: nextVersion,
      change,
    }, { organizationId: event.organizationId, subject: `cycle:${subscription.cycleId}` }, "signal-intelligence");

    const effect = await this.applyDeliveryMode(subscription, event, runs);

    logger.info(
      `Delivered signal ${event.id} to cycle ${subscription.cycleId} ` +
      `(${subscription.deliveryMode} -> ${effect})`,
    );
    return effect;
  }

  /**
   * Turns a subscription's delivery mode into an actual effect.
   *
   * Every mode records the signal and projects it into world state, mission
   * context and the mission blackboard — that part is unconditional, and it is
   * how a running agent sees the signal at all. What differs is whether the
   * signal also *disturbs* the cycle.
   *
   * `notify` and `gate` previously fell through to the same no-op as
   * `context_only`, so an operator who configured a gate got no gate and was
   * given no indication of that. `replan` and `trigger` shared one branch, which
   * made them indistinguishable despite meaning different things.
   *
   * Returns what it actually did, which is recorded on the delivery row so the
   * configured intent and the real outcome can be compared after the fact.
   */
  private async applyDeliveryMode(
    subscription: CycleSignalSubscription,
    event: EventPrimitive,
    runs: MissionRun[],
  ): Promise<string> {
    const [cycle] = await db.select().from(operationalCycles)
      .where(eq(operationalCycles.id, subscription.cycleId)).limit(1);

    // A finished cycle is not a valid target for any disturbance. Re-queueing or
    // pausing one would resurrect work an operator deliberately ended.
    if (!cycle || ["closed", "cancelled"].includes(cycle.status)) {
      return cycle ? `skipped:cycle_${cycle.status}` : "skipped:cycle_missing";
    }

    const activeRuns = runs.filter(run => run.status === "active");
    const requeue = async () => {
      for (const run of activeRuns) {
        await queueMissionCycle({ missionRunId: run.id, userId: run.createdBy, orgId: run.organizationId }, 0);
      }
      return `requeued:${activeRuns.length}`;
    };

    switch (subscription.deliveryMode) {
      case "context_only":
        // The projection above is the whole effect, by design.
        return "context_projected";

      case "notify":
        await this.notify(subscription, event, cycle.name,
          `Signal delivered to cycle "${cycle.name}"`, "info");
        return "notified";

      case "gate":
        // A gate stops the cycle so a human decides whether it should continue
        // in the changed environment. Only an active cycle can be gated; one
        // already paused or awaiting approval is stopped by definition.
        if (cycle.status !== "active") return `noop:cycle_${cycle.status}`;
        await db.update(operationalCycles)
          .set({ status: "paused", updatedAt: new Date() })
          .where(eq(operationalCycles.id, cycle.id));
        await this.notify(subscription, event, cycle.name,
          `Cycle "${cycle.name}" paused by a ${event.severity} ${event.eventType} signal`, "warn");
        return "gated:paused";

      case "replan":
        // Disturbs work already in flight: the agents re-read a mission context
        // that now carries the new world state.
        if (activeRuns.length === 0) return "noop:no_active_runs";
        return await requeue();

      case "trigger":
        // Starts work that is NOT running. Re-queueing active runs as well means
        // a cycle mid-flight still reacts, but the distinguishing case is the
        // idle one — which the previous shared branch could never handle.
        if (activeRuns.length > 0) return await requeue();
        if (cycle.status === "paused") {
          await db.update(operationalCycles)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(operationalCycles.id, cycle.id));
          await this.notify(subscription, event, cycle.name,
            `Cycle "${cycle.name}" resumed by a ${event.severity} ${event.eventType} signal`, "info");
          return "triggered:resumed";
        }
        // planning / pending_approval / reviewing all need a human to release
        // them. Announcing beats silently doing nothing.
        await this.notify(subscription, event, cycle.name,
          `Signal wants to start cycle "${cycle.name}", which is ${cycle.status} and needs approval`, "warn");
        return `triggered:blocked_${cycle.status}`;

      default:
        // An unrecognised mode must be loud. Silently treating it as
        // context_only is what let `gate` look configured while doing nothing.
        logger.warn(
          `Unknown deliveryMode "${subscription.deliveryMode}" on subscription ${subscription.id}; ` +
          `signal recorded but no effect applied`,
        );
        return `unknown_mode:${subscription.deliveryMode}`;
    }
  }

  private async notify(
    subscription: CycleSignalSubscription,
    event: EventPrimitive,
    cycleName: string,
    message: string,
    severity: "info" | "warn" | "error",
  ): Promise<void> {
    try {
      const { CycleManagerService } = await import("@domain/mission/core/cycle-manager.service.js");
      await CycleManagerService.notifyFleetEvent(
        event.organizationId,
        `Signal: ${event.eventType} (${event.severity})`,
        `${message}\nSubscription "${subscription.name}" · ${event.targetSector} · ${event.jurisdiction}`,
        severity,
      );
    } catch (error) {
      // Notification is an announcement, not the effect. Losing it must not
      // fail the delivery that already changed the cycle.
      logger.warn(
        `Fleet notification failed for cycle ${subscription.cycleId}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Enabled subscriptions for an org — backs the internal-source status view. */
  async listEnabledForOrg(orgId: number) {
    return await db
      .select()
      .from(cycleSignalSubscriptions)
      .where(and(eq(cycleSignalSubscriptions.organizationId, orgId), eq(cycleSignalSubscriptions.enabled, true)));
  }
}

export const cycleSignalSubscriptionService = new CycleSignalSubscriptionService();
