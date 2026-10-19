# Ontology Service — DB-backed, Org-scoped Design

**Status:** Implemented (Phases 0–3; schema migrated to dev + test DBs) · **Owner:** TBD · **Last updated:** 2026-07-14

## 1. Context & problem

Oddjob exposes a Palantir-AIP-style **Ontology** to the copilot via three agent tools
(`ontology_list_objects`, `ontology_get_object`, `ontology_execute_action`, in
`server/domain/tools/v1/capabilities/ontology-tools.ts`). Today those tools call
`OntologyService` (`server/domain/knowledge/core/ontology.service.ts`), which is a
**demo stub**:

- Objects live in an in-memory `mockDb` (a `Record<string, any[]>` on a static class) —
  not persisted, identical for every tenant, lost on restart.
- `bootstrap()` (run at tool-module load) registers exactly one Object Type,
  `TaskTicket`, with three hard-coded rows and one demo Action (`assign_technician`).
- **No org scoping.** The tool `execute` functions receive a `ToolContext` (which
  carries `organizationId`, `userId`, `permissions`, `resourceScoping`) but pass it to
  nothing. If this service ever held real data it would be a cross-tenant leak.

So the assistant currently "answers from" fake demo data. This spec defines a real,
persistent, **org-scoped** OntologyService with safe Action execution.

## 2. Goals / non-goals

**Goals**
- Persistent, per-org **Object Types**, **Object instances**, **Actions**, and
  (optionally) **Link Types**.
- Strict org + permission scoping on every read and write, driven by `ToolContext`.
- **Safe Action execution**: writes route through the existing governor / decision-router
  (HIL) instead of mutating state unchecked.
- Let Object Types be **backed by existing domain data** (missions, jobs, pipelines…)
  without copying it, so the assistant answers from real records immediately.
- Backward-compatible tool names; the copilot keeps the same three tools (plus a couple
  of discovery additions).

**Non-goals**
- Replacing the **knowledge graph** (`knowledgeNodes`/`knowledgeEdges`/`graphSchemaDefs`).
  Those model *discovered/extracted* knowledge; the Ontology models a *curated business
  object + action* layer. They are complementary (see §3).
- A full visual ontology editor (future; the existing `OntologyMapper.tsx` can grow into it).
- Real-time bidirectional sync with external systems of record (future).

## 3. Relationship to existing systems

| System | Purpose | Writes? |
| --- | --- | --- |
| Knowledge graph (`knowledgeNodes`/`Edges`, `graphSchemaDefs`) | Extracted/ingested facts, semantic search | Append via ingestion |
| **Ontology (this spec)** | Curated business Object Types + typed Actions the assistant can *invoke* | Yes, via governed Actions |

- **Alignment:** follow the exact org-scoping convention already used by
  `graphSchemaDefs` — `organizationId → orgs.id (onDelete: cascade)`, org indexes, and a
  `uniqueIndex(organizationId, name)`.
- **Bridge:** an Object instance may optionally carry `kgNodeId` linking it to a
  knowledge-graph node, so the assistant can pivot between "business object" and
  "everything we know about it."
- **Safety reuse:** Action execution reuses `decisionRouter.requestDecision(...)` /
  the governor auto-approval layer (`server/domain/governor/core/decision-router.ts`) —
  the same HIL gate the rest of the platform uses.

## 4. Data model (Drizzle, org-scoped)

New file `shared/schema/ontology/ontology.ts` (barrel-exported like the other schema
modules). All tables follow repo conventions (serial PK, `organization_id` FK with
cascade, `created_by`, timestamps, org-scoped unique indexes).

