# Universal Resource Catalog / Operational Ontology

Oddjob exposes a read-only, organization-aware catalog for platform nouns that show up across cycles, missions, pipelines, jobs, data, knowledge, apps, schedules, forms, approvals, and credentials.

The catalog normalizes existing tables into one typed inventory with actions, capabilities, governance hints, health, schema summaries, and relation edges. It is a platform spine, not a replacement source of truth.

## Endpoints

```http
GET /api/resource-catalog/ontology
```

Returns resource types, lifecycle values, relation types, and per-type definitions.

```http
GET /api/resource-catalog/resources
GET /api/resource-catalog/resources?types=mission,pipeline&search=renewal&limit=25
GET /api/resource-catalog/resources?type=dataset&lifecycle=active
GET /api/resource-catalog/resources/mission:123
```

Returns normalized resources visible to the authenticated user's org context.

```http
GET /api/resource-catalog/graph/mission:123
GET /api/resource-catalog/graph/credential:5?maxDepth=2
```

Returns a bounded neighborhood graph with visible incoming and outgoing derived/persisted edges: `{ root, nodes, edges, maxDepth, truncated, generatedAt }`.

```http
GET /api/resource-catalog/edges?key=mission:123
POST /api/resource-catalog/edges
DELETE /api/resource-catalog/edges/:id
```

Curated ontology edges are org-scoped. `POST` accepts `{ sourceType, sourceId, targetType, targetId, relationType, label?, metadata? }`. Both endpoints are re-resolved through the catalog before writing, so the edge API cannot be used to probe for resources outside the caller's org context. Duplicate edge creates are idempotent.

```http
GET /api/resource-catalog/impact/credential:5
GET /api/resource-catalog/impact/dataset:3?maxDepth=2&relationTypes=depends_on,uses
```

Runs bounded downstream impact analysis over incoming derived and persisted edges. Results include `{ root, maxDepth, nodes, edges, truncated }`. `truncated` means the traversal hit `maxDepth`, the internal node cap, or the service-side per-type scan cap. Edges never point to nodes outside the returned graph.

```http
GET /api/resource-catalog/intent?query=pause%20the%20renewal%20risk%20sweep%20mission
GET /api/resource-catalog/intent?query=execute%20the%20reconciliation%20pipeline&types=pipeline&limit=3
```

Returns ranked `(resource, action)` matches. Matching is deterministic and lexical, with explicit verb aliases such as "execute" to `run`, "inspect" to `view`/`audit`, and "turn off" to `disable`. High-risk/destructive matches include a Phase 4 blast-radius hint.

```http
GET /api/resource-catalog/health
GET /api/resource-catalog/health?types=credential,app_deployment&limit=20
```

Returns org-wide health rollups: `{ summary, byHealthState, needsAttentionCount, needsAttention, possiblyTruncatedTypes, generatedAt }`.

## Resource Shape

Every resource uses a common shape:

```ts
{
  key: "mission:123",
  type: "mission",
  id: "123",
  name: "Renewal Risk Sweep",
  description: "Find renewal risk before QBR",
  status: "active",
  lifecycle: "active",
  riskLevel: "medium",
  organizationId: 7,
  tags: ["governed", "scheduled"],
  capabilities: ["agentic_execution", "mission_memory"],
  actions: [{ id: "run", method: "POST", href: "/api/missions/123/launch-mission", params: { location: "body", fields: [] } }],
  relations: [{ type: "scheduled_by", targetType: "schedule", targetKey: "schedule:10" }],
  schema: {},
  health: { state: "healthy" },
  governance: { policyId: "4", requiresApproval: false },
  metadata: {}
}
```

## Coverage

- `cycle` and `cycle_blueprint`
- `mission` and `mission_run`
- `pipeline` and `pipeline_step`
- `job`
- `dataset`
- `knowledge_topic` and `knowledge_document`
- `document_template`
- `hil_form` and `approval_request`
- `app` and `app_deployment`
- `schedule`
- `credential`
- `slack_workspace`

## Implementation Notes

