# Spatial Signals → Cycle Reaction: E2E Test Plan

**Status:** BUILT — 96 tests passing against `oddjob_test`
**Branch:** `feat/project-spaces`
**Date:** 2026-08-08
**Run with:** `npm run test:db:setup && npm run test:e2e:signals`

This plan covers the path from a signal arriving to a cycle changing state because of it,
and the rule criteria that decide whether that happens. Every scenario names the real
endpoints, tables and effect strings the code actually produces, so the assertions are
falsifiable rather than aspirational.

---

## 1. The pipeline under test

Verified by reading the code, not assumed:

```
POST /api/event-primitives/inject
  └─ spatialTelemetryResolver.resolve()          → lat/lng/h3/precision/source
  └─ INSERT event_primitives                     (+ 14 spatial columns)
  └─ causalGraphService.mapEventToGraph()         → INSERT causal_graph_links
  └─ worldModelBridgeService.emitStateTransition()
       ├─ INSERT state_transition_events (status=accepted)
       ├─ enqueueKafkaEvent(type='prediction')   → kafka outbox (same tx)
       ├─ redis XADD (best-effort, non-fatal)
       └─ cycleSignalSubscriptionService.deliver()
            ├─ subscriptionRuleEngine.evaluateEvent()   [async, fire-and-forget]
            │    └─ INSERT rule_execution_audits (per EVALUATION — see §12.3)
            └─ for each enabled subscription in org:
                 ├─ matches(filters)?  ── no ─→ skip
                 ├─ inCooldown()?      ── yes ─→ skip
                 ├─ INSERT cycle_signal_deliveries  (UNIQUE subscription_id+event_primitive_id)
                 ├─ projectWorldState()
                 │    ├─ UPSERT cycle_world_states (version++, variables, materialChanges)
                 │    ├─ UPDATE mission_runs.mission_context.worldState[namespace]
                 │    ├─ UPDATE missions.blackboard[namespace] + last_signal
                 │    └─ eventStream.publish("signal.world_state.updated")
                 └─ applyDeliveryMode() → effect string
                      └─ UPDATE cycle_signal_deliveries.payload.appliedEffect
```

**Delivery mode → effect string** (`applyDeliveryMode`, cycle-signal-subscription.service.ts:446):

| mode | cycle precondition | effect written to `payload.appliedEffect` |
|---|---|---|
| `context_only` | any live | `context_projected` |
| `notify` | any live | `notified` |
| `gate` | `active` | `gated:paused` (cycle → `paused`) |
| `gate` | not active | `noop:cycle_<status>` |
| `replan` | ≥1 active run | `requeued:<n>` |
| `replan` | 0 active runs | `noop:no_active_runs` |
| `trigger` | ≥1 active run | `requeued:<n>` |
| `trigger` | cycle `paused` | `triggered:resumed` (cycle → `active`) |
| `trigger` | planning/pending_approval/reviewing | `triggered:blocked_<status>` |
| any | cycle closed/cancelled | `skipped:cycle_<status>` |
| unrecognised | — | `unknown_mode:<x>` |

`disposition` records what was **asked for**; `payload.appliedEffect` records what
**happened**. Asserting only on `disposition` would pass against a completely inert
subscription — every scenario below asserts on `appliedEffect`.

---

## 2. Rule criteria surface to be covered

Five condition families are reachable from a rule specification
(`subscription-rule-engine.service.ts`):

1. **Crisp** — 10 operators (`equals, not_equals, greater_than, greater_than_or_equal,
   less_than, less_than_or_equal, in, not_in, contains, between`), accepting both canonical
   names and UI symbols (`>=`), with ordinal ranking for `severity`.
2. **Spatial** (`spatial-predicate-engine.service.ts`) — three modes:
   - `geofence_trigger`: `ON_ENTER`, `ON_EXIT`, `ON_DWELL`, `ON_APPROACH`
   - `topological`: `there`, `not_there`, `contains`, `intersects`, `k_ring`
   - `flux_analytic`: `spatial_drift`, `isotropic_flux_density`, `velocity_vector`,
     `centroid_distance`, `h3_parent_zoom`, `equidistant_neighbors`
   plus the **precision gate**, the **persistence/hysteresis gate**, **cell groups**
   with `any`/`all`/`at_least_k` aggregation, and per-condition `weight`/`critical`/ramp scoring.
3. **Semantic graph** — `CAUSAL_PATH_EXISTS`, `GRAPH_COMMUNITY_MEMBER`,
   `FIEDLER_CUT_IMPACT`, `ONTOLOGY_IS_A`, `NEIGHBORHOOD_DENSITY`.
4. **Temporal** — `MAX_SIGNAL_AGE`, `RECENCY_DECAY_FLOOR`, `TIME_PARTING_WINDOW`,
   `FREQUENCY_SPIKE`.
5. **Fuzzy AI** — LLM-as-judge via `llmCognitiveEvaluator`.

Subscription-level filters are a separate, coarser gate: `eventTypes`, `sectors`,
`jurisdictions`, `entityIds`, `minimumConfidence`, `minimumSeverity`, plus `cooldownMinutes`.

---

## 3. Two findings that shaped the plan

> **Both resolved.** 3.1 was fixed by wiring `evaluateEvent` into the ingest path
> (Option A) — but doing so revealed that the loop still cannot *fire*, for
> reasons the original analysis did not reach. See §9.1 #1 and §9.3. 3.2 was
> approved and the testids were added. Kept here as written, because the
> reasoning is what produced the scenarios.

### 3.1 `autonomousActionService` has no callers (blocking for Scenario 11)

```
$ grep -rn "autonomousActionService" server/
server/domain/signal-intelligence/core/autonomous-action.service.ts:713:export const autonomousActionService = ...
```

The export is the only hit. Nothing in the ingest path calls `evaluateEvent`, so:

- `autonomous_action_policies` rows are written by `POST /api/autonomous-actions/policies`
  but **never evaluated** against a signal.
- `autonomous_action_logs` is never populated from a signal, so
  `POST /api/autonomous-actions/approve/:id` and `/reject/:id` operate on rows that
  nothing produces.
- `logExecution()` is the in-process producer of the **outcome observation** that feeds
  `spatialSurpriseService.evaluateOutcome()`. With `evaluateEvent` unreachable, the only
  remaining producer is the Kafka consumer (`spatial-kafka.service.ts:139`) — and
  `KAFKA_ENABLED` defaults to false.

**Consequence:** the surprise → replan loop (Scenario 11, the sharpest demonstration of
"the world model reacts to an external event") has no reachable production trigger today.

Three ways forward — I need your call:

| Option | What it means |
|---|---|
| **A. Wire it** (recommended) | Add `autonomousActionService.evaluateEvent(event, links)` to `emitStateTransition`, alongside the existing `deliver()` call. Small change, makes the whole autonomy + surprise branch live and testable end to end. |
| **B. Test-only harness** | Drive `evaluateOutcome` from a test-only route or a direct service call in the spec. Proves the loop's logic, proves nothing about production reachability. |
| **C. Defer** | Ship scenarios 1–10 + 12, mark the surprise loop as untestable-as-shipped and file it. |

I've written Scenario 11 assuming **Option A**, and flagged exactly what changes if you pick B or C.

