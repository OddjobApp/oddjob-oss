# Signal Intelligence — Spatial Rules

The H3 spatial condition surface of the Governed Rules & Decision Intelligence
Engine (GRIE): what an operator can express in the Rule Builder, how it is
evaluated, and how it is persisted.

Written Aug 2026. Companion to `UNIVERSAL_EVENT_ENVELOPE.md`.

---

## 1. Why this exists

Two defects made the rule surface non-functional before this work, and both were
silent:

- **The Rule Builder could not match anything.** The UI emitted display symbols
  (`>=`, `in`); `CrispCondition` accepted only spelled-out names
  (`greater_than_or_equal`). Every UI-authored condition fell through the
  engine's `default: return false`. A rule that never fired was
  indistinguishable from one correctly declining to.
- **The spatial term of the priority score was a constant.** MAUF read
  `spatialSurpriseScore`, which only the surprise service ever sets, so every
  Rule Builder rule scored a hardcoded `0.15`.

`shared/contracts/spatial-predicates.ts` is now the **single source of truth**
for operator names. Add operators there, never in one half alone.

---

## 2. The condition surface

Four categories, all declared in `shared/contracts/spatial-predicates.ts` and
evaluated by `server/domain/signal-intelligence/core/spatial-predicate-engine.service.ts`.

### 2.1 Geofence triggers — state-machine edges

| Trigger | Fires when | Needs |
|---|---|---|
| `ON_ENTER` | Crosses into the zone. A first-ever fix inside counts. | — |
| `ON_EXIT` | Was inside, now outside. | a previous fix |
| `ON_DWELL` | Inside longer than the SLA (`T > T_sla`). | `dwellSlaMinutes` |
| `ON_APPROACH` | Within a buffer of the perimeter but **not yet breached**. | `approachBufferKm` |

`ON_DWELL` and `ON_APPROACH` grade continuously: a four-hour overrun scores
above a thirty-minute one, and closer approaches score higher than distant ones.

### 2.2 Containment predicates

| Predicate | Aliases | Meaning |
|---|---|---|
| `there` | `in`, `inside`, `located_in`, `within` | Centroid resolves inside the tile set |
| `not_there` | `not_in`, `outside` | Outside — exclusion zones, corridor deviation |
| `contains` | `encompasses` | Coarse zone encompasses the entity's cell, by O(1) parent rollup |
| `intersects` | `crosses` | Trajectory path touches any tile of the zone |
| `k_ring` | `within_radius` | Within *k* concentric rings of the origin |

`intersects` uses the real previous fix when available, otherwise dead-reckons
one hour along the heading so a first-tick signal can still be tested.

### 2.3 Flux & vector analytics

| Function | Contract | Unit |
|---|---|---|
| `spatial_drift` | `\|P_actual − P_projected\|` | km |
| `isotropic_flux_density` | `∇·(Φv)` | Φ, 0–1 |
| `velocity_vector` | `\|v\| ≥ v_limit` | knots |
| `centroid_distance` | `greatCircleDistance(from, to)` | km |
| `h3_parent_zoom` | `cellToParent(idx, res)` | resolution |
| `equidistant_neighbors` | `gridDisk(cell, 1)` | cells (6, or **5 at a pentagon**) |

### 2.4 Comparison operators

`equals`, `not_equals`, `greater_than`, `greater_than_or_equal`, `less_than`,
`less_than_or_equal`, `in`, `not_in`, `contains`, `between`.

Display symbols (`>=`, `≥`, `==`) normalise to canonical names via
`normalizeOperator()`. Unrecognised operators return `null` so the caller fails
loudly rather than evaluating to false.

> **`between` takes a `[min, max]` pair** and accepts the bounds in either
> order. A single bound is rejected at the API boundary.

> **Ordered categorical fields compare by rank, not `Number()`.** `severity >=
> "High"` was `NaN >= NaN` — permanently false, and reachable straight from the
> UI. `ORDINAL_FIELDS` in `subscription-rule-engine.service.ts` holds the rank
> map; any future ordered enum needs an entry there.

---

## 3. Hex tile groups

A condition can target **named tile sets** rather than one flat cell list. A set
may hold a single tile or many.

