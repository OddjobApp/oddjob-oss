# Oddjob

Oddjob lets you spin up teams of AI agents that plan and execute multi-step work as
missions, cycles, and pipelines — extracting knowledge, running research, generating
documents and datasets, and completing tasks end to end. It can build and deploy
working software and mini-apps on demand through App Forge, stand up org and team
structures through Org Forge, and turn a document template into a live form agent
that captures a structured schema automatically. It grounds every agent in your own
data with retrieval-augmented generation, a knowledge graph, and reusable templates,
and routes work through configurable LLM providers with automatic failover to a local
model when a provider is unavailable.

Licensed under [Apache 2.0](LICENSE). Security reports: see [SECURITY.md](SECURITY.md).

## Quickstart

You need Node.js 20+, Docker (for Postgres and Redis), and an API key from at least
one model provider — Google Gemini is the default.

**Oddjob is bring-your-own-key.** It never runs AI on a shared platform key: each
organization stores its own provider key, encrypted, under Settings. In development a
`GEMINI_API_KEY` in `.env` is used as a fallback; in production it is refused. See
[Keys and credentials](docs/developer-guides/KEYS_AND_CREDENTIALS.md).

```bash
git clone <this repository> oddjob && cd oddjob
npm ci

# Postgres + Redis
docker compose up -d db redis

# .env — the server validates these at boot (server/config/env.ts)
#   DATABASE_URL=postgresql://postgres:postgres@localhost:5433/oddjob
#   REDIS_URL=redis://localhost:6379
#   SESSION_SECRET=<32+ random characters>
#   ENCRYPTION_KEY=<32+ random characters>
#   GEMINI_API_KEY=<your key>          # development fallback only

npm run setup         # applies migrations, then creates your organization and super-admin
npm run dev           # http://localhost:5000 — sign in with the admin email and password
```

`npm run setup` is safe to re-run and on a database that already has data: it never
deletes or overwrites anything, applies only pending migrations, and creates an
account only while no super-admin exists. `npm run setup -- --dry-run` reports what
it would do over a read-only connection. Without a terminal (CI, containers) it
reads `ODDJOB_ADMIN_EMAIL`, `ODDJOB_ADMIN_PASSWORD` and optionally
`ODDJOB_ADMIN_USERNAME` and `ODDJOB_ORG_NAME`. With Docker:
`docker compose run --rm setup`.