### 3.2 Spatial UI has almost no test hooks

Total `data-testid` coverage across the spatial components:

- `RuleBuilder.tsx` — `rule-save-draft`, `rule-save-error`, `rule-save-warnings`
- `SpatialConditionEditor.tsx` — `spatial-condition-preview`, `spatial-edit-geometry`, `spatial-function-select`
- `H3SpatialPalette.tsx` — `h3-add-group`
- `SubscriptionsView.tsx` — `subscriptions-view-page`
- `ScenariosView.tsx` — `scenarios-view`

There is no stable hook for the rule condition rows, the operator/value inputs, the
subscription create form, the delivery-mode selector, or the deliveries table. UI-driving
these flows means either brittle text/role selectors or adding ~15 testids as part of the
work. I'd rather add the testids — say if you'd prefer I not touch component files.

Given that, the plan splits deliberately:

- **UI-driven (Playwright, real browser)** — authoring a rule and a subscription, and
  reading back the world state / deliveries. This is where the human-facing contract lives.
- **API-driven (Playwright `request` fixture, same spec files)** — signal injection and the
  criteria matrix. Driving 40+ operator permutations through a form would take hours per
  run and tell us nothing extra about the engine.
- **Backend verification (direct SQL via `tests/e2e/helpers/db-utils.ts`)** — every
  assertion that matters. UI text can lie; `cycle_world_states.version` cannot.

---

## 4. Fixture set

Created once per run, torn down after, under a dedicated project namespace so nothing
touches existing org data.

**Cycles** (via `POST /api/cycles/launch`, then status forced where needed):

| key | name | status | mission runs |
|---|---|---|---|
| `CYC_CTX` | `E2E Signal · Context` | active | 1 active |
| `CYC_GATE` | `E2E Signal · Gate` | active | 1 active |
| `CYC_REPLAN` | `E2E Signal · Replan` | active | 2 active, 1 completed |
| `CYC_TRIGGER` | `E2E Signal · Trigger` | paused | 0 active |
| `CYC_BLOCKED` | `E2E Signal · Blocked` | pending_approval | 0 active |
| `CYC_CLOSED` | `E2E Signal · Closed` | closed | 0 active |

**Subscriptions** (via `POST /api/cycle-signal-subscriptions`), one per cycle plus filter
variants on `CYC_CTX`.

**Geography** — two real zones at H3 Res 7, so cell sets are stable and reviewable:

- `ZONE_ROTTERDAM` — centre `51.9496, 4.1453`, k=2 disk (~19 cells)
- `ZONE_HORMUZ` — centre `26.5667, 56.2500`, k=3 disk (~37 cells)
- `CORRIDOR_NS` — an explicit 8-cell `h3Cells` list forming a north–south lane into Rotterdam

**Subjects** — `VESSEL-ALPHA`, `VESSEL-BRAVO`, `SENSOR-GRID-01`. Subject scoping matters:
persistence counters and ENTER/EXIT edges are keyed per subject, so two vessels must
confirm independently.

**Rule suite** — one suite `e2e-spatial-suite`, ~10 rules, one per criteria family.

---

## 5. Scenarios

Each scenario states what a failure would actually mean, because a test that can't fail
informatively isn't worth running.

---

### Scenario 1 — Baseline projection: a signal reaches a cycle's world model

**Covers:** the full spine, `context_only`, world-state versioning, mission-context and
blackboard propagation.

**Setup:** `CYC_CTX` active with 1 active mission run; subscription mode `context_only`,
filters `{}`, namespace `external_environment`.

**Action:** inject one `Port Congestion` / `Logistics` / `NLD` / `High` signal at
Rotterdam coordinates.

**Backend assertions:**
- `event_primitives` — 1 new row, `h3_index` non-null, `spatial_source='telemetry'`,
  `flags` contains `operator_injected`
- `causal_graph_links` — ≥1 row for the event
- `state_transition_events` — 1 row, `status='accepted'`,
  `environment_variables['signal.event_type']` matches
- `kafka_outbox_events` — 1 row, `type='prediction'`, `correlation_id` = event id
- `cycle_signal_deliveries` — 1 row, `disposition='context_only'`,
  `payload.appliedEffect='context_projected'`
- `cycle_world_states` — `version` incremented by exactly 1;
  `material_changes` last entry has `eventId`, `severity`, `summary`
- `mission_runs.mission_context.worldState.external_environment.version` equals the new version
- `missions.blackboard.last_signal.eventId` equals the event id

**UI assertions:** `/workspace/spatial` deliveries view shows the delivery with its effect;
cycle detail shows the world-state version.

**A failure means:** the spine is broken — nothing downstream is meaningful.

---

### Scenario 2 — Subscription filter matrix

**Covers:** all six filters, positive and negative, including the `entityIds` filter that
matches against causal links rather than the event.

Six subscriptions on `CYC_CTX`, each with exactly one filter set, plus one control with
no filters. Then inject a matrix of signals:

| # | signal shape | expected deliveries |
|---|---|---|
| 2a | eventType `Sanctions`, sector `Financial` | control + eventTypes(`Sanctions`) + sectors(`Financial`) |
| 2b | eventType `Sanctions`, sector `Logistics` | control + eventTypes only |
| 2c | jurisdiction `IRN` | control + jurisdictions(`IRN`) |
| 2d | confidence `0.55` vs `minimumConfidence: 0.8` | control only |
| 2e | severity `Medium` vs `minimumSeverity: High` | control only |
| 2f | severity `Critical` vs `minimumSeverity: High` | control + minimumSeverity |
| 2g | entity that maps to a link on `SUPPLIER-X` | control + entityIds(`SUPPLIER-X`) |

**Backend assertion:** exact delivery count per subscription per event — not "at least one".
An over-permissive filter is as much a bug as an over-strict one, and only exact counts
catch the first.

**A failure means:** operators cannot scope a subscription; every cycle hears everything.

---

### Scenario 3 — Cooldown suppression and delivery idempotency

**Covers:** `cooldownMinutes`, the unique `(subscription_id, event_primitive_id)` index,
and the deliberate dual-path design (in-process `deliver()` + Kafka
`deliverByCorrelation()` both run).

**Setup:** subscription on `CYC_CTX` with `cooldownMinutes: 15`.

**Steps:**
1. Inject signal A → delivery created, `last_delivered_at` set.
2. Inject signal B within the window → **no** delivery row; `cycle_world_states.version`
   unchanged.
3. `PATCH` the subscription to `cooldownMinutes: 0`, inject signal C → delivery created.
4. Call `deliverByCorrelation` for signal C's id a second time → still exactly **one**
   delivery row, world-state version incremented exactly once.

**A failure means:** either a signal storm can flood a cycle (cooldown broken), or the
Kafka and in-process paths double-apply every effect (idempotency broken). Step 4 is the
one that matters — it's the guarantee the whole dual-path design rests on.

---

### Scenario 4 — `gate` pauses a running cycle

**Covers:** the mode that had been silently inert before the current implementation.

**Setup:** `CYC_GATE` active; subscription mode `gate`, filter `minimumSeverity: Critical`.

**Steps:**
1. Inject a `High` signal → filter rejects; `operational_cycles.status` still `active`,
   no delivery row.