```ts
// Object Type = a business entity definition (AIP "Object Type")
export const ontologyObjectTypes = pgTable("ontology_object_types", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),                 // e.g. "TaskTicket", "Mission"
  description: text("description"),
  // JSON-Schema-ish property map: { title: {type:"string"}, status:{type:"string", enum:[...]} }
  propertiesSchema: jsonb("properties_schema").notNull().default(sql`'{}'::jsonb`),
  titleProperty: text("title_property"),        // which property is the display title
  icon: text("icon"),
  // Backing strategy — see §6
  backing: text("backing").notNull().default("materialized"), // "materialized" | "virtual"
  sourceAdapter: text("source_adapter"),        // for "virtual": registered adapter key (e.g. "missions")
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("ontology_object_type_org_name_unique").on(t.organizationId, t.name),
  index("ontology_object_type_org_idx").on(t.organizationId),
]);

// Object instance (only for backing = "materialized"; "virtual" types read from source tables)
export const ontologyObjects = pgTable("ontology_objects", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
  objectTypeId: integer("object_type_id").references(() => ontologyObjectTypes.id, { onDelete: "cascade" }).notNull(),
  externalId: text("external_id"),              // caller-facing id; unique per (org,type)
  properties: jsonb("properties").notNull().default(sql`'{}'::jsonb`),
  kgNodeId: integer("kg_node_id"),              // optional link to knowledge_nodes.id
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("ontology_object_org_type_extid_unique").on(t.organizationId, t.objectTypeId, t.externalId),
  index("ontology_object_org_type_idx").on(t.organizationId, t.objectTypeId),
]);

// Action = a typed, governed operation
export const ontologyActions = pgTable("ontology_actions", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),                 // e.g. "assign_technician"
  description: text("description"),
  objectTypeId: integer("object_type_id").references(() => ontologyObjectTypes.id, { onDelete: "cascade" }),
  parametersSchema: jsonb("parameters_schema").notNull().default(sql`'{}'::jsonb`),
  effect: text("effect").notNull().default("read"),        // "read" | "write"
  handlerKind: text("handler_kind").notNull(),             // "builtin" | "pipeline" | "tool" | "sql"
  handlerRef: text("handler_ref").notNull(),               // fn key / pipelineId / tool name / named SQL
  requiresApproval: boolean("requires_approval").notNull().default(true),
  riskLevel: text("risk_level").notNull().default("medium"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("ontology_action_org_name_unique").on(t.organizationId, t.name),
  index("ontology_action_org_idx").on(t.organizationId),
]);

// Audit log for every executed Action
export const ontologyActionLog = pgTable("ontology_action_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => orgs.id, { onDelete: "cascade" }).notNull(),
  actionId: integer("action_id").references(() => ontologyActions.id, { onDelete: "set null" }),
  actorUserId: text("actor_user_id"),
  params: jsonb("params"),
  approvalId: integer("approval_id"),           // decision-router request id, when gated
  status: text("status").notNull(),             // "executed" | "denied" | "failed"
  result: jsonb("result"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [ index("ontology_action_log_org_idx").on(t.organizationId) ]);
```

> **Optional (phase 4):** `ontologyLinkTypes` (typed relationships between Object Types),
> mirroring AIP Link Types. Deferred until there's a concrete need.

## 5. Service API

Replace the static, in-memory `OntologyService` with an **instance/method API that
requires an org context on every call** — the service never trusts a caller-supplied
`orgId`; it uses `ctx.organizationId` (super-admins may pass an explicit override, same
pattern as the `/api/agent/chat` route).

```ts
interface OntologyCtx {
  organizationId: number;          // resolved, non-null — enforced by callers
  userId: string;
  isSuperAdmin?: boolean;
  permissions?: McpPermission[];
  resourceScoping?: Record<string, string[]>;
}

class OntologyService {
  listObjectTypes(ctx): Promise<ObjectTypeDef[]>;
  getObjectType(ctx, name): Promise<ObjectTypeDef>;
  upsertObjectType(ctx, def): Promise<ObjectTypeDef>;

  listObjects(ctx, typeName, opts?: { filter?; limit?; cursor? }): Promise<Page<ObjectInstance>>;
  getObject(ctx, typeName, id): Promise<ObjectInstance>;

  listActions(ctx, typeName?): Promise<ActionDef[]>;
  executeAction(ctx, actionName, params): Promise<ActionResult>;  // validates → governs → runs → logs
}
```