| Aggregation | Passes when |
|---|---|
| `any` (default) | ≥1 tile matches |
| `all` | every tile matches |
| `majority` | more than half match |
| `at_least` | ≥ K tiles match (`atLeastK`) |

Multiple sets on one condition combine with `groupCombinator: any \| all`.

Aggregations beyond `any` are only meaningful with **per-tile metrics**
(`cellMetrics`, keyed by H3 index) — that is what makes "Φ ≥ 0.7 in at least 3
tiles of Harbour Approaches" evaluable. For a single moving asset, which
occupies one cell at a time, the positional reading is used instead.

Grouped conditions score by **how much** of the set matched, not merely that it
did, so a set with 4 of 7 tiles breaching outranks one with a single tile.

---

## 4. Scoring

Each condition contributes to the spatial term of the Master Priority Score.

| Field | Effect |
|---|---|
| `weight` | Relative weight in the aggregate. Only ratios matter. |
| `passScore` / `failScore` | Score on pass/fail, 0–1. Non-zero `failScore` lets a near-miss carry partial priority. |
| `rampFloor` / `rampCeiling` | Grade continuously across a band instead of snapping to 0/1. |
| `critical` | Failing it **zeroes the whole spatial score** — undilutable by passing low-value conditions. |

---

## 5. The iteration gate (confirmation)

Raw geofence edges flap: GPS jitter puts an asset either side of a boundary and
`ON_ENTER`/`ON_EXIT` fire alternately every tick.

| Field | Effect |
|---|---|
| `requiredConsecutiveHits` | Confirmations before the condition reports true. Default 1 (fires immediately, preserving prior behaviour). |
| `releaseAfterMisses` | Consecutive misses before a latched condition releases — hysteresis on the trailing edge. |
| `windowMs` | Discards progress after a gap; a count assembled hours apart was never "consecutive". |
| `pendingScoreFactor` | Fraction of score carried while still confirming. |

Counters are **per subject**, keyed on `subjectId`, so two vessels confirm
independently.

### 5.1 Durability

Counters are held in `spatial_condition_state`, one row per
`(organization, conditionKey, subjectId)`.

In memory alone the gate was correct only within a process lifetime: a restart
dropped a **latched** geofence back to unconfirmed, so an asset already sitting
inside a zone re-fired `ON_ENTER` after every deploy — a duplicate alert for an
entry that had already happened, which is exactly the boundary noise the gate
exists to suppress.

The engine treats the table as a **write-behind cache**:

1. `hydratePersistence()` loads counters for the conditions about to be
   evaluated, batched by condition and subject.
2. Evaluation stays **synchronous** — the hot path is a map lookup. Hydration is
   a separate step precisely so the predicate surface need not become async for
   state that changes once per signal.
3. `flushPersistence()` upserts what moved, via `ON CONFLICT` on the unique
   triple so concurrent consumers on the same subject cannot race.

Both are called by the rule engine around its evaluation pass. Load and flush
failures are logged, not thrown: a signal that cannot reach its history still
evaluates, losing at most one tick of progress.

> **Dry runs are isolated.** `withIsolatedPersistence()` swaps in a scratch map
> and detaches the store. A dry run evaluates the *same* `conditionId` a live
> rule uses, so without this, pressing "test" in the Rule Builder would hydrate
> a real vessel's counters, advance them, and flush them back.

> **`conditionId` should be explicit.** Without one the key is derived from the
> condition's shape, so editing the geometry silently resets its progress.

**Pruning:** `spatialPersistenceStore.prune()` drops rows for subjects that have
stopped reporting — otherwise the table grows with one row per tracked entity
per gated condition. Unlatched rows expire after 24h, **latched rows after 30
days**: a latched geofence is live state, and dropping it re-introduces the
duplicate-`ON_ENTER` bug. Nothing schedules this yet.

---

## 6. The precision gate — a false-alert guard

Ingestion places a signal at a **country centroid** (±500 km) when nothing
better is available. Tested naively against a 5 km harbour geofence, such a
signal reads as unambiguously **outside** — which satisfies every `not_there`
exclusion rule and raises an alert about an asset whose position is in fact
unknown.

**"Unknown" and "outside" are different answers and must not collapse.**

`precisionGate()` compares the fix's accuracy against the zone's **extent**
(`cellRadius × √cellCount`, doubled), not against a single cell — a 60-tile
region legitimately tolerates a coarser fix than a single-tile berth. Too coarse
→ the condition reports "position is unknown at this granularity, not outside".