2. Inject a `Critical` signal → delivery `payload.appliedEffect='gated:paused'`,
   `operational_cycles.status='paused'`, fleet notification recorded.
3. Inject a second `Critical` signal at the now-paused cycle → `noop:cycle_paused`
   (the world state still projects; only the disturbance is skipped).

**UI assertion:** the cycle card shows `paused` and the deliveries view attributes the
pause to the signal.

**A failure means:** an operator configured a safety gate and got nothing — the exact
failure mode this code was written to fix.

---

### Scenario 5 — `replan` re-queues in-flight work

**Covers:** `queueMissionCycle` fan-out, active-run filtering, the `noop:no_active_runs` branch.

**Setup:** `CYC_REPLAN` active with 2 active runs and 1 completed run.

**Steps:**
1. Inject a matching signal → `appliedEffect='requeued:2'` (**not** 3 — the completed run
   must be excluded).
2. Assert both active runs' `mission_context.triggerEvent.eventId` equals the new event,
   and `mission_context.worldState.external_environment` carries the new variables.
3. Assert the BullMQ mission queue received exactly 2 jobs with the right `missionRunId`s.
4. Pause both runs, inject another signal → `noop:no_active_runs`, world state still
   projects (version increments).

**A failure means:** agents replan on stale context, or completed work gets resurrected.

---

### Scenario 6 — `trigger` starts work that isn't running

**Covers:** the three distinct `trigger` branches, which used to share one with `replan`.

| step | cycle | expected effect |
|---|---|---|
| 6a | `CYC_TRIGGER` paused, 0 active runs | `triggered:resumed`, status → `active` |
| 6b | `CYC_REPLAN` active, 2 active runs | `requeued:2` |
| 6c | `CYC_BLOCKED` pending_approval | `triggered:blocked_pending_approval`, status unchanged, warn notification issued |

**A failure means:** `trigger` and `replan` are indistinguishable, and a signal cannot
start an idle cycle — the whole point of the mode.

---

### Scenario 7 — Terminal-cycle guard and unknown-mode loudness

**Covers:** the safety rails.

1. Subscription on `CYC_CLOSED` → `skipped:cycle_closed`; cycle status untouched;
   **no** mission re-queue.
2. Same for a cancelled cycle → `skipped:cycle_cancelled`.
3. Write `deliveryMode='escalate'` directly to the table (the API rejects it, so this must
   be a direct insert simulating drift) → `unknown_mode:escalate` on the delivery row and a
   `warn` in the log. Silence here is what let `gate` look configured while doing nothing.
4. `notify` mode → `notified`, and delivery still succeeds when the notification throws
   (notification is an announcement, not the effect).

**A failure means:** a finished cycle can be resurrected by a stale signal, or a typo'd
mode fails open and silent.

---

### Scenario 8 — Crisp criteria sweep, including ordinal severity

**Covers:** all 10 operators, UI-symbol normalisation, and the severity ordinal path.

Rule suite `e2e-spatial-suite` gets one rule per operator. Driven through
`POST /api/rule-suites/e2e-spatial-suite/rules/:ruleId/evaluate` (the dry-run endpoint) for
the matrix, then two representative rules are fired for real through injection so
`rule_execution_audits` is exercised.

Cases that must be explicit:
- `severity >= "High"` on a `Critical` event → **matches**. (Numeric comparison would give
  `NaN >= NaN` → permanently false. This is reachable straight from the Rule Builder.)
- `severity >= "High"` on a `Medium` event → no match.
- Operator written as `">="` rather than `greater_than_or_equal` → identical result.
  (A UI-authored symbol previously fell through to `return false`.)
- `between` with bounds supplied high-first → still matches.
- `in` / `not_in` against an array.
- An unrecognised operator → no match **and** a warn logged.

**Backend assertions:** dry-run response `matched`/`matchedBranch`/`masterPriorityScore`;
for the two live rules, a `rule_execution_audits` row with the matching `disposition`.

**A failure means:** rules authored in the UI silently never fire — the highest-severity
class of bug in this subsystem, because nothing looks broken.

---

### Scenario 9 — Spatial geofence triggers over a subject's track

**Covers:** `ON_ENTER`, `ON_EXIT`, `ON_DWELL`, `ON_APPROACH`, and the per-subject
`previousH3Index` chaining the telemetry resolver derives.

A four-tick track for `VESSEL-ALPHA` approaching and entering `ZONE_ROTTERDAM`:

| tick | position | dwell | expected |
|---|---|---|---|
| 1 | 40 km out, heading 090° | — | `ON_APPROACH` fails (outside 10 km buffer) |
| 2 | 6 km out | — | `ON_APPROACH` **passes**, distance ≈6 km recorded in `observed` |
| 3 | inside the zone | 5 min | `ON_ENTER` **passes**; `ON_APPROACH` now fails ("approach window passed") |
| 4 | still inside | 180 min | `ON_ENTER` fails (already inside); `ON_DWELL` **passes** vs 120 min SLA |
| 5 | outside again | — | `ON_EXIT` **passes** |

`VESSEL-BRAVO` runs ticks 1–2 only, interleaved, and must **not** advance ALPHA's edges.

**Backend assertions:** `spatialTrace` per condition carries `passed`, `observed`, `unit`
and a human-readable `explanation`; `event_primitives.previous_h3_index` chains correctly
tick to tick; `ON_DWELL` score ramps between the SLA and 2× SLA rather than snapping to 1.

**A failure means:** geofences fire on the wrong edge or bleed across assets.

---

### Scenario 10 — Topological predicates and the precision gate

**Covers:** `there`, `not_there`, `contains`, `intersects`, `k_ring`, and the
safety-critical precision gate.

Part A — predicates against `ZONE_HORMUZ` and `CORRIDOR_NS`:
- `there` / `not_there` for a fix inside and outside
- `contains` with a Res-9 fix rolling up to a Res-7 zone cell
- `intersects` with a previous fix on the far side of `CORRIDOR_NS` (path crosses), and
  with no previous fix but a heading + velocity (dead-reckoned projection)
- `k_ring` with explicit `k`, and with `radiusKm` converted to a ring count

Part B — **the precision gate**, and the reason this scenario exists:

1. Inject a signal with **no coordinates**, jurisdiction `IRN`. The resolver places it at a
   country centroid with `spatial_source='jurisdiction'` and `spatial_precision_m = 500000`
   (`SOURCE_PRECISION_M.jurisdiction`).
2. Evaluate a `not_there` rule against a fine `ZONE_HORMUZ` geofence.
3. **Expected: the condition FAILS with an "unknown, not outside" explanation** — not a pass.

A country-centroid fix tested naively against a 5 km geofence reads as unambiguously
outside, which silently satisfies every `not_there` exclusion rule and raises a false alert
about an asset whose position is in fact unknown. Assert the explanation text contains both
the measured accuracy and the tolerance, so an operator can see why.

4. Same signal, same zone, but with a real telemetry fix (`spatial_precision_m: 50`) →
   evaluates normally.
5. A large multi-tile zone tolerates a coarser fix than a single-tile berth (the tolerance
   scales with `√cellCount`) — assert both sides of that boundary.