Every read issues `WHERE organization_id = ctx.organizationId`. `executeAction`:
1. loads the org-scoped `ontologyActions` row (404 if not in this org),
2. validates `params` against `parametersSchema`,
3. if `effect === "write"` and not auto-approved → `decisionRouter.requestDecision(...)`
   and block until approved/denied,
4. dispatches to the handler by `handlerKind` (see §7),
5. writes an `ontology_action_log` row.

## 6. Object backing strategy (key decision)

Each Object Type declares a `backing`:

- **`materialized`** — instances stored in `ontology_objects` (JSONB `properties`). For
  net-new business objects that don't already exist in the platform.
- **`virtual`** — the Object Type maps to an **existing domain table** through a small
  registered **read adapter** (`sourceAdapter`, e.g. `"missions"`, `"jobs"`,
  `"pipelines"`). `listObjects`/`getObject` translate to org-scoped queries on that table
  and project columns into the Object Type's properties. No data duplication.

Recommendation: ship a handful of **virtual** types first (Mission, Job, Pipeline,
Dataset) so the assistant answers from real records on day one, plus **materialized**
support for custom org-defined types. Adapters live in a registry:

```ts
type OntologyAdapter = {
  list(ctx, opts): Promise<Page<Record<string, any>>>;   // MUST filter by ctx.organizationId
  get(ctx, id): Promise<Record<string, any> | null>;
};
const ADAPTERS: Record<string, OntologyAdapter> = { missions, jobs, pipelines, datasets };
```

## 7. Actions & safety

- `effect: "read" | "write"`. Reads never gate; **writes with `requiresApproval` route
  through `decisionRouter.requestDecision`** (tool `ontology_action:<name>`, channels
  copilot + inbox, org-scoped). Approved → dispatch + persist the approval id on the
  audit row; denied → no mutation; timeout/snooze → `approval_required` for the caller
  to await. A gate error fails safe (treated as denied).
- `handlerKind` (all implemented):
  - `builtin` — a code-registered function (allow-listed via `registerBuiltin`),
  - `pipeline` — trigger a pipeline by id; the pipeline is **ownership-checked against
    `ctx.organizationId`** before `pipelineExecutor.executePipeline` runs (params become
    the initial variables),
  - `tool` — invoke a registered agent tool from `getAgentTools()` with an org-scoped
    `ToolContext`,
  - `sql` — a **named** handler registered via `registerSqlHandler` (org-scoped,
    parameterized; `handler_ref` names a vetted query — never raw SQL from params).
- **No arbitrary mutation.** Params are bound, never string-concatenated into SQL, and
  every write handler executes under `ctx.organizationId`.
- Full audit in `ontology_action_log` (actor, params, approval id, status, result).

## 8. Org-scoping & permissions

- Every query is filtered by `ctx.organizationId`; cross-org access is impossible by
  construction (the `orgId` is never a tool parameter).
- Super-admins may target another org via an explicit override (mirrors the chat route's
  `?orgId` handling), logged.
- Object-Type-level ACLs honor `ctx.permissions` / `ctx.resourceScoping`.
- **This closes the current no-scoping bug**: the three tools will thread `ToolContext`
  into `OntologyService`.

## 9. Assistant / tool integration

Rewrite `ontology-tools.ts`:
- Remove the module-load `OntologyService.bootstrap()` side effect.
- Pass `context` into every call: `ontologyService.listObjects(toCtx(context), objectType, …)`.
- Add `ontology_list_object_types` (discovery) and optionally `ontology_search`.
- Optionally inject the org's Object Type names into the copilot system prompt so it
  knows what it can query.

