import { test, expect } from "@playwright/test";
import {
  closeSignalPool,
  createIsolatedCycle,
  createSignalFixtures,
  createSubscription,
  cycleStatus,
  signalPool,
  type SignalFixtures,
} from "./helpers/signal-fixtures.js";
import { baseSignal, injectSignal } from "./helpers/signal-inject.js";
import {
  actionLogsForEvent,
  blackboard,
  deliveryFor,
  missionContext,
  outboxFor,
  outcomeEnvelope,
  surpriseEnvelope,
  artifactsForEvent,
} from "./helpers/signal-assert.js";

/**
 * Scenario 11: the world model reacting to a prediction that turned out wrong.
 *
 * The loop has two halves and they are in very different states, so this spec
 * tests them separately and says which is which.
 *
 * PRODUCER (autonomy -> action -> outcome observation): now reachable. Before
 * the change made alongside this suite, `autonomousActionService.evaluateEvent`
 * had no callers at all — policies could be authored but were never matched
 * against a signal, and `logExecution`, the in-process producer of the outcome
 * observation, was therefore unreachable too.
 *
 * CONSUMER (surprise -> escalation -> replan): fully working, and verified here
 * against the real database.
 *
 * What sits between them is documented in "the producer cannot currently raise
 * a surprise" below — a real gap this suite pins rather than papers over.
 */

let fx: SignalFixtures;

test.beforeAll(async () => {
  fx = await createSignalFixtures();
});

test.afterAll(async () => {
  await closeSignalPool();
});