Signals with no recorded provenance are unaffected, so pre-existing rows keep
evaluating.

---

## 7. Ingestion — how the columns get populated

`spatial-telemetry-resolver.service.ts`, precedence most-trustworthy first:

| # | Source | Precision | Origin |
|---|---|---|---|
| 1 | `telemetry` | 10 m | Producer coordinates (AIS/GPS/sensor) |
| 2 | `gazetteer` | 5 km | Named hub matched in the signal text |
| 3 | `geocoder` | 1 km | Mapbox lookup — **opt-in**, off by default |
| 4 | `jurisdiction` | 500 km | Country centroid |

Wired into all three write paths: the Kafka consumer (`spatial-kafka.service`),
feed ingestion (`signal-ingestion.service`), and the manual
`POST /api/event-primitives/inject`.

The resolver also derives `previousH3Index` and accumulates `dwellMinutes` from
the subject's last fix — without which `ON_ENTER`/`ON_EXIT`/`ON_DWELL` have
nothing to compare against. Dwell **resets on a cell change**; it is a dwell,
not an age.

The resolver never throws: ingestion must not fail because a position could not
be determined. An unplaceable signal gets null columns and is invisible to
spatial rules.

`shared/contracts/spatial-gazetteer.ts` is shared frontend/backend on purpose —
the map palette offers these presets and the resolver matches text against them.
If they drifted, an operator would paint a geofence around a hub that ingestion
resolves elsewhere.

The geocoder is off by default because ingestion is a hot path and Mapbox is a
network call per signal. Enable per-call with `allowGeocoder`.

---

## 8. Persistence API

`/api/rule-suites` — `server/domain/signal-intelligence/api/rule-suites.routes.ts`.

| Method | Path | Purpose |
|---|---|---|
| `GET` `POST` | `/api/rule-suites` | list · create |
| `GET` `PATCH` `DELETE` | `/api/rule-suites/:suiteId` | read (with rules) · update · delete |
| `GET` | `/api/rule-suites/:suiteId/rules` | list rules |
| `PUT` | `/api/rule-suites/:suiteId/rules/:ruleId` | upsert (idempotent) |
| `PATCH` `DELETE` | `/api/rule-suites/:suiteId/rules/:ruleId` | toggle/reweight · delete |
| `POST` | `/api/rule-suites/:suiteId/rules/:ruleId/evaluate` | dry-run, writes nothing |
| `POST` | `/api/rule-suites/validate` | validate without saving |
| `GET` | `/api/rule-suites/:suiteId/audits` | execution history |

Payloads are validated by `shared/contracts/rule-specification.ts` (zod).
Specifications are stored as `jsonb`; without a schema at the write boundary a
malformed rule is accepted silently and only fails later, against live signals.

### Tenant isolation

`rule_specifications` carries **no `organization_id`** — it is scoped only
through `suite_db_id → rule_suites.organization_id`. And `suite_id` is
**globally unique**. So every rule lookup resolves the suite by
`(suiteId, orgId)` first and uses its surrogate id; filtering by `suite_id`
alone reads across tenants.

### Project scope

Via `withProjectScope()` (`server/middleware/project-scope.ts`), resolution
order `?projectId` → `X-Project-Id` → session → org default. The middleware is
**total**, so mounting it strands no caller. Suites with a `NULL project_id`
predate project scoping and stay visible org-wide rather than vanishing.

---

## 9. Rule Builder → engine specification

The builder allows arbitrarily nested AND/OR groups. An engine **branch** is
flat — conditions plus one `matchStrategy`. There is no single-branch
representation of `A AND (B OR C)`.

Flattening to the root group's logic would save a rule that evaluates
differently from the one on screen. So `rule-tree-to-spec.ts` converts to
**disjunctive normal form** — an OR of ANDs — which maps exactly onto branch
semantics, because a rule matches if its `ifBranch` OR any `elseIfBranch`
matches, and an `ALL` branch is a conjunction:

```
A AND (B OR C)  ->  (A AND B) OR (A AND C)
                ->  ifBranch[A,B] , elseIfBranches[[A,C]]     (all matchStrategy ALL)
```

