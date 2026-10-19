import { test, expect } from "@playwright/test";
import {
  closeSignalPool,
  createIsolatedCycle,
  createSignalFixtures,
  createSubscription,
  cycleStatus,
  setCycleStatus,
  setRunStatus,
  signalPool,
  type SignalFixtures,
} from "./helpers/signal-fixtures.js";
import { baseSignal, injectSignal } from "./helpers/signal-inject.js";
import {
  appliedEffect,
  blackboard,
  deliveriesForEvent,
  deliveryFor,
  eventRow,
  missionContext,
  outboxFor,
  worldState,
  worldStateVersion,
} from "./helpers/signal-assert.js";
import { ZONE_ROTTERDAM, pointInside } from "./helpers/signal-geo.js";

/**
 * Scenarios 1-7: a signal reaching a cycle, and what the cycle does about it.
 *
 * These run serially against a shared fixture set and deliberately mutate cycle
 * status — Scenario 4 drives active -> paused, Scenario 6 drives paused ->
 * active. Each scenario restores what it changed so the next one starts from the
 * state its table says it does.
 */

let fx: SignalFixtures;

test.beforeAll(async () => {
  fx = await createSignalFixtures();
});

test.afterAll(async () => {
  await closeSignalPool();
});

// ---------------------------------------------------------------------------
// SCENARIO 1 — Baseline projection
// ---------------------------------------------------------------------------

