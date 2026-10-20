# System architecture

This maintained overview describes how the Node platform fits together. For setup,
see the [quickstart](../README.md#quickstart); for operational requirements, see
[production deployment](../README_DEPLOYMENT.md). The historical registry export is
preserved as an [August 2026 snapshot](reports/architecture-registry-snapshot-2026-08-25.md).
Registry statuses and generated metrics are not runtime health or security guarantees.

## Runtime components

| Component | Responsibility | Entry points and implementation |
| --- | --- | --- |
| React SPAs | Marketing, authentication, and operations interfaces | `client/*.html`, `client/src/entry/`, `shared/spa-routes.ts` |
| Node API | Express middleware, authentication, domain routes, static assets | `server/index.ts`, `server/core/bootstrap.service.ts`, `server/routes.ts`, `server/vite.ts` |
| Domain services | Missions, pipelines, CREW, knowledge, governance, apps, integrations | `server/domain/*`; some domains also own UI under `ui/` |
| Background workers | Queue consumers and asynchronous work | `server/worker-entrypoint.ts`, `server/domain/queue/workers.bootstrap.ts` |
| PostgreSQL | Durable application records, organization data, run state, credentials | `shared/schema/`, `server/database_service.ts`, `migrations/` |
| Redis | BullMQ queues and shared transient state | `server/domain/queue/`, development and production Compose |
| Qdrant (optional) | Vector retrieval and knowledge similarity | Compose configuration; enabled with `QDRANT_URL` |
| Python sidecar (optional) | Additional backend capabilities | `backend/`, `Dockerfile.python` |
| MCP server | Tool-facing platform entry point | `server/mcp/index.ts` |

`npm run dev:no-sidecar` starts the API and worker. `npm run dev` also starts the
Python sidecar. Production packages the API and workers into an image but runs
application roles as separate Compose services. See [development startup](dev-server.md)
for process lifecycle details.

## Browser request flow

1. The browser requests a page. `server/vite.ts` uses `shared/spa-routes.ts` to
   select its SPA in development and production. Prefixes match whole path segments.
2. The React interface calls the Node API. Middleware establishes authentication
   and organization context; routes validate requests and delegate to domain services.
3. Services read or write PostgreSQL through the data layer. Tenant-scoped queries
   must use the canonical organization conditions. A null organization means
   `IS NULL`, never an omitted filter.
4. Work requiring asynchronous execution is queued through the relevant domain's
   queue path and consumed by workers. Queues require Redis and active consumers;
   an accepted or queued response alone does not prove execution succeeded.
5. The UI obtains the resulting state through the feature's API and event paths.
   Durable run records and successful tool receipts provide execution evidence.

Keep top-level path prefixes and the destination router aligned. Operations paths
such as `/workspace`, `/admin`, and `/settings` belong in OperationsRouting; adding
only a route to another SPA leaves the mounted route unreachable.

## Missions, agents, and governance

Missions and pipelines coordinate execution through domain services and workers.
CREW records agent speech in `crew_turns`; successful calls in `tools_used` ground
claims about completed work. Claims, decisions and commitments derive from executed
tool results or approval-gated proposals rather than free-form agent prose.

Human approvals govern actions that need review. Embedded blueprint apps use the
[CREW runtime contract](platform/05-component-and-tooling-guides/blueprint-crew-runtime-contract.md)
for launched-mission receipts, surface approvals, and platform proxy calls. A queued
receipt without a run ID must not be displayed as a successful launch.

## AI and knowledge

AI clients resolve organization-owned provider credentials. Production rejects
shared provider keys; development can use the explicitly supported fallback.
Credentials are decrypted for execution through the credential service and secrets
must not be returned to clients. See [keys and credentials](developer-guides/KEYS_AND_CREDENTIALS.md).

PostgreSQL stores durable knowledge metadata and relationships. Qdrant supports
vector retrieval when configured. A missing optional service can disable a capability;
`server/config/env.ts` reports environment validation and degradations at boot.

## Generated applications and trust boundaries

App Forge creates workspaces from blueprints and generated code. Depending on the
app, build and startup paths use a local toolchain or a separate Docker runtime.
In development, local generated code runs with an allowlisted environment but
shares the platform user's filesystem and process namespace.

**Local tenant execution is blocked in production.** This includes install/build
scripts, compiler checks, workspace commands, generated Playwright tests, and
local app startup. Docker-backed execution requires a separately configured runtime
and validation of its isolation. See the [deployment boundary](../README_DEPLOYMENT.md#tenant-execution-boundary).
An environment allowlist and a Dockerfile are not, by themselves, an isolation guarantee.

Authentication, organization scoping, stored credentials, code execution, network
egress, and approval gates are distinct boundaries. Read the
[security boundary reference](SECURITY_BOUNDARIES.md) for the mechanisms and
[SECURITY.md](../SECURITY.md) for private vulnerability reporting.

## Deployment and durable state

The production proxy forwards to the API. TLS must be configured at ingress or the
load balancer. Migrations run before application roles start; files are applied
in migration-journal order. `npm run setup` provisions the first organization and
administrator without destructive reseeding.

Back up PostgreSQL and shared storage, including uploads and generated workspaces;
include vector data where used. An application image rollback does not automatically
roll back the database. See [deployment](../README_DEPLOYMENT.md) for commands and limitations.

## Making a change

Follow [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md). Search both
frontend roots, check actual callers and mounted routes, and run `npm run verify`.
Database integration checks are separate. Generated registry output belongs under
`docs/reports/`; architecture changes should update this overview deliberately.