- `resource_edges` is org-scoped and has a unique index on `(organizationId, sourceType, sourceId, relationType, targetType, targetId)`.
- `ResourceEdgeService` rejects unknown types, unknown relations, blank endpoint ids, and self-loops. It returns an existing edge for duplicate creates.
- Impact, intent, and health scans use a larger internal `perTypeLimit` so they are not affected by the public API's final-result `limit` semantics.
- `ResourcePicker`, `ResourceWiringCanvas`, and `ResourceHealthDashboard` ship as embeddable components under `client/src/components/resource-catalog/`.
- The canvas reads the graph endpoint so dependency-heavy resources such as credentials and datasets show incoming usage, not only outgoing relations.
- The canvas can create/delete curated edges, while derived edges remain read-only.

## Security Notes

- Catalog reads use the existing authenticated org context.
- Shared/global resources can appear alongside org resources where existing tables allow `organizationId = null`.
- Org-scoped resources such as deployments, credentials, and persisted edges do not fall back to global visibility.
- Credentials are redacted. The catalog exposes only handle-level fields such as name, type, owner, and sensitivity. It does not expose environment variable names, metadata, hashes, tokens, encrypted values, or secrets.
- App deployments do not expose password hashes, webhook secrets, encrypted app tokens, or raw config.
- `slack_workspace` resources never select `botToken`, `userToken`, or `webhookUrl` into JS memory; only team/channel/notification-setting metadata is exposed.

## Action Hrefs and Params

Every `ResourceAction` emitted by a collector now points at a verified, real backend route (no more
fabricated or product-intent-only hrefs). Where a domain has no single-resource `GET /:id` route,
`view` falls back to the catalog's own `GET /api/resource-catalog/resources/:key` endpoint
(`knowledge_topic`, `knowledge_document`, `credential`, `app_deployment`). A few actions with no real
backend route at all were dropped outright rather than fabricated: `document_template`'s "render"
(no render/generate route exists yet) and `knowledge_document`'s "index" (only a bulk
`POST /api/knowledge/documents/reindex` exists, no per-document route).

Actions with a known, verified request body now carry a `params` schema (`ResourceAction.params`:
`{ location?: "body" | "query", fields: ResourceActionParamField[] }`) so a generic UI can render a
form before invoking the action, instead of guessing at the shape. Actions with no body, or whose
body is intentionally a passthrough the catalog can't statically describe (e.g. a HIL form's own
submission schema), omit `params` or use the `"json"` field type for the free-form portion.

`RESOURCE_TYPE_DEFINITIONS.defaultActions` per type now matches exactly what each collector's
`actions[]` is verified to emit (covered by a regression test in `tests/unit/resource-catalog.test.ts`).
Generic consumers should still prefer each resource's own `actions[]` over `defaultActions`, since
`defaultActions` is a type-level default, not a per-resource guarantee (e.g. an org without
HIL enabled may not get a `submit` action on a given form).

`collectAppDeployments` uses an explicit column projection rather than `select()`. The three secret
columns (`accessPasswordHash`, `webhookSecret`, `appTokenHash`) are never read into JS memory; only
SQL-computed `hasAccessPassword` / `hasWebhookSecret` / `hasAppToken` booleans are selected.

`getResourceByKey` issues a single id-filtered query against the resource's own collector (via an
optional `idFilter` parameter threaded through every `Collector`), rather than fetching a full page
of resources and doing a JS `.find()`.

## Dependency impact in resource details (September 6, 2026)

Credential details and Mission Detail now embed `ResourceImpactPanel`. It reads the
existing impact endpoint for the selected organization with `maxDepth=3`, groups
direct incoming relationships under **Used by**, and groups more distant resources
under **Indirectly affected**. Credential editing labels the panel **Affected work**.

The panel exposes refresh and retry actions, identifies truncated results, and
describes failed lookups as unknown impact rather than an empty dependency list.
Empty results mean no incoming relationships were found in the scanned catalog;
they do not prove that changing a resource has no external consequences.

Coverage: `tests/feature-relationships/ui/RelationshipPanels.test.tsx`.

## Previously resolved catalog gaps

None currently tracked. The four gaps from the previous check-in (action params schema, stale
`defaultActions`, `collectAppDeployments` column projection, `getResourceByKey` id queries) are
resolved above.
