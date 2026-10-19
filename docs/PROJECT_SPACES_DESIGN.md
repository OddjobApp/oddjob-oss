# Project Spaces — Design Proposal

**Status:** Proposed (not implemented)
**Author:** Platform review, 2026-07-30
**Scope:** Introduce a durable, first-class `project` scope between `orgs` and `operational_cycles`.

---

## 1. Summary

Oddjob has no container for "a body of work." It has an **organization** (tenant) and an
**operational cycle** (a time-boxed, budgeted iteration), and nothing in between. As a result,
every entity type that needs to express belonging has grown its own nullable `mission_id` /
`cycle_id` column, and there is no way to ask *"show me everything about the Rescue Dispatch
effort"* without unioning dozens of tables across two different foreign keys.

This proposal adds **Project Spaces**: a named, durable scope that owns cycles, missions, apps,
datasets, and knowledge, and that acts as the default context for the copilot, for RAG retrieval,
for budget rollup, and for agent capability discovery.

The core design decision is that projects attach resources through **one junction table**, not
through a `project_id` column on every table — explicitly to stop the pattern this proposal is
trying to fix.

---

## 2. Problem

### 2.1 The evidence is in the schema

A survey of `shared/schema/` finds **52 nullable `mission_id` / `cycle_id` column declarations
across 36 schema files**:

```
agent/chat.ts            agora.ts                  cost-ledger.ts
agent/hr.ts              copilot-observability.ts  datasets.ts
agent/suggestions.ts     evaluation.ts             generation-sessions.ts
gms/hermes-traces.ts     governance-ops.ts         hil.ts
integrations/slack.ts    job-collections.ts        knowledge-base.ts
knowledge-extraction.ts  knowledge/graph.ts        learning/*  (4 files)
mission-deliverables.ts  missions/app-bindings.ts  missions/core.ts
missions/junctions.ts    missions/memories.ts      missions/runs.ts
…and 12 more
```

Each one independently re-answers the question "what does this row belong to." Most are
unconstrained plain integers (`integer("cycle_id")` with no `.references()`), so they accumulate
orphans silently.

**This is still growing.** Commit `04324a38` (2026-07-30) added two more — `datasets.cycle_id` and
`job_collections.cycle_id` — in a single afternoon. Every new entity type pays the tax again.

### 2.2 A cycle is the wrong container

`operational_cycles` (`shared/schema/operational-cycles.ts`) is explicitly an **iteration**, not a
home:

- `startDate` / `endDate` / `recurrence` (`once | daily | weekly | monthly | custom`)
- `status`: `planning → pending_approval → active → paused → reviewing → closed → cancelled`
- Its own `budgetLimitUsd` / `currentSpendUsd` / `tokenLimit`

A cycle *closes*. The work it was part of does not. There is nowhere to hang the durable
identity — the objective, the members, the accumulated knowledge, the apps produced — that
outlives any single iteration.

### 2.3 Downstream symptoms

| Symptom | Cause |
|---|---|
| Copilot guesses context from "last cycle touched" | No explicit user-selectable scope |
| RAG retrieval is org-wide | No scope to filter on; relevance degrades as an org grows |
| `discover_capabilities` searches every mission | No prior to narrow the candidate set |
| Budget approvals happen per-cycle | Wrong granularity — finance approves *efforts*, not iterations |
| App Arsenal groups by `parentCycle` (first-owner-wins) | Grouping key is a proxy for a concept that doesn't exist |
| Autonomous agents have unbounded blast radius | No scope boundary to enforce |

---

## 3. Non-goals

- **Not a replacement for orgs.** Tenancy, billing, and auth stay at the org level.
- **Not a replacement for cycles.** Cycles remain the unit of scheduled, budgeted execution.
- **Not a permissions rewrite.** Project roles layer on top of existing org roles; org admins keep
  their existing powers.
- **Not a data migration of the 52 existing columns.** Those stay as execution lineage. Project
  membership is *derived* from them, not a replacement for them.
- **Not required.** An org with no projects keeps working exactly as today via a default project.

---

## 4. Concepts

```
org  (tenant — billing, auth, isolation)
 └── project  (durable effort — "Rescue Dispatch", "Trust & Quality")
      ├── cycles     — time-boxed iterations within the project
      ├── missions   — units of work
      ├── apps       — what the project produced
      ├── knowledge  — datasets, KB documents, graph scope
      └── members    — humans and agents, with roles
```

**Project**: a durable, named scope owning a coherent body of work. Has an objective, an owner,
members, a status, and a rolled-up budget. Survives the cycles inside it.