`server/config/env.ts` logs, at boot, every capability a missing variable switches
off. For a throwaway demo database with sample organizations and logins, see
[Database seeding](#5-database-seeding) — it is destructive by design.

## Documentation

- [Feature documentation](docs/feature-documentation/README.md) and the
  [feature index](docs/FEATURES.md) — what each part of the platform does.
- [Platform best practices](docs/platform/) — architecture, governance,
  UI standards, component guides and agent runbooks. The same articles are served
  in-app from the Best Practices page.
- [System architecture](docs/SYSTEM_ARCHITECTURE.md) and
  [deployment](README_DEPLOYMENT.md).
- [Contributing](CONTRIBUTING.md) and [working in this repository](AGENTS.md) —
  the gates to run before claiming something works.

The rest of this file is the developer's setup and troubleshooting guide.

## 0. Start Here (Evaluators)

If you are evaluating Oddjob rather than developing it, start with the guided walkthrough:

**[First Mission In 10 Minutes](docs/guides/first-mission-in-10-minutes.md)** — three demo paths (governed support triage, computer use with replay, generate an internal ops app), each with setup, expected outcome, and success criteria.

For a no-setup readiness check that requires no credentials and no running server:

```bash
npm run smoke:capabilities    # capability manifest is internally consistent
npm run smoke:autonomy-policy # safe/review/blocked cases classify consistently
npm run smoke:golden-path     # governed support-triage contract check
npm run demo:golden-path      # database-backed mission/approval/resume execution
```

Note that `smoke:golden-path` is a deterministic contract check over a fixture — it
validates the scenario and re-evaluates the shared autonomy policy, but it does not
execute a mission. Path A of the walkthrough above is the real end-to-end run.
The separate `demo:golden-path` command automates that path against a configured
development database and labels its output separately from fixture validation.

## 1. Initial Setup

To get started with the project, ensure you have Node.js (>=20) and Python with a virtual environment configured.

## 2. Platform Architecture Overview

Oddjob is a distributed multi-agent autonomous system built around modular domain services:

- **Swarm Task Marketplace** (`server/domain/swarm/`): Decentralized task bidding, capacity management, and worker payout settlement.
- **Knowledge Engine & Graph RAG** (`server/domain/knowledge/`): Semantic memory, entity extraction, and multi-hop graph retrieval.
- **Xray Platform Composition** (`server/domain/xray/`): Real-time event-driven architecture indexing and spec fingerprinting.
- **Mission Orchestration** (`server/domain/mission/`): Dynamic execution engine with thinking traces and post-execution critique.
- **AI Intervention Engine** (`server/domain/ai/`): Steering vector control, model policy distillation, and memory snapshot management.
- **Cycle Blueprint Builder** (`server/routes/cycle-builder-drafts.ts`): Operational cycle planning, visual node flow graph, and optimistic draft governance.

## 3. Running the Development Server

To start the development server, use the following command:

```bash
npm run dev
```

This command runs the server, worker, and backend processes concurrently.

**Note on Backend Logging:**
The `backend` process's output is directed to console logs.

## 4. Testing & Verification

Run unit, integration, and E2E test suites with the following commands:

```bash
# Run unit & schema tests
npm test

# Run architecture lint check
npx tsx scripts/lint-architecture.ts

# Run Playwright E2E contract tests
npx playwright test
```

## 5. Database Seeding

> **⚠️ `db:seed` DESTROYS the target database.** It runs
> `TRUNCATE ... RESTART IDENTITY CASCADE` on `orgs`, `users`, `jobs`, `pipelines`,
> `apps`, `datasets` and more, cascading across the whole schema. It reads
> `DATABASE_URL`, which in normal development points at your **development**
> database — so running it wipes real local data, not just the seed tables.
>
> Because of that it refuses to run unless you opt in explicitly:
>
> ```bash
> ALLOW_DESTRUCTIVE_SEED=true npm run db:seed
> ```
>
> Use it on a fresh or disposable database. If you only need the `componentIndex`
> table populated, prefer a targeted script over a full re-seed.

The `componentIndex` table, which powers the `/knowledge/components` display, needs to be populated with data.

**Troubleshooting Seeding Issues:**
`duplicate key value violates unique constraint` during seeding means the truncate
did not cover a table your data already occupies — resolve the specific conflict
rather than widening the truncate.

## 5a. Running tests against a database

Integration tests need their own database. They never use `DATABASE_URL` from
`.env`: `tests/configure-test-environment.ts` overwrites it and refuses any URL whose
database name lacks a distinct `test` segment.

```bash
npm run test:db:setup     # create + migrate + seed the test database (idempotent)
```

Set `TEST_DATABASE_URL` in `.env.test` (gitignored) to point at it.

**Never hardcode a connection string in a test.** Two audit suites once embedded the
development database URL and inserted rows straight into it. Any test that opens its
own pool or client must obtain the URL from `requireTestDatabaseUrl()`, which applies
the same test-database check and throws rather than falling back to a default.

If suites fail with `sorry, too many clients already`, the database has run out of
connection slots — usually orphaned `npm run dev` / worker processes from earlier
sessions, each holding a pool. Reap those first; note that this failure aborts a suite
during setup, so every test in it reports as *skipped* rather than failed.

## 6. Component Indexing

The `/api/capabilities/component-index/search` API endpoint powers component lookup across platform blocks.

**Key Features:**
- Default `minEffectiveness` filter set to `0.0` to ensure complete visibility.
- `searchComponentIndex` handles filtering across category, query string, and effectiveness.

---

This documentation is updated alongside project evolutions. Refer to [`docs/FEATURES.md`](./docs/FEATURES.md) and [`docs/SYSTEM_ARCHITECTURE.md`](./docs/SYSTEM_ARCHITECTURE.md) for detailed reference specs.