## 10. Rollout plan

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Schema for the new tables (`shared/schema/ontology/ontology.ts`, barrel-registered) + raw DDL migration `server/migrations/011_add_ontology.sql`. Applied to the dev DB (5433) and the test DB (5432). | ✅ done |
| 1 | DB-backed `OntologyService` (`ontology.service.ts`) + adapter registry (`ontology-adapters.ts`) with 30 `virtual` domain types including **users** (zero-trust identity projection), **teams** (hybrid human-agent squads), **missions**, **jobs**, **pipelines**, **operational_cycles**, **spatial_regions**, & **datasets**. Mock `TaskTicket`/`bootstrap()` removed. | ✅ done |
| 2 | `ontology-tools.ts` threads `ToolContext` → `OntologyCtx` (refuses missing org); module-load `bootstrap()` deleted; `ontology_list_object_types` discovery tool added. | ✅ done |
| 3 | Governed `executeAction` — audit log ✅; write gate ✅ routes through `decisionRouter.requestDecision` (approved → dispatch + record approval id; denied → no mutation, logged; timeout → `approval_required`). Handler dispatch ✅ for all four kinds: `builtin` (registry), `sql` (named-query registry — no raw SQL from params), `tool` (agent-tool registry, org-scoped ToolContext), `pipeline` (org-ownership-checked `pipelineExecutor.executePipeline`). | ✅ done |
| 4 | Auto-seed default Object Types on org creation ✅. Org-scoped HTTP API ✅ (`/api/ontology/*` — the router is mounted `app.use("/api", knowledgeRouter)` + `knowledgeRouter.use("/ontology", …)`). **Ontology Explorer** UI ✅ (`OntologyExplorer.tsx`, routed at `/knowledge/ontology`) — browses types/instances/actions and walks Link Types from the live API. | ✅ done |

**Virtual Adapters (30 Total):**
- **Core Execution**: `missions`, `mission_runs`, `jobs`, `pipelines`, `pipeline_steps`, `pipeline_runs`, `pipeline_step_runs`, `schedules`, `scheduled_jobs`, `operational_cycles`, `swarm_tasks`.
- **Actors & Hybrid Squads**: `users` (sanitized zero-trust identity projection), `teams` (hybrid human-agent squads with `humanMemberCount`, `agentMemberCount`, `leadUserId`, `homeH3Index`).
- **Data & Knowledge**: `datasets`, `knowledge_graph`, `saved_queries`, `calculations`, `transference_rules`, `prompt_versions`.
- **Apps & Projects**: `apps`, `app_deployments`, `approvals`, `alerts`, `projects`, `project_resources`, `project_events`.
- **Signals & Space**: `signals`, `predictions`, `surprises`, `spatial_regions`.

**Testing:**
- `server/domain/knowledge/tests/unit/ontology.test.ts` — pure gate logic (`requireOrg`
  isolation, param validation).
- `server/domain/knowledge/tests/integration/ontology.integration.test.ts` — live,
  DB-backed: seeds default types, and proves **materialized** multi-tenant isolation
  (org B cannot read org A's object) deterministically. Virtual-adapter *row* reads are
  verified against the migrated dev DB rather than the test DB, whose ambient domain
  tables (e.g. `missions`) are schema-drifted (missing `description`); the test asserts
  the virtual types are registered/wired.

## 11. Testing

- **Multi-tenant isolation (critical):** org A cannot list/get/act on org B's types,
  objects, or actions.
- Param validation against `parametersSchema`; missing/typed-wrong params rejected.
- Action authorization: write actions blocked without approval; audit row written.
- Adapter tests: each `virtual` adapter filters by org.
- Follow the existing `tests/**/*.test.ts` + `server/domain/**/*.test.ts` conventions.

## 12. Risks & open questions

- **Duplication vs. KG** — keep them distinct; use `kgNodeId` to bridge, don't merge.
- **Adapter surface** — start with 3–4 virtual adapters; each must be org-safe.
- **Action safety** — the governor gate on writes is mandatory; a bug here is a
  privilege-escalation path.
- **Perf** — index `(organization_id, object_type_id)`; cursor pagination on `listObjects`.
- **Open:** do we want per-object-type row-level ACLs beyond org scoping in v1, or defer?
```