**Project resource**: any existing entity (mission, cycle, app, dataset, job collection, KB
document) attached to a project via the junction. A resource has exactly one `primary` project and
may be `referenced` by others.

---

## 5. Data model

### 5.1 New tables

Three tables. Note `orgs` has PK column `org_id` (`shared/schema/auth.ts:74`).

```sql
CREATE TABLE projects (
  id                SERIAL PRIMARY KEY,
  organization_id   INTEGER NOT NULL REFERENCES orgs(org_id) ON DELETE CASCADE,
  key               TEXT NOT NULL,              -- URL slug, e.g. 'rescue-dispatch'
  name              TEXT NOT NULL,
  objective         TEXT,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'active',   -- active | paused | archived
  visibility        TEXT NOT NULL DEFAULT 'org',      -- org | private
  owner_user_id     TEXT,
  budget_limit_usd  NUMERIC(12,2),              -- NULL = inherit org policy
  metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default        BOOLEAN NOT NULL DEFAULT FALSE,
  created_by        TEXT NOT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  archived_at       TIMESTAMP
);

CREATE UNIQUE INDEX projects_org_key_unique ON projects (organization_id, key);
CREATE UNIQUE INDEX projects_org_default_unique
  ON projects (organization_id) WHERE is_default;
```

```sql
CREATE TABLE project_members (
  id             SERIAL PRIMARY KEY,
  project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  principal_type TEXT NOT NULL,          -- 'user' | 'agent'
  principal_id   TEXT NOT NULL,
  role           TEXT NOT NULL,          -- 'owner' | 'editor' | 'viewer' | 'operator'
  added_by       TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX project_members_unique
  ON project_members (project_id, principal_type, principal_id);
```

```sql
CREATE TABLE project_resources (
  id            SERIAL PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_type TEXT NOT NULL,     -- 'cycle'|'mission'|'app'|'dataset'|'job_collection'|'kb_document'
  resource_id   INTEGER NOT NULL,
  relation      TEXT NOT NULL DEFAULT 'primary',   -- 'primary' | 'referenced'
  added_by      TEXT,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX project_resources_unique
  ON project_resources (project_id, resource_type, resource_id);
CREATE UNIQUE INDEX project_resources_primary_unique
  ON project_resources (resource_type, resource_id) WHERE relation = 'primary';
CREATE INDEX project_resources_lookup
  ON project_resources (resource_type, resource_id);
CREATE INDEX project_resources_by_project
  ON project_resources (project_id, resource_type);
```

The `project_resources_primary_unique` partial index is what enforces "one home per resource"
while still allowing a dataset to be *referenced* by several projects.

### 5.2 Why a junction and not `project_id` everywhere

| | Junction | Column on 36+ tables |
|---|---|---|
| Adding a new entity type | Zero schema change | Another migration, another column |
| Sharing a dataset across efforts | Native (`referenced`) | Impossible without a junction anyway |
| "Everything in project X" | One indexed query | 36-table UNION |
| Read cost for a single row's project | One indexed join | Free |
| Consistency | One code path | 36 places to get `onDelete` wrong |

The read-cost column is the only one favouring the column approach, and it is addressable with a
cached resolver (§6.1). Given that the current 52-column sprawl is *itself* the problem being
solved, adding a 53rd column would be self-defeating.

### 5.3 One narrow exception

`operational_cycles` gets a real `project_id` column, because cycle → project is a
strict, always-present, one-to-one ownership that drives budget rollup and is on the hot path for
nearly every query:

```sql
ALTER TABLE operational_cycles
  ADD COLUMN project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX idx_operational_cycles_project ON operational_cycles (project_id);
```

Everything else goes through the junction.

### 5.4 Where each entity kind lives (as built)

The same question — "does this live in a project?" — resolves differently per entity kind, and the
split is deliberate:

| Entity | Scoped to a project? | Mechanism |
|---|---|---|
| **Cycles** | Yes | `operational_cycles.project_id` (§5.3) — strict ownership, drives budget rollup |
| **Missions** | Yes | `project_resources` junction, relation `primary` |
| **Agent cards** | No | `agent_cards` stay org-level — a card is reusable capability, like an employee |
| **Agent deployments** | Optionally | `agent_deployments.project_id`, NULL = org-global, visible from every project |
| **Workstreams** | No | Derived telemetry from `mission_runs` — a view, not a stored entity |

The rule that produced the table: *things that produce work attach to projects; things that are
capability stay org-level; things that are views stay views.* Missions and cycles produce work.
An agent card is capability — scoping the card would force every project to keep its own copies of
common agents. A workstream is an aggregation of mission-run telemetry; persisting it would create
a derived row that must track its sources forever.