**A failure means:** the system confidently reports assets as out of bounds when it has no
idea where they are. This is the single highest-consequence assertion in the plan.

---

### Scenario 11 — Surprise: the world model reacts to a wrong prediction

**Covers:** `computeSurprise`, `SURPRISE_FLOOR` escalation, surprise-context write-back,
and the delivery-row surprise stamp. **Depends on finding 3.1 — assumes Option A.**

**Setup:** `CYC_CTX` with a `context_only` subscription and 1 active mission run;
one auto-approve autonomy policy matching `Critical` / `Logistics`.

**Steps:**
1. Inject a `Critical`, confidence `0.95` Logistics signal → qualifies for autonomy
   evaluation, policy matches, action executes.
2. `autonomous_action_logs` gets a row with `approval_status='auto_approved'`.
3. `logExecution` enqueues an outcome observation and calls `evaluateOutcome`.
4. Force divergence: make the action report `failed` (via a policy whose action type fails,
   or by injecting a blast-radius mismatch > 0.25). `computeSurprise` returns a
   `dimension: 'outcome'` assessment with `error: 1`.
5. **Assert the escalation:** the subscription is `context_only`, but
   `SURPRISE_FLOOR` raises it to `replan`. The delivery row gains
   `payload.surpriseMode='replan'`, `payload.surpriseEffect='requeued:1'`, and
   `payload.surpriseAppliedAt`.
6. **Assert the agent can see why:** `mission_runs.mission_context.lastSurprise.summary`
   and `missions.blackboard.last_surprise` carry the prediction-error text. Re-queueing a
   mission whose context doesn't mention the error just repeats the work that produced it.
7. **Assert idempotency:** replay the same outcome → `surpriseAppliedAt` unchanged, no
   second re-queue (the stamp dedupes across the Kafka and in-process callers).
8. **Assert the floor is a floor, not an override:** a `gate` subscription stays `gate`,
   because pausing is stronger than re-queueing.

**A failure means:** the system can be wrong repeatedly and never notice — which is
precisely the capability you asked to verify.

*If you pick Option B, steps 1–3 are replaced by a direct `evaluateOutcome` call and the
scenario proves the logic but not the wiring. If Option C, this scenario is cut and the
count drops to 11.*

---

### Scenario 12 — Flux analytics, cell groups, and scoring into MAUF

**Covers:** `flux_analytic` functions, grouped tile aggregation, `critical` conditions,
weights, and the spatial term's contribution to the Master Priority Score.

Part A — functions, one rule each, driven through the dry-run endpoint:
- `spatial_drift` — actual vs projected position, `>= 2.0 km`; assert the derived ramp
  scores 0 at 2 km and 1 at 4 km