Every branch carries the same `thenAction`, so which one matched changes only
the reported branch id.

DNF is exponential in nested ORs. `MAX_DNF_CLAUSES` (256) caps it and raises
`RuleConversionError` rather than hanging the browser.

Action nodes (`webhook`, `response_cycle`) are **effects, not predicates** —
they build the `thenAction` and are excluded from conditions.

---

## 10. Reranking

`spatial-reranker.service.ts`. A plain score sort is insufficient on a spatial
feed for two reasons:

- **No urgency.** A vessel closing on an exclusion zone at 25 knots and one
  idling inside a harbour can carry the same MAUF score; only one has a
  deadline. Time-to-breach enters the ordering.
- **No diversity.** One congested port emits hundreds of near-identical signals
  from the same few cells and occupies the entire queue. Co-located signals are
  clustered by coarse H3 parent and all but the strongest are demoted.

Nothing is dropped — duplicates are demoted, so the audit trail stays complete.
Every adjustment is reported so an operator can see why a signal moved.

---

## 11. Map palette

`H3SpatialPalette.tsx`. Custom SVG over Web Mercator tiles.

- **Tools:** pan / paint / erase. `Space`, `Alt` or middle-mouse temporarily
  force pan.
- **Groups:** named, coloured tile sets with per-set aggregation. A painted tile
  belongs to exactly one set.
- **Resolution changes remap groups** (`cellToParent` / `cellToChildren`) rather
  than orphaning painted work — cells are indexed per-resolution.

> The `stroke`/`fill` values in `GROUP_COLORS` are deliberately **raw hex, not
> design tokens**: they paint SVG over dark, satellite and streets basemaps that
> do not follow the app theme. Theming them would make the grid vanish over a
> light basemap. The `text`/`bg`/`border` fields beside them *are* tokens,
> because those render in normal themed chrome.

---

## 12. Migrations

| Migration | Contents |
|---|---|
| `0041_event_primitive_spatial_telemetry` | spatial columns + `idx_event_primitives_h3` |
| `0042_event_primitive_spatial_provenance` | `subject_id`, `spatial_source`, `spatial_precision_m` + subject index |
| `0043_grie_rule_suites` | the three `rule_*` tables, **creating and repairing** |
| `0044_event_primitives_uuid_rebuild` | rebuilds `event_primitives` where it predates the uuid PK |
| `0045_spatial_condition_state` | durable confirmation counters for the iteration gate |

`0043` repairs as well as creates. The GRIE tables were previously created by
raw SQL inside `subscriptionRuleEngine.ensureTablesExist()` at runtime, so they
existed only where that code had run and did not match the drizzle schema: no
org/event foreign keys, no `project_id`, and **no unique index on
`(suite_db_id, rule_id)`** — which is what makes a rule upsert idempotent.
Without it, a replayed save silently duplicated a rule. The migration
de-duplicates before adding the index.

FK targets are `orgs(org_id)`, `projects(id)`, `event_primitives(id)`. Each is
added inside a guarded `DO` block, because `ADD CONSTRAINT` has no
`IF NOT EXISTS` and a rerun must not abort the migration.

`0044` addresses a second inherited drift: some databases carried an
`event_primitives` predating the uuid primary key — serial `integer` id,
`numeric` confidence, every column nullable. On those, the application could not
insert a row at all, and `0043` had to skip the
`rule_execution_audits.event_primitive_id` foreign key because uuid cannot
reference integer.

It **drops and recreates**, so it runs only when the table is both mis-shaped
*and* empty. A mis-shaped table **with rows raises instead** — converting integer
ids to uuid mints new identities, which is a data-migration decision an operator
must make deliberately, not a side effect of running migrations. Re-running
against a correct table is a no-op, and the recreated column order matches a
freshly migrated database so schema diffs stay clean.

---

## 13. Known gaps

- **Nothing schedules `prune()`** on `spatial_condition_state`, so the table
  grows until something calls it.
- **The geocoder is disabled by default**; the gazetteer is 12 strategic hubs.
- **The `event_primitives` domain-binding is now wider**, not narrower — see
  §7 of `UNIVERSAL_EVENT_ENVELOPE.md`.

*(Resolved Aug 2026: the legacy integer-PK `event_primitives` that made signal
intelligence inert in dev is rebuilt by `0044`.)*