**Creation-time attachment.** `createMission` accepts `projectId`/`projectKey` as context fields —
stripped before the insert, then applied through `projectService.attachResource` once the row
exists. Attach is best-effort: the project's `editor` role still gates the junction write, so a
mission created by a non-editor simply lands where the org default-project fallback puts it. A
CREW room scoped to a project passes `context.projectId` through `synthesize_mission_assets`, so
missions synthesized in a project room file under that project rather than silently defaulting.

**Membership ≠ deployment.** `project_members` (principal_type `agent`, §8) governs what an agent
may *do* in a project; `agent_deployments.project_id` governs where an agent *runs*. A deployment
can be project-scoped for an agent that holds no membership (it then has no project authority),
and a member agent need not be deployed there at all.

**Workstreams filter at query time.** `GET /api/workstreams?projectId=` resolves the project
(visibility-checked, so a foreign or private project is indistinguishable from absent), then
restricts the run feed to `project_resources` mission members. No workstream resource type exists
in the junction, and none is needed.

---

## 6. Server integration

### 6.1 Scope resolution

Add `requireProject` as a sibling to the existing tenant gate in `server/middleware/tenant.ts:17`
(`requireOrganization(strict = true)`):

```ts
// server/middleware/project-scope.ts
export const withProjectScope = (strict = false) => async (req, res, next) => {
  // precedence: explicit ?projectId → header → session active project → org default
  req.projectId = await resolveProjectScope(req);
  if (strict && !req.projectId) return res.status(400).json(errProjectRequired());
  next();
};
```

Resolution order is deliberate: an explicit request parameter always wins, so existing
integrations and scripts that pass no project keep landing in the org default project and behave
exactly as they do today.

A small LRU cache keyed `(resource_type, resource_id) → project_id` covers the reverse lookup and
neutralises the junction's read cost.

### 6.2 The OntologyService is the natural home

`server/domain/knowledge/core/ontology.service.ts` already implements exactly this shape: it is
DB-backed, org-scoped (`requireOrg` at line 75), and has virtual adapters for missions, jobs,
pipelines, and datasets over `ontology_object_types` / `ontology_objects` / `ontology_actions` /
`ontology_action_log`.

`project_resources` is structurally the same idea specialised to containment. Implement projects
as an ontology object type with a containment relation rather than as a parallel subsystem, and
resource adapters, the action log, and write-routing through the decision-router come for free.

The subsystem is already wired end-to-end, which makes this cheaper than it first appears:

| Surface | Location |
|---|---|
| Service + org gate | `server/domain/knowledge/core/ontology.service.ts` (`requireOrg`, line 75) |
| Resource adapters | `server/domain/knowledge/core/ontology-adapters.ts` |
| REST API | `server/domain/knowledge/routes/ontology.route.ts`, mounted at `/api/ontology/*` via `server/domain/knowledge/index.ts:80` |
| Agent tools | `ONTOLOGY_TOOLS`, registered in `server/domain/tools/v1/capabilities/index.ts:52` |
| Schema | `shared/schema/ontology/ontology.ts` |

So modelling projects as an ontology object type inherits a live REST surface *and* registered
agent tools on day one — the exact two layers the scaffold engine shipped without.

### 6.3 Budget rollup

Projects sum their cycles' `current_spend_usd`. `projects.budget_limit_usd` becomes the approval
gate that finance actually cares about; cycle budgets stay as execution guardrails.

```sql
SELECT p.id, p.name, p.budget_limit_usd,
       COALESCE(SUM(c.current_spend_usd), 0) AS spend_to_date
FROM projects p
LEFT JOIN operational_cycles c ON c.project_id = p.id AND c.deleted_at IS NULL
WHERE p.organization_id = $1
GROUP BY p.id;
```

### 6.4 Agent and copilot integration

This is where the user-visible payoff is largest.

**Explicit context replaces heuristics.** The copilot currently infers context from the last cycle
touched — the short-circuit that previously collapsed every app-launch request to Universal
Studio. Project scope replaces a hidden guess with a visible, user-changeable selection.

**Retrieval filter.** RAG retrieval gains `project_id IN (active, referenced)` as a pre-filter
instead of searching org-wide.

**Capability discovery prior.** `discover_capabilities` ranks in-project missions first. The
`CapabilityContract` interface in `shared/schema/missions/core.ts` already carries `purpose` /
`whenToUse` / `costClass`; project scope narrows the candidate set *before* that ranking runs,
which is a cheaper and more reliable win than adding more tools.

**Blast radius.** "This agent operates within project X" becomes enforceable at the junction — a
concrete answer to autonomous agents currently being able to touch anything.