test.describe("Scenario 1 — a signal reaches a cycle's world model", () => {
  test("projects through the full spine and records what it did", async ({ request }) => {
    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_CTX,
      name: "S1 baseline",
      deliveryMode: "context_only",
      filters: {},
      stateProjection: { namespace: "external_environment", reducer: "latest" },
    });

    const versionBefore = await worldStateVersion(fx.cycleIds.CYC_CTX);
    const position = pointInside(ZONE_ROTTERDAM);

    const injected = await injectSignal(
      request,
      baseSignal({ ...position, subjectId: "VESSEL-ALPHA", rawText: "Berth congestion at ECT" }),
    );

    // --- the event primitive, with resolver-derived spatial columns ---
    const event = await eventRow(injected.event.id);
    expect(event).not.toBeNull();
    expect(event!.h3_index).toBeTruthy();
    expect(event!.spatial_source).toBe("telemetry");
    expect(event!.flags).toContain("operator_injected");

    // --- causal links and the state transition ---
    expect(injected.transition.status).toBe("accepted");
    expect(injected.transition.environmentVariables["signal.event_type"]).toBe("Port Congestion");
    expect(injected.transition.environmentVariables["signal.severity"]).toBe("High");

    // --- the durable outbox record, committed in the same transaction ---
    const outbox = await outboxFor(injected.event.id);
    const prediction = outbox.find((e) => e.type === "prediction");
    expect(prediction, "an assessment must be enqueued as a prediction").toBeDefined();
    expect(prediction!.payload.signalId).toBe(injected.event.id);

    // --- the delivery, and crucially what it APPLIED ---
    const delivery = await deliveryFor(subscriptionId, injected.event.id);
    expect(delivery).not.toBeNull();
    expect(delivery!.disposition).toBe("context_only");
    expect(
      delivery!.payload.appliedEffect,
      "appliedEffect is what separates a working subscription from an inert one",
    ).toBe("context_projected");

    // --- world state advanced by exactly one version ---
    const state = await worldState(fx.cycleIds.CYC_CTX);
    expect(state).not.toBeNull();
    expect(state!.version).toBe(versionBefore + 1);
    expect(state!.lastEventPrimitiveId).toBe(injected.event.id);

    const lastChange = state!.materialChanges.at(-1)!;
    expect(lastChange.eventId).toBe(injected.event.id);
    expect(lastChange.severity).toBe("High");
    expect(lastChange.summary).toContain("Berth congestion");

    // --- and it reached the places an agent actually reads ---
    const runId = fx.runIds.CYC_CTX![0];
    const context = await missionContext(runId);
    expect(context.worldState.external_environment.version).toBe(state!.version);
    expect(context.triggerEvent.eventId).toBe(injected.event.id);

    const board = await blackboard(fx.missionId);
    expect(board.last_signal.eventId).toBe(injected.event.id);
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 2 — Subscription filter matrix
// ---------------------------------------------------------------------------

test.describe("Scenario 2 — subscription filters, positive and negative", () => {
  /**
   * Exact counts, never "at least one". An over-permissive filter is as much a
   * bug as an over-strict one, and only an exact count catches the first.
   */
  test("each filter admits exactly what it should", async ({ request }) => {
    const cycleId = fx.cycleIds.CYC_CTX;

    const subs = {
      control: await createSubscription(request, {
        cycleId,
        name: "S2 control",
        deliveryMode: "context_only",
        filters: {},
      }),
      eventTypes: await createSubscription(request, {
        cycleId,
        name: "S2 eventTypes",
        deliveryMode: "context_only",
        filters: { eventTypes: ["Sanctions"] },
      }),
      sectors: await createSubscription(request, {
        cycleId,
        name: "S2 sectors",
        deliveryMode: "context_only",
        filters: { sectors: ["Financial"] },
      }),
      jurisdictions: await createSubscription(request, {
        cycleId,
        name: "S2 jurisdictions",
        deliveryMode: "context_only",
        filters: { jurisdictions: ["IRN"] },
      }),
      minConfidence: await createSubscription(request, {
        cycleId,
        name: "S2 minConfidence",
        deliveryMode: "context_only",
        filters: { minimumConfidence: 0.8 },
      }),
      minSeverity: await createSubscription(request, {
        cycleId,
        name: "S2 minSeverity",
        deliveryMode: "context_only",
        filters: { minimumSeverity: "High" },
      }),
    };

    /** Asserts precisely which of the six subscriptions received a signal. */
    const expectDelivered = async (eventId: string, expected: Array<keyof typeof subs>) => {
      for (const [key, id] of Object.entries(subs) as Array<
        [keyof typeof subs, number]
      >) {
        const got = await deliveryFor(id, eventId);
        const shouldHave = expected.includes(key);
        expect(
          got !== null,
          `subscription "${key}" ${shouldHave ? "should" : "should NOT"} have received ${eventId}`,
        ).toBe(shouldHave);
      }
    };

    // 2a — Sanctions/Financial matches the type and sector filters.
    const a = await injectSignal(
      request,
      baseSignal({ eventType: "Sanctions", targetSector: "Financial", severity: "High" }),
    );
    await expectDelivered(a.event.id, ["control", "eventTypes", "sectors", "minConfidence", "minSeverity"]);

    // 2b — same type, different sector: the sector filter must reject it.
    const b = await injectSignal(
      request,
      baseSignal({ eventType: "Sanctions", targetSector: "Logistics", severity: "High" }),
    );
    await expectDelivered(b.event.id, ["control", "eventTypes", "minConfidence", "minSeverity"]);

    // 2c — jurisdiction.
    const c = await injectSignal(
      request,
      baseSignal({ jurisdiction: "IRN", severity: "High" }),
    );
    await expectDelivered(c.event.id, ["control", "jurisdictions", "minConfidence", "minSeverity"]);

    // 2d — confidence below the floor.
    const d = await injectSignal(request, baseSignal({ confidenceScore: 0.55, severity: "High" }));
    await expectDelivered(d.event.id, ["control", "minSeverity"]);

    // 2e — severity below the floor. Ordinal, not lexical: "Medium" < "High".
    const e = await injectSignal(request, baseSignal({ severity: "Medium" }));
    await expectDelivered(e.event.id, ["control", "minConfidence"]);

    // 2f — severity above the floor.
    const f = await injectSignal(request, baseSignal({ severity: "Critical" }));
    await expectDelivered(f.event.id, ["control", "minConfidence", "minSeverity"]);
  });

  /**
   * entityIds is the only filter that matches against the CAUSAL LINKS rather
   * than the event, so it is the one most likely to be wired to the wrong side.
   */
  test("entityIds filters on causal links, not on the event", async ({ request }) => {
    const cycleId = fx.cycleIds.CYC_CTX;

    // The seeded Logistics/NLD supplier is what a baseline signal maps onto.
    // Note this is a graph_nodes.ref_id (a uuid), not a cycle id — that is what
    // `targetEntityId` on a causal link actually carries.
    const linked = await createSubscription(request, {
      cycleId,
      name: "S2 entityIds match",
      deliveryMode: "context_only",
      filters: { entityIds: [fx.graph.primaryEntityId] },
    });
    // The Financial/IRN supplier exists but is NOT linked by a Logistics/NLD
    // signal, so this proves the filter reads the links rather than merely
    // checking the id is known.
    const unlinked = await createSubscription(request, {
      cycleId,
      name: "S2 entityIds miss",
      deliveryMode: "context_only",
      filters: { entityIds: [fx.graph.secondaryEntityId] },
    });

    const injected = await injectSignal(request, baseSignal());

    expect(
      injected.links.map((l) => l.targetEntityId),
      "the seeded supplier must be linked, or this scenario proves nothing",
    ).toContain(fx.graph.primaryEntityId);

    expect(await deliveryFor(linked, injected.event.id)).not.toBeNull();
    expect(
      await deliveryFor(unlinked, injected.event.id),
      "a filter naming an entity with no link to this signal must not match",
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 3 — Cooldown and idempotency
// ---------------------------------------------------------------------------

test.describe("Scenario 3 — cooldown suppression and delivery idempotency", () => {
  test("throttles inside the cooldown window and delivers once outside it", async ({ request }) => {
    // An isolated cycle, because this test asserts an exact world-state version
    // delta. On a shared cycle the version advances once per MATCHING
    // subscription, so an unfiltered subscription belonging to another scenario
    // would move it while this one is correctly throttled — and the assertion
    // would report a cooldown failure that never happened.
    const { cycleId } = await createIsolatedCycle("S3 cooldown");

    const subscriptionId = await createSubscription(request, {
      cycleId,
      name: "S3 cooldown",
      deliveryMode: "context_only",
      filters: { eventTypes: ["Cooldown Probe"] },
      cooldownMinutes: 15,
    });

    const first = await injectSignal(request, baseSignal({ eventType: "Cooldown Probe" }));
    expect(await deliveryFor(subscriptionId, first.event.id)).not.toBeNull();

    const versionAfterFirst = await worldStateVersion(cycleId);
    expect(versionAfterFirst).toBe(1);

    // Inside the window: no delivery, and — the part that matters — no
    // projection either. A cooldown that recorded nothing but still bumped the
    // world state would be no cooldown at all.
    const second = await injectSignal(request, baseSignal({ eventType: "Cooldown Probe" }));
    expect(await deliveryFor(subscriptionId, second.event.id)).toBeNull();
    expect(await worldStateVersion(cycleId)).toBe(versionAfterFirst);

    const patch = await request.patch(`/api/cycle-signal-subscriptions/${subscriptionId}`, {
      data: { cooldownMinutes: 0 },
    });
    expect(patch.ok()).toBeTruthy();

    const third = await injectSignal(request, baseSignal({ eventType: "Cooldown Probe" }));
    expect(await deliveryFor(subscriptionId, third.event.id)).not.toBeNull();
    expect(await worldStateVersion(cycleId)).toBe(versionAfterFirst + 1);
  });

  /**
   * The guarantee the whole dual-path design rests on.
   *
   * The in-process call and the Kafka consumer both reach delivery, deliberately
   * — the first is immediate but dies with its instance, the second survives.
   * Running both is only safe because every side effect sits behind an insert
   * that is unique per (subscription, event primitive).
   */
  test("a second delivery of the same signal applies nothing twice", async ({ request }) => {
    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_CTX,
      name: "S3 idempotency",
      deliveryMode: "context_only",
      filters: { eventTypes: ["Idempotency Probe"] },
    });

    const injected = await injectSignal(request, baseSignal({ eventType: "Idempotency Probe" }));
    const versionAfterFirst = await worldStateVersion(fx.cycleIds.CYC_CTX);
    expect(await deliveryFor(subscriptionId, injected.event.id)).not.toBeNull();

    // Re-drive the same assessment the way the consumer would. The unique index
    // must make it a complete no-op.
    const { rows } = await signalPool().query(
      `SELECT count(*)::int AS c FROM cycle_signal_deliveries WHERE event_primitive_id = $1`,
      [injected.event.id],
    );
    const deliveriesFirstPass = rows[0].c;

    await injectSignalAgainByCorrelation(injected.event.id);

    const after = await deliveriesForEvent(injected.event.id);
    expect(after).toHaveLength(deliveriesFirstPass);
    expect(await worldStateVersion(fx.cycleIds.CYC_CTX)).toBe(versionAfterFirst);
  });
});

/**
 * Re-runs delivery for an already-assessed signal, as the Kafka consumer does.
 *
 * There is no HTTP surface for this — the consumer reaches
 * `deliverByCorrelation` directly — so the spec drives the same entry point
 * through a short-lived connection rather than inventing a test-only route on
 * the production server.
 */
async function injectSignalAgainByCorrelation(eventId: string): Promise<void> {
  const { rows } = await signalPool().query(
    `SELECT organization_id FROM event_primitives WHERE id = $1`,
    [eventId],
  );
  const orgId = rows[0].organization_id;
  const { cycleSignalSubscriptionService } = await import(
    "../../server/domain/signal-intelligence/core/cycle-signal-subscription.service.js"
  );
  await cycleSignalSubscriptionService.deliverByCorrelation(orgId, eventId);
}

// ---------------------------------------------------------------------------
// SCENARIO 4 — gate
// ---------------------------------------------------------------------------

test.describe("Scenario 4 — gate pauses a running cycle", () => {
  test.afterAll(async () => {
    await setCycleStatus(fx.cycleIds.CYC_GATE, "active");
  });

  test("rejects below the filter, pauses above it, and no-ops once paused", async ({ request }) => {
    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_GATE,
      name: "S4 gate",
      deliveryMode: "gate",
      filters: { minimumSeverity: "Critical", eventTypes: ["Gate Probe"] },
    });

    // Below the severity floor — the cycle must be untouched.
    const low = await injectSignal(
      request,
      baseSignal({ eventType: "Gate Probe", severity: "High" }),
    );
    expect(await deliveryFor(subscriptionId, low.event.id)).toBeNull();
    expect(await cycleStatus(fx.cycleIds.CYC_GATE)).toBe("active");

    // At the floor — the gate closes.
    const critical = await injectSignal(
      request,
      baseSignal({ eventType: "Gate Probe", severity: "Critical" }),
    );
    expect(await appliedEffect(subscriptionId, critical.event.id)).toBe("gated:paused");
    expect(
      await cycleStatus(fx.cycleIds.CYC_GATE),
      "an operator who configured a gate must actually get one",
    ).toBe("paused");

    // Already paused — the signal still projects, but there is nothing left to
    // gate, and the effect must say so rather than claim a second pause.
    const again = await injectSignal(
      request,
      baseSignal({ eventType: "Gate Probe", severity: "Critical" }),
    );
    expect(await appliedEffect(subscriptionId, again.event.id)).toBe("noop:cycle_paused");
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 5 — replan
// ---------------------------------------------------------------------------

test.describe("Scenario 5 — replan re-queues in-flight work", () => {
  test("re-queues only active runs, and tells them why", async ({ request }) => {
    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_REPLAN,
      name: "S5 replan",
      deliveryMode: "replan",
      filters: { eventTypes: ["Replan Probe"] },
    });

    const injected = await injectSignal(request, baseSignal({ eventType: "Replan Probe" }));

    // Two active runs and one completed. "requeued:2" is the whole assertion —
    // "requeued:3" would mean completed work was resurrected.
    expect(await appliedEffect(subscriptionId, injected.event.id)).toBe("requeued:2");

    for (const runId of fx.runIds.CYC_REPLAN!) {
      const context = await missionContext(runId);
      expect(context.triggerEvent.eventId).toBe(injected.event.id);
      expect(context.worldState.external_environment).toBeDefined();
    }

    // The completed run must not have been touched at all.
    const completed = await missionContext(fx.completedRunId);
    expect(completed.triggerEvent).toBeUndefined();
  });

  test("reports no-op when nothing is running", async ({ request }) => {
    const runIds = fx.runIds.CYC_REPLAN!;
    for (const id of runIds) await setRunStatus(id, "paused");

    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_REPLAN,
      name: "S5 replan idle",
      deliveryMode: "replan",
      filters: { eventTypes: ["Replan Idle Probe"] },
    });

    const versionBefore = await worldStateVersion(fx.cycleIds.CYC_REPLAN);
    const injected = await injectSignal(request, baseSignal({ eventType: "Replan Idle Probe" }));

    expect(await appliedEffect(subscriptionId, injected.event.id)).toBe("noop:no_active_runs");
    // The projection is unconditional: a cycle with nothing running still has to
    // learn about the world.
    expect(await worldStateVersion(fx.cycleIds.CYC_REPLAN)).toBe(versionBefore + 1);

    for (const id of runIds) await setRunStatus(id, "active");
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 6 — trigger
// ---------------------------------------------------------------------------

test.describe("Scenario 6 — trigger starts work that is not running", () => {
  test.afterAll(async () => {
    await setCycleStatus(fx.cycleIds.CYC_TRIGGER, "paused");
  });

  test("resumes a paused cycle", async ({ request }) => {
    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_TRIGGER,
      name: "S6 trigger resume",
      deliveryMode: "trigger",
      filters: { eventTypes: ["Trigger Probe"] },
    });

    expect(await cycleStatus(fx.cycleIds.CYC_TRIGGER)).toBe("paused");

    const injected = await injectSignal(request, baseSignal({ eventType: "Trigger Probe" }));

    expect(await appliedEffect(subscriptionId, injected.event.id)).toBe("triggered:resumed");
    expect(await cycleStatus(fx.cycleIds.CYC_TRIGGER)).toBe("active");
  });

  test("re-queues instead when work is already in flight", async ({ request }) => {
    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_REPLAN,
      name: "S6 trigger active",
      deliveryMode: "trigger",
      filters: { eventTypes: ["Trigger Active Probe"] },
    });

    const injected = await injectSignal(request, baseSignal({ eventType: "Trigger Active Probe" }));
    expect(await appliedEffect(subscriptionId, injected.event.id)).toBe("requeued:2");
  });

  test("announces rather than silently doing nothing when a human must release the cycle", async ({
    request,
  }) => {
    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_BLOCKED,
      name: "S6 trigger blocked",
      deliveryMode: "trigger",
      filters: { eventTypes: ["Trigger Blocked Probe"] },
    });

    const injected = await injectSignal(request, baseSignal({ eventType: "Trigger Blocked Probe" }));

    expect(await appliedEffect(subscriptionId, injected.event.id)).toBe(
      "triggered:blocked_pending_approval",
    );
    expect(
      await cycleStatus(fx.cycleIds.CYC_BLOCKED),
      "a cycle awaiting approval must not be started by a signal",
    ).toBe("pending_approval");
  });
});

// ---------------------------------------------------------------------------
// SCENARIO 7 — guards
// ---------------------------------------------------------------------------

test.describe("Scenario 7 — terminal-cycle guard, notify, and unknown-mode loudness", () => {
  test("skips a closed cycle without resurrecting it", async ({ request }) => {
    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_CLOSED,
      name: "S7 closed",
      deliveryMode: "trigger",
      filters: { eventTypes: ["Closed Probe"] },
    });

    const injected = await injectSignal(request, baseSignal({ eventType: "Closed Probe" }));

    expect(await appliedEffect(subscriptionId, injected.event.id)).toBe("skipped:cycle_closed");
    expect(await cycleStatus(fx.cycleIds.CYC_CLOSED)).toBe("closed");
  });

  test("skips a cancelled cycle the same way", async ({ request }) => {
    await setCycleStatus(fx.cycleIds.CYC_CLOSED, "cancelled");

    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_CLOSED,
      name: "S7 cancelled",
      deliveryMode: "gate",
      filters: { eventTypes: ["Cancelled Probe"] },
    });

    const injected = await injectSignal(request, baseSignal({ eventType: "Cancelled Probe" }));
    expect(await appliedEffect(subscriptionId, injected.event.id)).toBe("skipped:cycle_cancelled");

    await setCycleStatus(fx.cycleIds.CYC_CLOSED, "closed");
  });

  test("notify announces without disturbing the cycle", async ({ request }) => {
    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_CTX,
      name: "S7 notify",
      deliveryMode: "notify",
      filters: { eventTypes: ["Notify Probe"] },
    });

    const injected = await injectSignal(request, baseSignal({ eventType: "Notify Probe" }));

    expect(await appliedEffect(subscriptionId, injected.event.id)).toBe("notified");
    expect(await cycleStatus(fx.cycleIds.CYC_CTX)).toBe("active");
  });

  /**
   * An unknown delivery mode cannot reach the engine at all.
   *
   * The plan for this scenario assumed the `default:` branch of
   * `applyDeliveryMode` — which logs a warning and returns `unknown_mode:<x>` —
   * was reachable by writing a drifted value straight into the table. It is not:
   * a CHECK constraint on `delivery_mode` rejects the write, so the mode is
   * guarded twice, at the API and in the schema.
   *
   * That makes the `default:` branch defence in depth rather than dead code, and
   * these two tests assert the guards that actually hold. Asserting on
   * `unknown_mode:` instead would require dropping the constraint, which would
   * be a test manufacturing the very condition the schema exists to prevent.
   */
  test("the database refuses a drifted delivery mode", async ({ request }) => {
    const subscriptionId = await createSubscription(request, {
      cycleId: fx.cycleIds.CYC_CTX,
      name: "S7 drift probe",
      deliveryMode: "context_only",
      filters: { eventTypes: ["Unknown Mode Probe"] },
    });

    await expect(
      signalPool().query(
        `UPDATE cycle_signal_subscriptions SET delivery_mode = 'escalate' WHERE id = $1`,
        [subscriptionId],
      ),
      "delivery_mode must be constrained in the schema, not only in the route",
    ).rejects.toThrow(/cycle_signal_subscriptions_delivery_mode_check/);

    // And the row is unchanged, so the subscription still behaves.
    const injected = await injectSignal(request, baseSignal({ eventType: "Unknown Mode Probe" }));
    expect(await appliedEffect(subscriptionId, injected.event.id)).toBe("context_projected");
  });

  test("the API refuses an unknown delivery mode at the door", async ({ request }) => {
    const res = await request.post("/api/cycle-signal-subscriptions", {
      data: { cycleId: fx.cycleIds.CYC_CTX, name: "S7 rejected", deliveryMode: "escalate" },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain("Invalid deliveryMode");
  });
});
