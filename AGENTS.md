# Working in this repository

Practical notes for anyone — human or agent — changing code here. `CONTRIBUTING.md`
covers the controller/service pattern; this file covers the things that are not
visible from reading a single file, and that have each cost real debugging time.

## Run the gates before you claim something works

```bash
npm run verify     # journal + idempotency + theme + arch lint + domain drift
                   # + build:packages + tsc + unit tests + smoke + build
```

`verify` is the gate. Two things it deliberately does not include:

- **Coverage thresholds.** `vitest.config.ts` declares them (lines 70, functions
  65, branches 60, statements 70); they run in the `coverage` job in
  `.github/workflows/verify.yml`, not locally, because the suite runs with
  `fileParallelism: false` and a local instrumented run takes the better part of
  an hour.
- **Anything needing a database.** `npm run smoke` is the hermetic half of the
  smoke set; `npm run smoke:db` is the half that needs `DATABASE_URL`, and runs
  in the `schema-drift` CI job which provisions Postgres.

Integration tests need a provisioned database: `npm run test:db:setup`, then
`npm run test:integration`. They refuse to run against a non-test database —
`requireTestDatabaseUrl()` in `tests/configure-test-environment.ts` exists
because tests once wrote into the development database.

## A gate that silently does not run is worse than no gate

This is the single most repeated defect in this repo's history, in four
different forms:

- CI branch filters were an allowlist of branch prefixes, so work on
  `refactor/**` got no verify run at all. Both workflows now use
  `branches-ignore`.
- `vitest`'s `include` was an allowlist of server subdirectories; four
  directories landed with tests that matched no pattern and reported green while
  running zero tests. It now covers `server/**` by default.
- `lint:arch` matched files by suffix, which exempted all 110 files in
  `server/routes/`, and certified the codebase clean over 328 direct db calls.
- Coverage thresholds were configured and never evaluated.

The lesson generalises: when you add a check, verify it actually selects the
files you think it does. Prefer a denylist to an allowlist.

## Two frontend roots

Components live in **both** `client/src/` and `server/domain/*/ui/`. A grep
confined to `client/src` will miss the mounted copy of a component. `@` resolves
to `client/src` from both roots. The shadcn primitives under
`server/domain/core/ui/components/ui/` are re-export shims of the `client/src`
ones — do not edit them as if they were independent.

## Multi-SPA routing

`shared/spa-routes.ts` chooses which router serves a path, for both the dev
server and production (`server/vite.ts` calls it from each). Paths under
`/workspace`, `/admin`, `/settings` and the rest of the operations list go to
**OperationsRouting**; the same routes declared in CoreRouting are dead. A new
top-level route needs a prefix in `shared/spa-routes.ts` plus a route in the
correct router — get the router wrong and you see NotFound while the sidebar and
breadcrumb still update. Prefixes match whole segments: `/app` never matches
`/apps`.

## Org scoping is a security boundary

Use `getOrgConditions` from `server/utils/org-conditions.ts` — it is canonical,
and rival copies have been deleted. Never write
`orgId != null ? eq(col, orgId) : undefined`: Drizzle treats `.where(undefined)`
as **no filter**, so a null org returns every tenant's rows. For a null org the
correct condition is `col IS NULL`.

`OrgContext.organizationId` is `number | null`. Use `requireOrgId()`
(`server/utils/auth-context.ts:235`) rather than `!`, and never `|| 1`.

## Secrets: strict BYOK and stored credentials

Full detail: `docs/developer-guides/KEYS_AND_CREDENTIALS.md`. The rules:

- **AI is strict BYOK.** Production refuses to boot with a shared provider key
  (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `FAL_KEY`, …) and runs no AI on a
  platform key. Never read one from `process.env`: pass
  `developmentProviderKey()` to the org-aware `AIClientFactory` client, or use
  `resolveOrgGeminiKey(orgId)` when you build your own client or gate a feature.
  `lint:shared-ai-keys` enforces it with a baseline of 0.
- **Never gate a feature on a platform key.** `if (!process.env.GEMINI_API_KEY)
  return` switched features off for every customer in production while tests
  passed. Gate on the organization's key.
- **Credentials hold their own secret.** Read one with
  `await resolveCredentialSecret(credential)`; never `process.env[credential.envVarName]`.
  Load one for a job or tool with `credentialsService.getForExecution(id, orgId)`
  — `getById(id, org, true)` drops the org filter and can load another tenant's
  credential.
- **Never return a secret.** `credentialsService.list` and create/update return
  `PublicCredential` (secret metadata stripped, `secretSource` instead).