---

## 7. UI

One route, `/projects/:key`. The tabs are overwhelmingly **existing surfaces with a scope filter
applied**, which is what makes this affordable:

| Tab | Content | Reuses |
|---|---|---|
| **Overview** | Objective, health, spend-to-date vs limit, active cycle, open HIL requests | New (small) |
| **Cycles** | Cycle list filtered to project; "new iteration" inherits project defaults | Cycles list |
| **Work** | Missions, jobs, blueprints in scope | Mission/job lists |
| **Apps** | App Arsenal grouped by project instead of `parentCycle` | App Arsenal |
| **Knowledge** | Datasets + KB in scope; doubles as the RAG retrieval boundary | Dataset Manager |
| **Quality** | Per-module quality section, scoped to project modules | Trust page module quality |
| **X-Ray** | Composition graph filtered to project-owned nodes | XrayCompositionExplorer |
| **Activity** | Assistant Updates + cycle-step announcements for this project | Assistant Updates |
| **Members** | Roles for people and agents (§8) | New (small) |
| **Settings** | Objective, visibility, budget limit, archive/restore | New (small) |

**Quality and X-Ray are deliberately not built.** Both key off Oddjob's own product domains —
module quality comes from the Playwright manifest grouped by internal domain, and X-Ray composition
scopes are codebase scopes. Neither has any link to a customer project, so a "scoped" version would
either show platform-wide numbers under a project heading or require inventing a mapping that does
not exist. Left out rather than faked.

**Members and Settings are what make §8 real.** Roles only bite on a `private` project, and until
Settings could set visibility, nothing in the product could produce one — the role table, the
membership API and the ceiling logic were all reachable only by hand-written HTTP calls.

**Global project switcher** in the app header, next to the org switcher. Selecting a project sets
session scope; the copilot inherits it and shows it in the chat header so the user can see what
context they are talking to.

> **Routing constraint (superseded in build):** admin SPA routes under `:rest*` match only one
> trailing segment, so the plan was for deep project sub-state to use query params. That limit
> applies only to routes delegated through CoreRouting. These are registered directly in
> OperationsRouting, which is SPA-root-mounted and already serves 6-segment routes, so tabs are
> path segments after all (`/projects/rescue-dispatch/cycles/95`). `?tab=` is still honoured for
> links minted before the switch.

---

## 8. Permissions

Project roles are **additive to** org roles and never expand them.

| Role | Can |
|---|---|
| `owner` | Everything in-project; manage members; archive |
| `editor` | Create/modify cycles, missions, apps, datasets in-project |
| `operator` | Run and approve executions; no structural changes |
| `viewer` | Read-only |

Rules:
- Org admins retain full access to all projects regardless of membership.
- `visibility = 'private'` hides a project from non-members in listings; org admins still see it.
- Agent principals get roles too — this is the enforcement point for §6.4's blast radius.

### 8.1 As built

Enforcement lives in `ProjectService` (`assertCanRead` / `assertRole`, both routed through
`roleFor`), and **scope resolution goes through the same gate**: `resolveProjectScope` resolves via
`getProject` rather than reading the table directly. Without that, `?projectKey=` was a way around
the read gate, and project scope decides what RAG retrieval and the capability prior feed the
copilot. An invisible project reports exactly what an absent one reports, so key probing cannot
enumerate private projects.

**Agent roles are a ceiling, not a grant** (`capRole`). Implementing them as grants would have
meant either breaking every existing agent — none has a membership row — or leaving the table
decorative:

| Agent principal | Effect |
|---|---|
| No grant anywhere in the org (*ungoverned*) | Unchanged from today: reaches whatever the caller reaches. This is every agent until someone grants one. |
| Governed, no role on this project | No access, whatever authority it acts under. Granting an agent one project is what confines it to that project. |
| Governed, role on this project | The **lower** of its role and the caller's — including when the caller is an org admin, since an agent always runs on somebody's authority. |

A ceiling only ever lowers; it can never hand a caller a role they did not have, which keeps
"additive and never expands" true for agents as well. An agent acting with no human in the loop
supplies its own base role instead. A request declares its agent principal with `X-Agent-Id`, taken
at face value precisely because it can only narrow what that request may reach.

Principal ids: users are `users.id`; agents are the **agent name**, the key the shared `ai_agent`
pool uses and what `cycle_run_events.agent_id` records.

---

## 9. Rollout plan

Non-destructive and incremental. No phase requires the next.