/** Creates an auto-approving policy through the real API. */
async function createPolicy(
  request: any,
  name: string,
  actionType: string,
  triggerCondition: Record<string, unknown>,
) {
  const res = await request.post("/api/autonomous-actions/policies", {
    data: { name, actionType, approvalGate: "auto_approve", triggerCondition, enabled: true },
  });
  if (res.status() !== 201) {
    throw new Error(`Policy create failed (${res.status()}): ${await res.text()}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// PRODUCER — autonomy now runs on ingest
// ---------------------------------------------------------------------------

test.describe("Scenario 11a — autonomy policies are evaluated on ingest", () => {
  test("a qualifying signal matches a policy, executes, and logs", async ({ request }) => {
    const policy = await createPolicy(request, "S11 spawn on critical logistics", "spawn_cycle", {
      minSeverity: "Critical",
      sectorFilter: ["Logistics"],
    });

    const injected = await injectSignal(
      request,
      baseSignal({
        eventType: "S11 Autonomy Probe",
        severity: "Critical",
        confidenceScore: 0.95,
      }),
    );

    const logs = await actionLogsForEvent(injected.event.id);
    expect(
      logs,
      "evaluateEvent must run on ingest — without the wiring this array is always empty",
    ).toHaveLength(1);
    expect(logs[0].policy_id).toBe(policy.id);
    expect(logs[0].action_type).toBe("spawn_cycle");
    expect(logs[0].approval_status).toBe("auto_approved");
    expect(["success", "failure"]).toContain(logs[0].outcome);

    // The action request and its outcome observation share the signal's
    // correlation with the original prediction, so one id reaches the whole
    // episode.
    const envelopes = await outboxFor(injected.event.id);
    const types = envelopes.map((e) => e.type);
    expect(types, "the world model's assessment").toContain("prediction");
    // The action envelope's discriminator is `intent`, not `request` — the pair
    // (eventType, type) is what the registry keys on for merged streams.
    expect(types, "the action that assessment drove").toContain("intent");
    expect(types, "and the outcome that closes the loop").toContain("observation");
  });

  test("a signal below the autonomy gate is ignored entirely", async ({ request }) => {
    await createPolicy(request, "S11 gate probe", "create_rfc", { minSeverity: "Low" });

    // The gate is Critical/High AND confidence >= 0.8. This clears the severity
    // half but not the confidence half.
    const lowConfidence = await injectSignal(
      request,
      baseSignal({ eventType: "S11 Gate Probe", severity: "Critical", confidenceScore: 0.5 }),
    );
    expect(await actionLogsForEvent(lowConfidence.event.id)).toHaveLength(0);

    const lowSeverity = await injectSignal(
      request,
      baseSignal({ eventType: "S11 Gate Probe", severity: "Medium", confidenceScore: 0.99 }),
    );
    expect(await actionLogsForEvent(lowSeverity.event.id)).toHaveLength(0);
  });

  test("a human-gated policy creates an approval request instead of executing", async ({
    request,
  }) => {
    const res = await request.post("/api/autonomous-actions/policies", {
      data: {
        name: "S11 human gated",
        actionType: "create_rfc",
        approvalGate: "require_human_approval",
        triggerCondition: { minSeverity: "Critical", sectorFilter: ["Defense"] },
        enabled: true,
      },
    });
    expect(res.status()).toBe(201);

    const injected = await injectSignal(
      request,
      baseSignal({
        eventType: "S11 Approval Probe",
        targetSector: "Defense",
        severity: "Critical",
        confidenceScore: 0.95,
      }),
    );

    const logs = await actionLogsForEvent(injected.event.id);
    const pending = logs.filter((l) => l.approval_status === "pending");
    expect(pending, "a gated policy must queue for a human, not execute").toHaveLength(1);
    expect(pending[0].outcome).toBeNull();

    // And that row is now reachable by the approve route, which previously
    // operated on rows nothing produced.
    const approve = await request.post(`/api/autonomous-actions/approve/${pending[0].id}`);
    expect(approve.ok()).toBeTruthy();
    expect((await approve.json()).approval_status ?? (await approve.json()).approvalStatus).toBe(
      "approved",
    );
  });
});

// ---------------------------------------------------------------------------
// 11b — a successful action is still not a surprise
// ---------------------------------------------------------------------------

/**
 * The complement of 11d.
 *
 * This block previously documented a GAP: neither surprise dimension could
 * diverge, because every action reported success and the outcome envelope
 * carried no metrics. Both are now fixed (see 11d), so what is left to verify
 * is the other half of the contract — that a genuinely successful action whose
 * measured effect matches the prediction raises NOTHING.
 *
 * A loop that fires on every outcome is as useless as one that never fires:
 * emitting a surprise per action would drown the signal it exists to raise.
 */
test.describe("Scenario 11b — a successful, on-prediction action stays quiet", () => {
  test("a successful action raises no surprise", async ({ request }) => {
    const { cycleId } = await createIsolatedCycle("S11 no surprise");
    const subscriptionId = await createSubscription(request, {
      cycleId,
      name: "S11 no surprise",
      deliveryMode: "context_only",
      filters: { eventTypes: ["S11 No Surprise Probe"] },
    });

    // spawn_cycle, because it is the one action type with a registered handler
    // and therefore the only one that can genuinely succeed.
    await createPolicy(request, "S11 succeeding policy", "spawn_cycle", {
      minSeverity: "Critical",
      sectorFilter: ["Logistics"],
    });

    const injected = await injectSignal(
      request,
      baseSignal({
        eventType: "S11 No Surprise Probe",
        severity: "Critical",
        confidenceScore: 0.95,
      }),
    );

    const logs = await actionLogsForEvent(injected.event.id);
    const executed = logs.filter((l) => l.approval_status === "auto_approved");
    expect(executed.length).toBeGreaterThanOrEqual(1);

    // The contract under test: a surprise exists exactly when the observed
    // outcome differs from the predicted one. Still written as an equivalence,
    // so it reports the right thing whichever way the action goes.
    const anyFailed = executed.some((l) => l.outcome === "failure");
    const delivery = await deliveryFor(subscriptionId, injected.event.id);
    expect(delivery).not.toBeNull();
    expect(
      Boolean(delivery!.payload.surpriseAppliedAt),
      anyFailed
        ? "an action reported failure, so a surprise must have been raised"
        : "the action succeeded on prediction, so there is nothing to report",
    ).toBe(anyFailed);
  });
});

// ---------------------------------------------------------------------------
// CONSUMER — what a surprise does once one exists
// ---------------------------------------------------------------------------

/**
 * Drives `deliverSurprise` directly, which is the exact seam
 * `spatialSurpriseService.evaluateOutcome` calls once it has decided a
 * prediction was wrong. Since the producer cannot currently reach that decision
 * (above), this is the only honest way to verify the reaction — and the
 * reaction is the thing that matters: a surprise nothing acts on is just a row.
 */
test.describe("Scenario 11c — a surprise disturbs the cycle it belongs to", () => {
  /**
   * Below the autonomy gate on purpose (confidence < 0.8).
   *
   * These tests drive `deliverSurprise` by hand to isolate the consumer half.
   * Now that the producer half works, a qualifying signal would raise its own
   * surprise on ingest and stamp the delivery first — so the manual call would
   * correctly return 0 and the test would fail for a reason that has nothing to
   * do with what it is checking. Keeping the signal unqualifying makes this
   * block a test of the reaction alone.
   */
  const CONSUMER_ONLY = { confidenceScore: 0.7 as const };

  const surprise = {
    predictionEventId: "prediction-under-test",
    observationEventId: "observation-under-test",
    dimension: "outcome",
    predicted: "succeeded",
    observed: "failed",
    error: 1,
    threshold: 0.25,
    summary: "Expected the action to have succeeded; it failed.",
  };

  async function deliverSurprise(orgId: number, correlationId: string) {
    const { cycleSignalSubscriptionService } = await import(
      "../../server/domain/signal-intelligence/core/cycle-signal-subscription.service.js"
    );
    return cycleSignalSubscriptionService.deliverSurprise({
      organizationId: orgId,
      correlationId,
      surprise,
    });
  }

  test("escalates a context_only subscription to a replan and says why", async ({ request }) => {
    const { cycleId, runId, missionId } = await createIsolatedCycle("S11 surprise replan");
    const subscriptionId = await createSubscription(request, {
      cycleId,
      name: "S11 surprise replan",
      // context_only on purpose: the escalation floor is what has to lift this
      // to a replan. A subscription that already asked for one proves nothing.
      deliveryMode: "context_only",
      filters: { eventTypes: ["S11 Surprise Probe"] },
    });

    const injected = await injectSignal(
      request,
      baseSignal({ eventType: "S11 Surprise Probe", severity: "High", ...CONSUMER_ONLY }),
    );
    expect(await deliveryFor(subscriptionId, injected.event.id)).not.toBeNull();

    const delivered = await deliverSurprise(fx.orgId, injected.event.id);
    expect(delivered).toBeGreaterThanOrEqual(1);

    const delivery = await deliveryFor(subscriptionId, injected.event.id);
    expect(delivery!.payload.surpriseMode, "SURPRISE_FLOOR lifts context_only to replan").toBe(
      "replan",
    );
    expect(delivery!.payload.surpriseEffect).toBe("requeued:1");
    expect(delivery!.payload.surpriseAppliedAt).toBeTruthy();

    // Re-queueing a mission whose context does not mention the prediction error
    // just repeats the work that produced it.
    const context = await missionContext(runId);
    expect(context.lastSurprise).toMatchObject({ observed: "failed", dimension: "outcome" });
    expect(context.lastSurprise.receivedAt).toBeTruthy();

    const board = await blackboard(missionId);
    expect(board.last_surprise).toMatchObject({ predicted: "succeeded", observed: "failed" });
  });

  test("is idempotent — replaying the same surprise does not replan twice", async ({ request }) => {
    const { cycleId } = await createIsolatedCycle("S11 surprise idempotent");
    const subscriptionId = await createSubscription(request, {
      cycleId,
      name: "S11 surprise idempotent",
      deliveryMode: "context_only",
      filters: { eventTypes: ["S11 Idempotent Probe"] },
    });

    const injected = await injectSignal(
      request,
      baseSignal({ eventType: "S11 Idempotent Probe", severity: "High", ...CONSUMER_ONLY }),
    );

    expect(await deliverSurprise(fx.orgId, injected.event.id)).toBeGreaterThanOrEqual(1);
    const first = await deliveryFor(subscriptionId, injected.event.id);
    const stamp = first!.payload.surpriseAppliedAt;

    // Evaluation runs from both the Kafka consumer and the in-process path, so
    // the stamp is what stops one divergence disturbing a cycle repeatedly.
    expect(await deliverSurprise(fx.orgId, injected.event.id)).toBe(0);

    const second = await deliveryFor(subscriptionId, injected.event.id);
    expect(second!.payload.surpriseAppliedAt).toBe(stamp);
  });

  test("the floor is a floor, not an override — a gate stays a gate", async ({ request }) => {
    const { cycleId } = await createIsolatedCycle("S11 surprise gate");
    const subscriptionId = await createSubscription(request, {
      cycleId,
      name: "S11 surprise gate",
      deliveryMode: "gate",
      filters: { eventTypes: ["S11 Gate Surprise Probe"] },
    });

    const injected = await injectSignal(
      request,
      baseSignal({ eventType: "S11 Gate Surprise Probe", severity: "High", ...CONSUMER_ONLY }),
    );

    // The routine delivery already gated the cycle, so the surprise arrives at
    // a paused one. What matters here is the MODE, not the effect: pausing is a
    // stronger response than re-queueing, so it must not be downgraded.
    await deliverSurprise(fx.orgId, injected.event.id);

    const delivery = await deliveryFor(subscriptionId, injected.event.id);
    expect(delivery!.payload.surpriseMode).toBe("gate");
    expect(await cycleStatus(cycleId)).toBe("paused");
  });

  test("ignores a correlation that matches no signal", async () => {
    expect(
      await deliverSurprise(fx.orgId, "00000000-0000-0000-0000-000000000000"),
    ).toBe(0);
  });

  test("does not reach across organisations", async ({ request }) => {
    const { cycleId } = await createIsolatedCycle("S11 tenant isolation");
    await createSubscription(request, {
      cycleId,
      name: "S11 tenant isolation",
      deliveryMode: "context_only",
      filters: { eventTypes: ["S11 Tenant Probe"] },
    });

    const injected = await injectSignal(
      request,
      baseSignal({ eventType: "S11 Tenant Probe", severity: "High", ...CONSUMER_ONLY }),
    );

    const { rows } = await signalPool().query(
      `SELECT COALESCE(MAX(org_id), 0) + 1000 AS unused FROM orgs`,
    );
    expect(
      await deliverSurprise(rows[0].unused, injected.event.id),
      "a surprise addressed to another organisation must resolve nothing",
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11d — the loop can now fire, because handlers report what they did
// ---------------------------------------------------------------------------

/**
 * The gap recorded in 11b is closed.
 *
 * `executeAction` used to treat "publish() resolved" as success, and publish()
 * always resolves — the bus catches every handler error, and an event type with
 * no registered handler publishes just as cleanly as one with a working
 * consumer. So the outcome observation reported that an event had been EMITTED,
 * not that anything had been DONE, and no prediction could be observed wrong.
 *
 * Handlers now return a verdict and their measurements, and `dispatch` turns
 * "nobody did this" into a failed action. Both surprise dimensions are live.
 */
test.describe("Scenario 11d — prediction error is reachable end to end", () => {
  /**
   * All four action types now have a registered handler (see 11e), so under a
   * healthy configuration none of them fails — which is the desired end state,
   * not a gap. What has to stay true is the EQUIVALENCE: an outcome surprise is
   * raised exactly when an action reports failure.
   *
   * Written this way rather than as a fixed verdict because the previous
   * version of these tests asserted failure by relying on create_rfc and
   * modify_spatial_routing having no consumer at all. Implementing those
   * handlers correctly broke them — an assertion that depends on a feature
   * being missing is an assertion that fights its own codebase.
   */
  test("every action type now completes, and none reports a phantom failure", async ({
    request,
  }) => {
    const policy = await createPolicy(request, "S11d all types", "create_rfc", {
      minSeverity: "Critical",
      sectorFilter: ["Defense"],
    });

    const injected = await injectSignal(
      request,
      baseSignal({
        eventType: "S11d Completion Probe",
        targetSector: "Defense",
        severity: "Critical",
        confidenceScore: 0.95,
      }),
    );

    const executed = (await actionLogsForEvent(injected.event.id)).filter(
      (l) => l.approval_status === "auto_approved" && l.policy_id === policy.id,
    );
    expect(executed).toHaveLength(1);
    expect(
      executed[0].outcome,
      "create_rfc has a consumer now; it must not report the no-handler failure",
    ).toBe("success");
    expect(executed[0].failure_reason).toBeNull();
  });

  test("an outcome surprise is raised exactly when an action fails", async ({ request }) => {
    const { cycleId, runId } = await createIsolatedCycle("S11d outcome surprise");
    const subscriptionId = await createSubscription(request, {
      cycleId,
      name: "S11d outcome surprise",
      // context_only, so the escalation floor is what would lift this to a
      // replan if a surprise were raised.
      deliveryMode: "context_only",
      filters: { eventTypes: ["S11d Outcome Probe"] },
    });

    const policy = await createPolicy(request, "S11d outcome policy", "modify_spatial_routing", {
      minSeverity: "Critical",
      sectorFilter: ["Logistics"],
    });

    const injected = await injectSignal(
      request,
      baseSignal({
        eventType: "S11d Outcome Probe",
        severity: "Critical",
        confidenceScore: 0.95,
      }),
    );

    const executed = (await actionLogsForEvent(injected.event.id)).filter(
      (l) => l.policy_id === policy.id,
    );
    const failed = executed.some((l) => l.outcome === "failure");
    const surprise = await surpriseEnvelope(injected.event.id, policy.id);

    if (failed) {
      expect(surprise, "a failed action is a wrong prediction").not.toBeNull();
      expect(surprise.dimension).toBe("outcome");
      expect(surprise.predicted).toBe("succeeded");
      expect(surprise.observed).toBe("failed");

      // And it reaches the cycle, escalated by SURPRISE_FLOOR.
      const delivery = await deliveryFor(subscriptionId, injected.event.id);
      expect(delivery!.payload.surpriseMode).toBe("replan");
      const context = await missionContext(runId);
      expect(context.lastSurprise).toMatchObject({ dimension: "outcome" });
    } else {
      expect(
        surprise,
        "the action succeeded, so there is no outcome error to report",
      ).toBeNull();
    }
  });

  test("a successful action reports the blast radius it actually scoped", async ({ request }) => {
    const policy = await createPolicy(request, "S11d spawn", "spawn_cycle", {
      minSeverity: "Critical",
      sectorFilter: ["Logistics"],
    });

    const injected = await injectSignal(
      request,
      baseSignal({
        eventType: "S11d Blast Probe",
        severity: "Critical",
        confidenceScore: 0.95,
      }),
    );

    const observation = await outcomeEnvelope(injected.event.id, policy.id);
    expect(observation).not.toBeNull();
    expect(observation.outcome).toBe("succeeded");
    expect(
      observation.metrics,
      "the outcome envelope carried no metrics at all before, which is why the " +
        "magnitude half of computeSurprise was unreachable",
    ).toBeDefined();
    expect(typeof observation.metrics.blastRadius).toBe("number");

    // The handler scoped the cycle to the entities the causal graph linked, so
    // observation and prediction agree and no magnitude surprise is raised.
    expect(observation.metrics.blastRadius).toBe(injected.links.length);
  });

  /**
   * The magnitude dimension, which needs prediction and observation to disagree
   * by more than the threshold.
   *
   * Predicted blast radius is the SUM of link blastRadius values (the seeded
   * primary supplier contributes 4, its peers 0). Observed is how many entities
   * the spawned cycle was actually scoped to — the link COUNT. Those differ by
   * construction, which is what makes this dimension observable at all.
   */
  test("predicted and observed blast radius are compared", async ({ request }) => {
    const policy = await createPolicy(request, "S11d magnitude", "spawn_cycle", {
      minSeverity: "Critical",
      sectorFilter: ["Logistics"],
    });

    const injected = await injectSignal(
      request,
      baseSignal({
        eventType: "S11d Magnitude Probe",
        severity: "Critical",
        confidenceScore: 0.95,
      }),
    );

    const predicted = injected.links.reduce((sum, l) => sum + l.blastRadius, 0);
    const observation = await outcomeEnvelope(injected.event.id, policy.id);
    const observed = observation.metrics.blastRadius;

    const scale = Math.max(predicted, observed, 1);
    const error = Math.abs(predicted - observed) / scale;
    const surprise = await surpriseEnvelope(injected.event.id, policy.id);

    // Asserted as an equivalence against the engine's own threshold rather than
    // hard-coding a verdict, so this stays correct if the fixture graph or the
    // default threshold changes.
    if (error > 0.25) {
      expect(surprise, `error ${error.toFixed(2)} exceeds the 0.25 threshold`).not.toBeNull();
      expect(surprise.dimension).toBe("blastRadius");
      expect(surprise.predicted).toBe(predicted);
      expect(surprise.observed).toBe(observed);
    } else {
      expect(surprise, `error ${error.toFixed(2)} is within tolerance`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// 11e — the three previously unhandled action types now do something
// ---------------------------------------------------------------------------

/**
 * `create_rfc`, `update_compliance_check` and `modify_spatial_routing` had no
 * consumer at all, and no domain object to be a consumer OF: there is no RFC,
 * compliance-check or spatial-routing table anywhere in the schema.
 *
 * They now share one artifact table. The bar these tests hold them to is not
 * "a row was written" — that would be the same theatre in a new place — but
 * that each artifact is attributable to its signal and policy, scoped to real
 * entities, readable through the API, and movable through a status an operator
 * can act on.
 */
test.describe("Scenario 11e — artifact-backed actions", () => {
  /**
   * Each case uses its OWN jurisdiction.
   *
   * `checkAndUpdateVolatility` runs before policy matching and tightens
   * approval gates for a jurisdiction whose 7-day frequency x severity exceeds
   * the org threshold. This suite injects many Critical signals into NL, so by
   * the time these tests run NL is volatile and an auto_approve policy is
   * correctly escalated to human approval — at which point the action never
   * executes and there is no artifact to assert on.
   *
   * That is the volatility feature working, not a bug, so the fix is to stop
   * these tests sharing a hammered jurisdiction rather than to weaken them.
   */
  const KINDS = [
    { actionType: "create_rfc", kind: "rfc", sector: "Logistics", jurisdiction: "DE" },
    { actionType: "update_compliance_check", kind: "compliance_finding", sector: "Financial", jurisdiction: "IT" },
    { actionType: "modify_spatial_routing", kind: "routing_directive", sector: "Energy", jurisdiction: "ES" },
  ] as const;

  for (const { actionType, kind, sector, jurisdiction } of KINDS) {
    test(`${actionType} produces an attributable ${kind}`, async ({ request }) => {
      const policy = await createPolicy(request, `S11e ${actionType}`, actionType, {
        minSeverity: "Critical",
        sectorFilter: [sector],
      });

      const injected = await injectSignal(
        request,
        baseSignal({
          eventType: `S11e ${kind} Probe`,
          targetSector: sector,
          jurisdiction,
          severity: "Critical",
          confidenceScore: 0.95,
        }),
      );

      // The action succeeded — it was previously recorded as failed because
      // nothing consumed it.
      const executed = (await actionLogsForEvent(injected.event.id)).filter(
        (l) => l.policy_id === policy.id,
      );
      expect(executed).toHaveLength(1);
      expect(executed[0].outcome).toBe("success");

      const artifacts = (await artifactsForEvent(injected.event.id)).filter(
        (a) => a.policyId === policy.id,
      );
      expect(artifacts, "the action must leave the record it claims to create").toHaveLength(1);

      const artifact = artifacts[0];
      expect(artifact.kind).toBe(kind);
      expect(artifact.status).toBe("open");
      // Provenance: an artifact you cannot trace back to its cause is a rumour.
      expect(artifact.severity).toBe("Critical");
      expect(artifact.targetSector).toBe(sector);
      expect(artifact.title.length).toBeGreaterThan(0);
      expect(artifact.body.length).toBeGreaterThan(0);
    });
  }

  test("an artifact is scoped to the entities the signal actually links", async ({ request }) => {
    const policy = await createPolicy(request, "S11e scope", "create_rfc", {
      minSeverity: "Critical",
      sectorFilter: ["Logistics"],
    });

    const injected = await injectSignal(
      request,
      baseSignal({ eventType: "S11e Scope Probe", jurisdiction: "CA", severity: "Critical", confidenceScore: 0.95 }),
    );

    const artifact = (await artifactsForEvent(injected.event.id)).find(
      (a) => a.policyId === policy.id,
    )!;
    expect(artifact.affectedEntityIds.sort()).toEqual(
      injected.links.map((l) => l.targetEntityId).sort(),
    );

    // And that scope is the observed blast radius the surprise loop compares
    // against the prediction — previously only spawn_cycle carried one.
    const observation = await outcomeEnvelope(injected.event.id, policy.id);
    expect(observation.metrics.blastRadius).toBe(injected.links.length);
  });

  test("artifacts are readable and movable through the API", async ({ request }) => {
    const policy = await createPolicy(request, "S11e lifecycle", "modify_spatial_routing", {
      minSeverity: "Critical",
      sectorFilter: ["Energy"],
    });

    const injected = await injectSignal(
      request,
      baseSignal({
        eventType: "S11e Lifecycle Probe",
        targetSector: "Energy",
        jurisdiction: "AU",
        severity: "Critical",
        confidenceScore: 0.95,
      }),
    );

    // "What did this signal cause?" — the provenance query.
    const byEvent = await request.get(
      `/api/autonomous-actions/artifacts?eventPrimitiveId=${injected.event.id}`,
    );
    expect(byEvent.ok()).toBeTruthy();
    const rows = (await byEvent.json()) as Array<Record<string, any>>;
    const mine = rows.filter((r) => r.policyId === policy.id || r.policy_id === policy.id);
    expect(mine).toHaveLength(1);
    const artifactId = mine[0].id;

    // An operator can act on it. A status nobody can move means nothing.
    const acked = await request.patch(`/api/autonomous-actions/artifacts/${artifactId}`, {
      data: { status: "acknowledged" },
    });
    expect(acked.ok()).toBeTruthy();

    const resolved = await request.patch(`/api/autonomous-actions/artifacts/${artifactId}`, {
      data: { status: "resolved" },
    });
    expect(resolved.ok()).toBeTruthy();
    const body = await resolved.json();
    expect(body.status ?? body.status).toBe("resolved");
    expect(body.resolvedAt ?? body.resolved_at).toBeTruthy();

    // And it drops out of the open queue.
    const open = await request.get("/api/autonomous-actions/artifacts?status=open");
    const stillOpen = ((await open.json()) as Array<Record<string, any>>).map((r) => r.id);
    expect(stillOpen).not.toContain(artifactId);

    const bad = await request.patch(`/api/autonomous-actions/artifacts/${artifactId}`, {
      data: { status: "banana" },
    });
    expect(bad.status()).toBe(400);
  });
});