- `isotropic_flux_density` — `Φ >= 0.7`
- `velocity_vector` — `<= 3 knots` (a stopped vessel in a lane)
- `centroid_distance` — `between [10, 50] km`
- `h3_parent_zoom` — rolls up to Res ≤ 6
- `equidistant_neighbors` — 6 for a normal hex, **5 at a pentagon cell** (assert the
  pentagon case explicitly; it's the one that catches naive implementations)

Part B — cell groups on `SENSOR-GRID-01` with per-tile `cellMetrics`:
- `aggregation: 'any'` — 1 of 7 tiles breaching passes
- `at_least_k` with k=3 — 2 tiles fail, 3 tiles pass
- `all` — every tile must breach
- `groupCombinator: 'all'` across two named sets vs `'any'`
- assert `matchRatio` is graded, not boolean: 4-of-7 must score above 1-of-7

Part C — scoring:
- a failing `critical: true` condition **zeroes** the aggregate even when three passing
  conditions surround it
- `weight` skews the weighted mean as expected
- assert `masterPriorityScore` moves with `spatialScore`. The MAUF surprise term is
  `fuzzyScores["spatial_score"] ?? spatialSurpriseScore ?? 0.15` — verify two rules
  differing only in spatial score produce different MAUF values. A constant 0.15 here would
  mean the spatial term is decorative.

**A failure means:** spatial rules are evaluated but don't influence prioritisation.

---

### Scenario 13 — Persistence gate (hysteresis) and dry-run isolation

**Covers:** `requiredConsecutiveHits`, `releaseAfterMisses`, `windowMs` staleness,
per-subject counters, durable rehydration, and the dry-run isolation guarantee.

1. Condition with `requiredConsecutiveHits: 3`. Ticks 1 and 2 pass raw but report
   `passed: false` with `pending: true` and an "Awaiting confirmation: n/3" explanation.
   Tick 3 latches → `passed: true`.
2. `pendingScoreFactor: 0.5` — a pending tick carries half score, so a nearly-confirmed
   signal still influences ranking.
3. `releaseAfterMisses: 2` — one miss holds the latch (`Held latched: 1/2`), two release it.
4. `windowMs` — ticks spaced beyond the window reset progress rather than accumulating
   "consecutive" hits assembled hours apart.
5. `VESSEL-BRAVO` ticks interleaved with ALPHA's do not advance ALPHA's counter
   (`spatial_condition_state` rows are keyed condition+subject).
6. **Durability:** assert counters are written to the persistence store, then simulate a
   restart (clear the in-memory map via `resetPersistence`) and confirm a latched geofence
   stays latched rather than re-firing `ON_ENTER` for an asset already inside.
7. **Dry-run isolation:** with a live counter at 2/3, call the Rule Builder's evaluate
   endpoint against the same `conditionId`. Assert the live counter is **still 2/3**
   afterwards. Without `withIsolatedPersistence`, pressing "test" in the UI would advance
   or reset production confirmation progress for a real tracked vessel.

**A failure means:** noisy telemetry produces flapping alerts, or testing a rule corrupts
live state.

---

### Scenario 14 — Semantic graph and temporal criteria

**Covers:** the two remaining condition families.

Semantic graph, against a signal with a known causal-link set:
- `CAUSAL_PATH_EXISTS` with a matching `targetEntityId` within `maxHops`, and one beyond it
- `NEIGHBORHOOD_DENSITY` with `threshold: 3` — 2 links fail, 4 links pass
- `FIEDLER_CUT_IMPACT` — `degree/10` vs threshold, at and either side of the boundary
- `ONTOLOGY_IS_A` matching on sector and on event type
- `GRAPH_COMMUNITY_MEMBER`

Temporal:
- `MAX_SIGNAL_AGE` — a signal backdated 90 minutes fails a 60-minute rule, passes a
  120-minute one
- `RECENCY_DECAY_FLOOR` — assert the 2-hour half-life curve at a known age
- `TIME_PARTING_WINDOW` — days-of-week and hour bounds, with the clock stubbed so the test
  isn't time-of-day flaky

**Note:** `FREQUENCY_SPIKE` currently `return true` unconditionally — a stub. I'll assert
the stub behaviour and flag it rather than write a test that pretends it works.

**A failure means:** graph- and time-aware rules mis-fire; and the plan would have quietly
skipped two of the five families.

---

### Scenario 15 — UI authoring round-trip

**Covers:** the human-facing contract — that what an operator builds in the browser is what
the engine executes.

Driven entirely through the browser at `/workspace/spatial`:

1. Open the Rule Builder, author a rule with one crisp condition (`severity >= High`) and
   one spatial condition (`there` in `ZONE_ROTTERDAM`, picked on the H3 palette).
2. Save. Assert `rule-save-error` is absent and the rule persists.
3. **Assert the saved specification against the DB**, not the UI: read
   `rule_specifications.specification` and confirm the operator serialised in a form
   `normalizeOperator` accepts, and the geometry carries real H3 cells.
4. Run the builder's dry-run against a sample event; assert the returned `spatialTrace`
   explanation is rendered in `spatial-condition-preview`.
5. Create a subscription through `SubscriptionsView` with mode `gate` on `CYC_GATE`.
6. Inject a matching signal **through the API**, then assert **in the UI** that the cycle
   shows as paused and the delivery appears with its effect.
7. Assert `cycle_world_states.version` in the DB matches the version the UI displays.

**A failure means:** the UI and the engine disagree — the class of bug where a rule looks
configured and does nothing.

---

## 6. Coverage summary

| Surface | Scenarios |
|---|---|
| Full ingest → world-model spine | 1 |
| Subscription filters (6) | 2 |
| Cooldown + idempotency | 3 |
| All 5 delivery modes + guards | 4, 5, 6, 7 |
| Crisp operators (10) + ordinal severity | 8 |
| Geofence triggers (4) | 9 |
| Topological predicates (5) + precision gate | 10 |
| Surprise → replan loop | 11 |
| Flux functions (6), cell groups, scoring, MAUF | 12 |
| Persistence gate + dry-run isolation | 13 |
| Semantic graph (5) + temporal (4) | 14 |
| UI authoring round-trip | 15 |

Fuzzy AI conditions are deliberately **not** covered by an assertion on the LLM's score —
that would be a flaky test of Gemini, not of Oddjob. Scenario 8 asserts only that a fuzzy
condition is dispatched to the evaluator and its returned score is applied against the
threshold, with the evaluator stubbed.

---

## 7. Proposed layout

```
tests/e2e/
  signal-spatial-delivery.spec.ts      Scenarios 1–7
  signal-spatial-criteria.spec.ts      Scenarios 8, 12, 13, 14
  signal-spatial-geofence.spec.ts      Scenarios 9, 10
  signal-spatial-surprise.spec.ts      Scenario 11
  signal-spatial-ui.spec.ts            Scenario 15
  helpers/
    signal-fixtures.ts                 cycles, subscriptions, zones, subjects, teardown
    signal-inject.ts                   typed wrapper over /api/event-primitives/inject
    signal-assert.ts                   DB assertions (deliveries, world state, audits)
```

Runs serially (`fullyParallel: false` is already the repo default) — these tests mutate
cycle status and world-state versions, so parallel execution would make them lie.

---

## 8. Decisions — all four resolved

| Question | Decision |
|---|---|
| **Finding 3.1** — wire, harness, or defer? | **Option A.** `evaluateEvent` is now called from `emitStateTransition`. See §9.1 #1. |
| **Finding 3.2** — may I add testids? | **Yes.** Added across `SubscriptionsView`, `RuleBuilder` and `RuleBuilderModal`. |
| **Scenario count** | **All 15 built.** Nothing cut. |
| **Environment** | **`oddjob_test`.** A dedicated Playwright config starts its own server on :5100 with `DATABASE_URL` forced to the test database — see §11. |

---

## 9. What the build found

Every item below was discovered by writing the scenario, not by reading code
speculatively. Each is fixed unless marked otherwise.

### 9.1 Defects fixed

**1. `autonomousActionService.evaluateEvent` had no callers.**
Its export was the only reference in `server/`. Autonomy policies could be
authored but were never matched against a signal; `autonomous_action_logs` was
never written from a signal; the approve/reject routes acted on rows nothing
produced; and `logExecution` — the in-process producer of the outcome
observation — was unreachable, so the prediction-error loop had no producer on
default configuration. Now called from `emitStateTransition`, failure-contained
the same way cycle delivery is.

**2. The dry-run returned no `spatialTrace` when a rule did NOT match.**
The trace was attached only on the passing return. That is backwards for the
surface that consumes it: the Rule Builder's simulation tab is where an operator
asks "why did my rule not fire?". It also made the precision gate's "position is
unknown at this granularity, not outside" message unreachable — failing was
exactly the case that dropped the explanation.

**3. The schema required `geometry` on every spatial condition.**
Four flux functions (`spatial_drift`, `isotropic_flux_density`,
`velocity_vector`, `equidistant_neighbors`) plus `h3_parent_zoom` measure the
observation and never consult a zone. A "drift >= 2km" rule could not be saved at
all, despite the engine implementing it correctly.

**4. The Rule Builder's operator dropdown emitted `greater_than_or_equals`.**
Plural. `normalizeOperator` returned null for it, so `evaluateCrispCondition`
failed closed — a rule authored as "is greater or equal" could never match, and
nothing surfaced why. The control now emits canonical names; the plural is
accepted as an alias so already-saved rules start working; and the missing `<`,
`<=` and `not in` operators were added.

**5. The delivery-mode dropdown offered `trigger_step` and `state_update`.**
Neither exists in the route allowlist or the column's CHECK constraint — both
400'd — while `gate`, `replan`, `trigger` and `notify`, the four modes that
actually disturb a cycle, could not be chosen at all.

**6. The guided rule wizard's publish could never succeed.**
It POSTed a single subscription carrying `deliveryMode: 'override_and_execute'`
with the rule nested under a `ruleSpecification` key the route ignores. Every
publish 400'd; had it not, every condition the operator configured would have
been silently dropped — while the toast reported the rule "successfully
registered to GRIE engine". It now writes the rule specification to
`/api/rule-suites/.../rules/...` and a separate, valid subscription.

**7. The wizard's fuzzy threshold was unsatisfiable.**
A -1..1 "mu_sentiment" slider fed `fuzzyThreshold`, which the schema constrains
to 0..1. Any negative value failed validation, so the rule could not be saved.
The metric being asked for is really "how hostile is this", which is naturally
0..1 with the comparison the other way round.

### 9.2 Guards found stronger than assumed

Two scenarios in the original plan assumed a failure path that turned out to be
unreachable. Both were rewritten to assert the guard that actually holds.

- **Unknown delivery mode** (Scenario 7). The plan proposed writing a drifted
  value straight into the table to reach the `default:` branch of
  `applyDeliveryMode`. A CHECK constraint rejects the write, so the mode is
  guarded at the API *and* in the schema. That branch is defence in depth, not
  dead code.
- **Failing autonomous action** (Scenario 11). All four action handlers only
  publish to the cross-app event bus, and both the API and a CHECK constraint
  restrict `action_type` to those four. So `executeAction` always succeeds.

### 9.3 ~~OPEN~~ CLOSED — the surprise loop could not fire

> **Resolved in §14.** Handlers now report what they did, and both dimensions are
> live. The analysis below is kept because it is what identified the real cause,
> which was one layer deeper than "add a metrics field".

`computeSurprise` compares two dimensions and, on the live path, **neither can
diverge**:

- `outcome` — every action handler succeeds (§9.2), so observed always equals
  predicted.
- `blastRadius` — `logExecution` builds its outcome envelope without a `metrics`
  field, so `observation.metrics?.blastRadius` is always undefined and the
  magnitude comparison is skipped entirely.

The loop is now wired and runs end to end, and returns null every time.

Scenario 11b pins this as an equivalence — *a surprise exists iff an action
reported failure* — so the assertion stays correct if a handler ever does start
failing. Scenario 11c verifies the consumer half (escalation floor, replan,
context write-back, idempotency, tenant isolation) by driving `deliverSurprise`
at the same seam `evaluateOutcome` calls.

**Closing this needs a product decision, not a test change:** either populate
`metrics.blastRadius` on the outcome envelope so magnitude divergence becomes
observable, or give action handlers a real success/failure signal.

### 9.4 Smaller observations, not fixed

- `COUNTRY_CENTROIDS` is keyed on **ISO-2** codes. A signal ingested with `NLD`
  or `IRN` silently loses its centroid fallback and resolves to
  `spatialSource: "none"`. Nothing validates `jurisdiction` on the way in.
- `SignalDashboard` imports `ViewSwitcher` but never renders it — the tab bar is
  dead code. Navigation is `?view=` on the query string.
- The wizard falls back to a hardcoded `targetCycleId = 42` when no cycle is
  selected, which 404s on any database that does not happen to have cycle 42.
- The dry-run route stamps `createdAt: new Date()` with no override, so the
  age-based temporal operators can only ever be exercised at zero age.
- **The fuzzy-AI test runs against the evaluator's FALLBACK, not a model.** In
  this environment `llmCognitiveEvaluator` logs
  `Gemini call failed for hostility ... status 404` and degrades to a heuristic
  score. That is genuinely useful coverage — it proves a fuzzy condition is
  dispatched, scored under its metric name, thresholded, and that an AI outage
  degrades instead of failing the rule — but it is **not** evidence that
  LLM-as-judge works. Reading it as such would be the same category of error as
  the naming in §10. Verifying the judge itself needs a working key and a
  different kind of test (one that tolerates a non-deterministic score), which
  this suite deliberately does not attempt.

---

## 10. Vocabulary that overpromises

Several operator names claim more than the implementation delivers. Worth stating
plainly, because rules are authored by operators reading those names — the names
are the whole interface.

| Name | What it suggests | What it does |
|---|---|---|
| `FIEDLER_CUT_IMPACT` | A Fiedler cut — algebraic connectivity from the second-smallest eigenvalue of the graph Laplacian, identifying where a graph is most easily severed. | `min(1, links.length / 10)`. A linearly normalised **degree count** of the signal's direct causal links. Reads no topology beyond that count, so it cannot distinguish a hub whose removal partitions the network from four unrelated leaves. |
| `equidistant_neighbors` | An analytic over the signal's neighbourhood. | `gridDisk(cell, 1).length - 1` — a **constant of the H3 tiling**: 6 for a hexagon, 5 at one of the 12 pentagons per resolution. Says nothing about the signal; two entirely different signals in the same cell always score identically. Useful only as a pentagon detector. |
| `FREQUENCY_SPIKE` | Frequency counting over a window, configured by `frequencyWindowMinutes` and `minFrequencyCount`. | ~~`return true`. Unconditionally. Both config fields are accepted and ignored.~~ **Now implemented** — see §12. This was the one entry in this table that was cheaper to fix than to rename. |
| `masterPriorityScore` / MAUF | A Multi-Attribute Utility Function — a calibrated utility. | A weighted sum with hand-chosen coefficients (0.35 / 0.20 / 0.20 / 0.15 / 0.10). Plausible and reproducible, but **unvalidated**: there is no labelled dataset of operator-ranked signals in the repository, and nothing would fail if the weights were reordered. |
| "Distilled GRIE Rule … registered to GRIE engine" | The wizard published a rule the engine will evaluate. | Until §9.1 #6 it published nothing at all. It does now — but read the phrase as a claim to verify, not a description. |

The tests assert these at their real semantics and say so in their names:
`FIEDLER_CUT_IMPACT is a normalised degree count, not a spectral cut` brackets
the threshold at 0.4/0.5 against degree 4 to pin the arithmetic to exactly
`degree/10`; `equidistant_neighbors reports grid topology (5 at a pentagon, 6
elsewhere)` pins it to those two values; `FREQUENCY_SPIKE is an unimplemented
stub that always passes` feeds it `minFrequencyCount: 1000` and asserts it still
passes; and the MAUF test is titled `(wiring, not calibration)`.

**Recommendation — open, nothing done.** Renaming is a breaking change to saved
`rule_specifications`, so no identifier was touched:

1. **Rename to match behaviour** — `FIEDLER_CUT_IMPACT` to `CAUSAL_DEGREE_NORM`,
   `equidistant_neighbors` to `h3_cell_neighbour_count`. Needs a migration for
   existing rows plus an alias table like the one `normalizeOperator` already
   uses.
2. **Implement to match the name** — real algebraic connectivity is genuine work
   and needs the full graph in memory, not one signal's links.
3. **Leave the names, document them** — cheapest; the tests and this section
   already carry the caveat.

`FREQUENCY_SPIKE` was a separate case — not misnamed, just unimplemented — and
it has since been implemented rather than removed (§12.4). The other three
entries remain open.

---

## 11. Where the suite lives

```
playwright.signals.config.ts              server on :5100 against oddjob_test
tests/e2e/signal-auth.setup.ts            authenticates; the real readiness gate
tests/e2e/helpers/
  signal-global-setup.ts                  seeds org + admin into the test DB
  signal-fixtures.ts                      cycles, missions, runs, causal graph, teardown
  signal-geo.ts                           H3 zones, bearings, distances
  signal-inject.ts                        typed wrapper over /api/event-primitives/inject
  signal-rules.ts                         suite/rule authoring + dry-run
  signal-assert.ts                        every backend assertion
tests/e2e/
  signal-spatial-delivery.spec.ts         Scenarios 1-7          17 tests
  signal-spatial-criteria.spec.ts         Scenarios 8,12,13,14   30 tests
  signal-spatial-geofence.spec.ts         Scenarios 9,10         14 tests
  signal-spatial-surprise.spec.ts         Scenario 11            10 tests
  signal-spatial-ui.spec.ts               Scenario 15             5 tests
                                                          total  73 tests
```

Run with `npm run test:db:setup && npm run test:e2e:signals` (append `:headed` to
the second to watch it). Roughly two minutes.

The config starts its own server on port 5100 with `DATABASE_URL` forced to
`TEST_DATABASE_URL` and `reuseExistingServer: false`, so the suite cannot adopt a
dev server pointed at the development database. `configureTestEnvironment()`
refuses any database whose name lacks a distinct `test` segment. Workers are
pinned to 1: these scenarios mutate cycle status and world-state versions, and in
parallel the assertions would lie.

**Deviation from §4:** fixture cycles, missions and runs are inserted directly
rather than launched through `POST /api/cycles/launch`. That endpoint spawns a
real agent cycle — it calls a model and takes tens of seconds — and cannot
produce cycles in the precise states these scenarios need (one paused, one
closed, one awaiting approval). Everything on the path actually under test still
goes through the real HTTP API.

**Two assertion habits worth keeping.** Delivery scenarios assert on
`payload.appliedEffect`, never `disposition` — the latter records what was asked
for and is written before anything happens, so it passes against a completely
inert subscription. And any scenario asserting an exact world-state version delta
gets its own cycle from `createIsolatedCycle`, because `deliver()` iterates every
enabled subscription in the org and each match projects: on a shared cycle the
version advances once per matching subscription, which makes version arithmetic a
question about test order rather than about the code.

---

## 12. Hardening pass

Four enhancements that came out of building the suite. Each closes a gap the
original 15 scenarios did not reach — because each was found *by* writing them.
Covered by `tests/e2e/signal-spatial-hardening.spec.ts` (14 tests).

### 12.1 The precision gate covers position-derived magnitudes

`precisionGate` was called from `evaluateGeofenceTrigger` and
`evaluateTopological` but **not** from `evaluateFluxAnalytic`. So
`spatial_drift` on a country-centroid fix reported hundreds of kilometres of
drift as a confident breach — the same "unknown presented as fact" failure the
zone gate exists to prevent, in the function where the number looks most
authoritative.

The zone gate judges a fix against a target region's extent, and flux functions
have no region. What bounds them is the **threshold being asserted**: claiming
"drift >= 2km" from a fix accurate to ±500km is the accuracy radius showing
through, not a measurement. `magnitudePrecisionGate` compares the fix against the
smallest bound the rule cares about.

Deliberately threshold-relative rather than a fixed cut-off — a ±20km fix cannot
measure 2km of drift but can perfectly well establish that drift exceeds 1000km.
Only `spatial_drift`, `centroid_distance` and `h3_parent_zoom` are gated;
`velocity_vector` and `isotropic_flux_density` are read straight off telemetry
and do not become unknowable because a position was resolved from a place name.

### 12.2 Cooldown throttles per subject, not fleet-wide

`inCooldown` keyed on `subscription.lastDeliveredAt` alone, making it a
fleet-wide mute: one vessel's signal silenced every other vessel on the same
subscription for the whole window, so a Rotterdam congestion signal could
swallow an unrelated Hormuz one. The failure mode is silence — the hardest kind
to notice, and the reason this survived.

A cooldown is meant to stop *the same thing* being reported repeatedly, and "the
same thing" is per tracked entity. It now keys on (subscription, subjectId),
which is the reading the persistence gate already takes. Signals with no subject
share a `__global__` bucket, preserving the old behaviour for single-asset
feeds, where it was correct.

### 12.3 Every rule evaluation is recorded

Audits were written only for rules that **passed**, and a rule that threw
produced a `console.warn` and nothing durable. So "why didn't my rule fire?" had
three indistinguishable answers in the data: it did not match, it failed to
evaluate, or it was never reached.

Migration `0046_rule_audit_outcomes` adds `outcome` (`matched` / `no_match` /
`error`, CHECK-constrained), `failure_reason`, and `spatial_trace`. The last one
persists the per-condition explanations for **live** signals — including the
precision gate's "position is unknown, not outside" — which were previously
reachable only through the Rule Builder's dry run. `GET /:suiteId/audits` takes
`?outcome=` so `?outcome=error` answers "which of my rules are failing to run".

This changed what an *absent* audit row means, and invalidated two assertions in
the original suite that inferred "did not match" from absence. Both were
rewritten to assert on the outcome column, which is strictly better: a
`no_match` row is positive evidence the rule ran and rejected the signal, so the
semantic-graph cases no longer need their priority-weight ordering trick.

### 12.4 FREQUENCY_SPIKE counts

Was `return true`, unconditionally, with both `frequencyWindowMinutes` and
`minFrequencyCount` accepted and ignored — so any rule containing it was
strictly weaker than its author intended, and silently so.

Now a windowed count over `event_primitives`, narrowed to the same event type
and, where the signal names one, the same subject: a burst of readings from one
vessel is a spike about that vessel, not about the fleet. The predicate ordering
matches the existing `(organization_id, subject_id, extraction_timestamp)` index.
It fails **closed** on a query error — treating an unevaluable condition as
satisfied is exactly what made it worthless.

### 12.5 Deterministic subscription ordering

`deliver()` iterated subscriptions in unspecified select order, so with two
gates on one cycle, which one paused it and which reported `noop:cycle_paused`
was down to the query planner. Now ordered by id.

---

## 13. Still open

Unchanged by the hardening pass, and all product decisions rather than test work:

1. ~~**The surprise loop cannot fire**~~ — **CLOSED**, see §14. The cause was
   deeper than a missing metrics field: `publish()` swallowed handler errors and
   returned no verdict, so "success" meant "an event was emitted". Handlers now
   report what they did.
2. **Three operator names still overpromise** (§10) — `FIEDLER_CUT_IMPACT`,
   `equidistant_neighbors`, and the MAUF weights. Renaming breaks saved
   `rule_specifications`.
3. **MAUF is uncalibrated** — the cheap improvement is surfacing the term-by-term
   breakdown so a score is at least inspectable; the real one is capturing
   whether operators acted on a signal and gating on ranking quality, which the
   repo's existing eval measurement spine is already shaped for.
4. **CI does not run this suite** — workflows target `main/master/develop` while
   the integration branch is `Development`. At ~40s this is a good PR gate once
   that is corrected.

---

## 14. The surprise loop, wired through the handlers

Closes §9.3. Covered by Scenario 11d in `signal-spatial-surprise.spec.ts`.

### 14.1 The real cause was one layer deeper

§9.3 identified two blockers — every action succeeded, and the outcome envelope
carried no `metrics`. Adding a metrics field would have fixed the symptom and
left the cause, which is this:

```ts
// crossAppEventBus.publish()
for (const handler of handlers) {
    try { await handler.handler(fullEvent); }
    catch (error) { logger.error(...); }   // swallowed
}
return fullEvent.id;                        // no verdict
```

`publish()` catches every handler error and returns only an event id. So from a
publisher's point of view:

- a fan-out where **every consumer threw**,
- a fan-out where **all succeeded**, and
- a fan-out with **no registered consumer at all**

are indistinguishable. "Success" in `executeAction` meant *an event was
emitted*, not *anything was done* — and no amount of extra fields on the outcome
envelope changes that.

### 14.2 What changed

**`publishWithResults()`** (new) runs the same loop but records a per-handler
`{ status, metrics, detail }`. `publish()` delegates to it and returns just the
id, so all existing callers keep byte-identical behaviour — this is deliberately
additive, because most publishers here are genuine notifications for which
fire-and-forget is correct.

**Handlers may now return a verdict.** `EventHandler.handler` returns
`Promise<void | HandlerResult>`; returning nothing still means "succeeded", which
preserves the contract every existing handler was written against. Handlers that
catch their own errors — the usual pattern here, so one bad consumer cannot break
a fan-out — must return an explicit `failed`, because a caught error is invisible
from outside.

**The spawn-cycle handler reports what it created.** It already computed
`affectedEntityCount` and wrote it to the forensic log; it now also returns
`{ cycleId, blastRadius }`. The number existed and reached nothing.

**`dispatch()` turns handler outcomes into a verdict.** It throws — recorded as a
failed action — in two cases that both used to read as success:

- **No registered handler.** The action was announced to an empty room.
- **Every handler failed.** Containment hid the failure from the publisher.

A partial failure counts as success, because the action did take effect
somewhere. Metrics from the succeeding handlers are merged onto
`ActionExecutionResult` and travel to the outcome envelope, which makes
`computeSurprise`'s magnitude branch reachable for the first time.

### 14.3 A finding this surfaced

**Only `spawn_cycle` has a registered handler.** `create_rfc`,
`update_compliance_check` and `modify_spatial_routing` publish to nobody — three
of the four autonomy action types have been doing nothing and reporting success.

They are now recorded as failed, with the reason on the log row:

```
No handler is registered for autonomous-action:create-rfc;
the action was published but nothing performed it
```

That is a real behaviour change and it is the right one: an autonomy policy
configured to file an RFC currently does not file an RFC, and a prediction that
it would is wrong. Making that a prediction error is exactly what the loop is
for. The alternative — continuing to report success — is the failure mode this
whole exercise exists to find.

**Decision taken:** the three handlers were implemented — see §15.

### 14.4 What the tests now prove

| Assertion | Was |
|---|---|
| An action nobody handles is recorded as failed | reported success |
| A failed action raises a `dimension: 'outcome'` surprise | unreachable |
| That surprise escalates `context_only` to `replan` and re-queues the run | verified only by calling `deliverSurprise` by hand |
| The outcome envelope carries `metrics.blastRadius` | field absent entirely |
| Predicted vs observed blast radius is compared | branch never entered |
| A successful, on-prediction action raises nothing | vacuously true |

The magnitude test is written as an equivalence against the engine's own
threshold rather than a hard-coded verdict, so it stays correct if the fixture
graph or `SPATIAL_SURPRISE_THRESHOLD` changes.

### 14.5 Test isolation this forced

Two changes to existing tests, both consequences of the loop actually working:

- **Scenario 11c** now uses `confidenceScore: 0.7`, below the autonomy gate.
  It drives `deliverSurprise` by hand to isolate the consumer half; with a
  qualifying signal the producer would raise its own surprise first and stamp
  the delivery, so the manual call would correctly return 0 and the test would
  fail for a reason unrelated to what it checks.
- **Scenario 11d** scopes its reads by policy id. One signal can match several
  policies, each producing its own action, outcome and potentially its own
  surprise, so an unfiltered read returns whichever was enqueued first — making
  the assertion depend on what earlier tests left behind.

### 14.6 Stability

Three consecutive full-suite runs at 91/91 (~40s). One transient failure was
observed mid-development and did not reproduce across those three runs; it has
not been root-caused, so treat 91/91 as three good runs rather than a stability
guarantee. If it recurs, the run output names the test.

---

## 15. The three missing handlers

Closes the decision left open in §14.3. Covered by Scenario 11e (6 tests);
suite is now 96.

### 15.1 There was nothing to consume them with

`create_rfc`, `update_compliance_check` and `modify_spatial_routing` had no
registered handler — and no domain object one could have been written against:

- **No RFC table.** Nothing resembling one anywhere in the schema.
- **No compliance-check table.** `shared/schema/compliance.ts` is zod types —
  frameworks, controls, packs — with **no persistence behind them**.
- **No spatial-routing table.** `llmRoutingRules` is about model routing and is
  unrelated.

So "implement the handlers" could not mean "call the existing service", and
inventing three half-domains to make three log lines look busy would have
recreated the exact problem being fixed.

### 15.2 One artifact table, not three half-domains

Migration `0047_autonomous_action_artifacts`. What the three genuinely share is
that each produces **a record a human or an agent must then act on** — a
proposed change, a compliance finding, a routing directive — attributable to the
signal and policy that caused it.

| Column | Why |
|---|---|
| `event_primitive_id`, `policy_id` | Provenance. An artifact you cannot trace to its cause is a rumour. `ON DELETE SET NULL`, so purging signal history does not destroy the record of what was done about it. |
| `kind`, `status` | CHECK-constrained. `open → acknowledged → resolved / dismissed`. |
| `severity`, `jurisdiction`, `target_sector` | Denormalised so the artifact reads on its own once the signal has aged out. |
| `affected_entity_ids` | The entities it covers. Its length is the observed blast radius reported to the prediction-error loop. |

`GET /api/autonomous-actions/artifacts` (filterable by `status`, `kind`,
`eventPrimitiveId`) and `PATCH .../artifacts/:id` for the lifecycle. Without a
read path the artifacts would be write-only, which is the same failure in a new
place; without a movable status the status means nothing.

### 15.3 What each handler claims — and what it does not

The bodies are deliberately modest, because overclaiming here is what §10 is
about:

- **`create_rfc`** opens a request for change and marks it
  `requiresHumanScoping: true`. The policy authorised *raising* it, not acting
  on it.
- **`update_compliance_check`** records that a review is warranted and sets
  `assessed: false`. It does not assess or attest to anything — there is no
  control store to assess against.
- **`modify_spatial_routing`** records an advisory directive and the assets it
  covers, `advisory: true`. No route is altered: re-routing live assets
  unattended on an automated signal is not a decision this policy is authorised
  to take.

**This is a substrate, not an integration.** It records the decision, its scope
and its provenance, and makes them queryable. Filing the RFC in a real
change-management system is a per-action integration that belongs *behind* this
table, not instead of it.

### 15.4 Blast radius is now observable for all four action types

Previously only `spawn_cycle` passed `affectedEntityIds`; the other three sent a
bare payload. So the magnitude dimension of the surprise loop could only ever be
observed for one action type in four. All four now share one payload builder
(`dispatchArtifactAction`), which is what stopped the divergence recurring.

### 15.5 Consequences for the tests

Two Scenario 11d tests asserted failure by relying on `create_rfc` and
`modify_spatial_routing` having **no consumer**. Implementing the handlers
correctly broke them — an assertion that depends on a feature being missing is
one that fights its own codebase. Both were rewritten as equivalences: an
outcome surprise is raised exactly when an action reports failure.

With all four handlers working, **no action fails under a healthy
configuration**, so the outcome dimension is now correct but quiet. That is the
desired end state, and the equivalence form keeps the assertion honest either
way.

### 15.6 A finding this surfaced

Scenario 11e initially failed on `update_compliance_check`, with the action log
showing `approval_status: pending` instead of executing.

Not a bug: `checkAndUpdateVolatility` runs before policy matching and tightens
approval gates for a jurisdiction whose 7-day frequency × severity exceeds the
org threshold. The suite injects many Critical signals into `NL`, so by the time
these tests run that jurisdiction is genuinely volatile and an `auto_approve`
policy is correctly escalated to human approval.

The volatility feature working as designed. The fix was to give each 11e case
its own quiet jurisdiction (`DE`, `IT`, `ES`, `CA`, `AU`) rather than weaken the
assertion — but it is worth knowing that **autonomy behaviour is
history-dependent**, and a policy that auto-approved yesterday may require
approval today. That is intended, and it is not visible anywhere in the UI.

### 15.7 Still open

- **Real integrations behind the artifacts.** The table is the seam; nothing
  currently forwards an RFC to a change-management system or a directive to a
  routing engine.
- Everything in §13 except item 1, which §14 closed.