**Phase 1 — Data model (no user-visible change).**
Create the three tables plus `operational_cycles.project_id`. Create one `is_default` project per
org named after the org. Backfill: every existing cycle → default project; every resource with a
`cycle_id` or `mission_id` → the project owning that cycle/mission. The 52 existing columns are
left exactly as they are.

**Phase 2 — Read path.**
`withProjectScope` middleware, resolver + cache, project CRUD API, ontology object type. Scope
resolution defaults to the org default project, so behaviour is unchanged.

**Phase 3 — UI.**
`/projects/:key` with Overview + Cycles + Work. Header switcher. Users can now create real
projects and move cycles into them.

**Phase 4 — Scope consumers.**
RAG retrieval filter, `discover_capabilities` prior, copilot context header, budget rollup.
This is the phase where the value actually lands.

**Phase 5 — Remaining tabs.**
Apps, Knowledge, Quality, X-Ray, Activity. (Quality and X-Ray dropped — see §7.)

**Phase 6 — Access control, in the product.**
Members and Settings tabs, visibility on create, the read gate applied to scope resolution, and
agent ceilings. Phases 1–5 shipped the *scope*; this is the phase that makes §8 enforceable by
someone who is not writing curl commands. Covered by unit tests for the pure decision (`capRole`),
an integration suite against a real database for how membership, visibility and ceilings compose
(`server/domain/projects/tests/integration/project-permissions.test.ts`), and E2E for the grant →
revoke round trip.

**Reversibility:** through Phase 3, dropping the three tables and the one column restores the
current system exactly. Nothing existing is deleted or rewritten at any phase.

---

## 10. Open questions

1. **Can a resource have zero projects?** ✅ **Settled as proposed** — everything lands in the org
   default project, which is what lets `resolveProjectScope` stay total. One exception emerged in
   build: a *governed* agent is not dropped into the org default, because the default is a project
   like any other and it was not granted one (§8.1). It lands in its own first project, or nowhere.
2. **Do projects nest?** Proposed: no, not in v1. Sub-projects can be modelled as a
   `metadata.parentProjectId` hint until there is real demand.
3. **Should `project_resources` be an ontology object type from day one, or a plain table
   promoted later?** Leaning ontology-first (§6.2), but that couples Phase 1 to the ontology
   service's migration state, which has open items. Note the ontology tables were introduced by
   `server/migrations/011_add_ontology.sql` — a **third** migration location, applied by one-off
   scripts (`scripts/apply-migration-0NN.ts`) with no journal, alongside the drizzle-managed
   `migrations/runtime/` chain and the legacy root `migrations/`. Confirm 011 is actually applied
   in every target environment before depending on it.
4. **Cross-project resource sharing:** is `referenced` needed in v1, or is `primary`-only enough
   to ship? The partial unique index supports both, so this can be deferred.
5. **Archival semantics:** does archiving a project pause its active cycles, or refuse while any
   cycle is active? ✅ **Settled as proposed** — `archiveProject` refuses while any cycle is
   `active`/`paused`/`pending_approval`/`reviewing`, names the offenders, and requires explicit
   closure first. Because that precondition lives on the archive path, `updateProject` refuses a
   `status: 'archived'` PATCH outright rather than letting a generic field write skip the check.
   Un-archiving is allowed through PATCH, requires `owner`, and clears `archived_at`.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Junction read cost on hot paths | LRU resolver cache (§6.1); the one hot relation gets a real column (§5.3) |
| Backfill mis-assigns resources | Backfill is derived from existing `cycle_id`/`mission_id`, which are left intact — re-runnable and correctable |
| Yet another abstraction nobody adopts | Default project means zero adoption cost; value lands in Phase 4 where scope improves copilot answers users already complain about |
| Scope becomes a hidden trap ("why can't I see my dataset?") | Project shown in the copilot header and app header; `referenced` relation for genuinely shared resources |
| Phase creep — the 52 columns get "cleaned up" mid-project | Explicit non-goal (§3). They stay. |

---

## 12. Alternatives considered

**Tags / labels on existing entities.** Cheapest, no schema change. Rejected: no membership, no
budget rollup, no permissions boundary, no enforcement point for agent scope. Solves discovery
and nothing else.

**Promote `operational_cycles` to be the durable container.** Rejected: cycles are inherently
time-boxed by their own schema (`endDate`, `recurrence`, `closed` status). Making them durable
would mean gutting exactly the fields that make them useful for scheduled execution.

**Nested orgs / sub-tenants.** Rejected: drags in billing, auth, and data isolation for what is
fundamentally an organizational-grouping problem. Far more invasive for the same benefit.

**`project_id` column on all 36 tables.** Rejected — see §5.2. It is the pattern this proposal
exists to stop.