- **User code runs sandboxed in production**, whatever the job config says.
- **Tenant code never gets the server's environment.** A generated app, its
  `npm install`/build, or any process running tenant-authored code starts with
  `tenantProcessEnv(...)` — an allowlist — never `{ ...process.env }`.

## Migrations

Every migration needs an entry in the journal — `npm run check:migration-journal`
enforces it, and the runtime migrator applies files by journal `when` ordering,
not by file hash. A table declared in `shared/schema` with no migration behind it
passes tsc and every unit test and fails on the first real query; the
`schema-drift` CI job exists specifically to catch that.

## Environment

`server/config/env.ts` validates at boot. It fails the boot on a fatal
misconfiguration and **logs every capability that a missing variable silently
switches off** — AI inference, audit-report signing, queues, vector search. If
you add a variable whose absence degrades a feature rather than erroring, add it
to the `degradations` list there, or the degradation will be invisible.

Note that `.env.example` is largely the Python `backend/` service's surface
(`PORT=8000`, `JWT_SECRET_KEY`, `SMTP_*`). The Node server's own variables —
`SESSION_SECRET`, `ENCRYPTION_KEY`, `GEMINI_API_KEY` — are documented in
`server/config/env.ts`.

## Built but never wired

Recurring failure mode: a subsystem is fully implemented and nothing calls it.
Real examples found in this tree — a decomposed `CredentialDetail` whose forms no
route imported while the 1,305-line original stayed live; `initializeCircuits()`
with no caller; feed polling with a single manual route and no scheduler; zod
schemas for MCP handlers with zero importers.

So when a feature "exists", check its callers before believing it runs:

```bash
rg 'thingName' --type ts -l          # who imports it
rg 'lazy\(\(\) =>' --type tsx        # a plain grep misses lazy imports
```

Presence of a row, a testid, or a non-null id column is not proof the thing
works — those have each lied here before.

## CREW turn grounding

`crew_turns.tools_used` is the ground truth for what an agent did — the turn's
prose is not. Before a turn posts, `detectEvasion` checks the draft against the
calls that actually succeeded, and `repairEvasion` rewrites or replaces a draft
that claims work that did not run. Two traps when editing this path:

- A capability that returns an error string or JSON instead of throwing must be
  classified `ok: false` in `crew-tools.service.ts`, or the evasion check will
  treat a failure as evidence.
- The external-research retry in `runToolPasses` only accepts calls listed in
  `EXTERNAL_CALLS` (`google_search`, `browse_web`, `attach_url`). A new
  external-fetch tool must be added there, or a correct call is discarded and
  retried with the search declarations.

The same split holds for durable state: `crew_turns` holds speech,
`crew_claims`/`crew_decisions`/`crew_commitments` are written from executed
tool results or approval-gated proposal tools, never from agent prose.

## Blueprint apps and CREW surfaces

Every blueprint under `server/blueprints/apps/*` is a governed embedded surface
inside CREW, and the contract drifts silently: the same missing-check bug once
needed backporting to twelve `platform-client.ts` files at once.
`server/domain/apps/platform/blueprint-crew-contract.test.ts` is the hermetic
gate — run it after touching any blueprint. It enforces, per blueprint:

- Any `lib/platform-client.ts` that calls `/missions/trigger` must wrap the
  receipt in `requireLaunchedMission` — a `{ runId: null, status: "queued" }`
  response is not a launched run and must never render as success.
- Every `platform-client.ts` needs a matching `/api/oddjob/[...path]` proxy
  route (`pages/api/oddjob/[...path].ts` or `app/api/oddjob/[...path]/route.ts`)
  — without it calls only fail in deployment, where dev-server proxying hid it.
- Every app referenced in `server/cycles/*.cycle.yaml` must resolve a non-null
  `surfaceAdapters()` contract; declare `integration_dependencies` in the cycle
  YAML rather than editing the fallback tables.
- Collections in `IMMUTABLE_DECISION_COLLECTIONS` (gates, sign-offs, approvals)
  reject `PUT`/`DELETE` — corrections append a new decision, never edit in place.

The full contract — `window.oddjobCrew`, `crew-app-view`, `crew-surface-request`,
bound surface approvals, mounted-app grounding — is documented in
`docs/platform/05-component-and-tooling-guides/blueprint-crew-runtime-contract.md`.

## AI provider

Default to Google Gemini. `GEMINI_API_KEY` and `GOOGLE_API_KEY` are treated
interchangeably in most call sites; check both when debugging an auth failure.
