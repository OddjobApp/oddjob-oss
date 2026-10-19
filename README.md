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

You need Node.js 22.12 or later (`.nvmrc` pins 22), Docker (for Postgres and Redis),
and an API key from at least one model provider — Google Gemini is the default.

**Oddjob is bring-your-own-key.** It never runs AI on a shared platform key: each
organization stores its own provider key, encrypted, under Settings. In development a
`GEMINI_API_KEY` in `.env` is used as a fallback; in production it is refused. See
[Keys and credentials](docs/developer-guides/KEYS_AND_CREDENTIALS.md).

```bash
git clone <this repository> oddjob && cd oddjob
npm ci

# .env first: docker compose reads it, and refuses to start without the secrets.
cp .env.example .env
#   then fill in, under "Required to start":
#   SESSION_SECRET=<openssl rand -hex 32>
#   ENCRYPTION_KEY=<openssl rand -hex 32>
#   JWT_SECRET=<openssl rand -hex 32>
#   GEMINI_API_KEY=<your key>          # development fallback only
# DATABASE_URL and REDIS_URL already match the containers below.

# Postgres + Redis
docker compose up -d db redis

npm run setup          # applies migrations, then creates your organization and super-admin
npm run dev:no-sidecar # http://localhost:5000 — sign in with the admin email and password
                       # (npm run dev also starts the Python service: see below)
```

`npm run setup` is safe to re-run and on a database that already has data: it never
deletes or overwrites anything, applies only pending migrations, and creates an
account only while no super-admin exists. `npm run setup -- --dry-run` reports what
it would do over a read-only connection. Without a terminal (CI, containers) it
reads `ODDJOB_ADMIN_EMAIL`, `ODDJOB_ADMIN_PASSWORD` and optionally
`ODDJOB_ADMIN_USERNAME` and `ODDJOB_ORG_NAME`. With Docker:
`docker compose run --rm setup`.

### Optional services

Nothing below is needed to start. Each switches on a capability, and
`server/config/env.ts` logs at boot which ones are off and what that disables.

| To get | Run or set |
|---|---|
| Vector search (RAG retrieval, knowledge similarity) | `docker compose up -d qdrant`, then `QDRANT_URL=http://localhost:6333` |
| Background jobs (BullMQ workers) | Redis, already in the quickstart, plus `npm run start:worker` (`npm run dev` starts it) |
| Maps in location pickers and Signal Studio | `VITE_MAPBOX_ACCESS_TOKEN` (Mapbox's terms apply; see NOTICE) |
| Computer use on a real desktop | `docker compose --profile computer-use up -d`, then the `TRYCUA_*` settings in `.env.example` |
| Email in and out | `AGENTMAIL_API_KEY` and `AGENTMAIL_INBOX` |
| Web and phone push notifications | `VAPID_PRIVATE_KEY`; `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_FILE` |
| Local video generation | `COMFYUI_BASE_URL` |
| Google, Microsoft or Jira sign-in for connectors | `GOOGLE_CLIENT_ID`, `MICROSOFT_CLIENT_ID`, `JIRA_CLIENT_ID` and their secrets |
| Signed audit reports | `AUDIT_REPORT_SIGNING_SECRET` |
| The Python sidecar | see [Running the development server](#running-the-development-server) |

### Troubleshooting install

- **`npm ci` fails in `ffmpeg-static` with `ECONNRESET` or a timeout.** Its install
  step downloads an FFmpeg binary from GitHub releases. On a network that blocks
  that, run `npm ci --ignore-scripts`. That also skips Puppeteer's Chrome download
  (`npx puppeteer browsers install chrome` fetches it later); everything else
  installs, and only features that shell out to FFmpeg or launch that Chrome are
  affected.
- **The server listens on 8000, not 5000.** `PORT` is set in `.env`; remove it. The
  Python sidecar reads the same variable.

For a throwaway demo database with sample organizations and logins, see
[Database seeding](#database-seeding) — it is destructive by design.

## Documentation

- [Feature documentation](docs/feature-documentation/README.md) and the
  [feature index](docs/FEATURES.md) — what each part of the platform does.
- [Platform best practices](docs/platform/) — architecture, governance,
  UI standards, component guides and agent runbooks. The same articles are served
  in-app from the Best Practices page.
- [Blueprint app maturity](docs/guides/blueprint-maturity.md) — which App Forge
  blueprints are stable, beta or experimental, and why.
- [System architecture](docs/SYSTEM_ARCHITECTURE.md) and
  [deployment](README_DEPLOYMENT.md).
- [Contributing](CONTRIBUTING.md) and [working in this repository](AGENTS.md) —
  the gates to run before claiming something works.

The rest of this file covers running, testing and seeding a development install.

## Evaluating Oddjob

Start with **[First Mission In 10 Minutes](docs/guides/first-mission-in-10-minutes.md)**:
three demo paths (governed support triage, computer use with replay, and generating
an internal ops app), each with setup, expected outcome and success criteria.

These checks need no credentials and no running server:

```bash
npm run smoke:capabilities    # capability manifest is internally consistent
npm run smoke:autonomy-policy # safe/review/blocked cases classify consistently
npm run smoke:golden-path     # governed support-triage contract check
```

`smoke:golden-path` validates a fixture against the shared autonomy policy; it does
not execute a mission. `npm run demo:golden-path` runs that path for real against a
configured development database.

## Running the development server

`npm run dev` starts three processes: the Node server (`dev:server`), the job worker
(`start:worker`), and the Python service in `backend/` (`npm run backend`). The
Python service runs from a virtual environment at `backend/.venv`; create it once:

```bash
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt     # Windows: .venv\Scripts\pip
```

Without it, `npm run backend` stops with those instructions, and you can run
everything else with:

```bash
npm run dev:no-sidecar
```

The server has no hot reload: restart it to pick up server-side changes.

## Where things live

- `server/domain/*` — the server, one directory per domain (missions, pipelines,
  crew, knowledge, governance, tools, …). Some domains also carry UI under
  `server/domain/*/ui/`.
- `client/src/` — the main React client. Components live here **and** under
  `server/domain/*/ui/`, so search both.
- `shared/` — schema and types used by both sides; `migrations/` holds the SQL.
- `server/blueprints/apps/*` — the generated apps that run inside CREW.
- `backend/` — the optional Python service.

[AGENTS.md](AGENTS.md) records the conventions that are not visible from a single
file: org scoping, BYOK keys, routing and migrations.

## Testing

```bash
npm run playwright:install  # once: some unit tests launch a real Chromium
npm run verify              # the full gate: lints, tsc, unit tests, smoke, build
npm test                    # unit tests only
npx playwright test         # browser tests, against a running dev server
```

`npm run verify` needs no database, Redis or API key. A test that needs a live
service is an integration test and is named `*.integration.test.ts` (or sits under an
`integration/` directory), so the unit gate skips it. A unit test that only passes
with Redis or Postgres running is a bug; `lint:dead-mocks` catches the commonest
cause, a `vi.mock` whose path no longer exists.

### Integration tests

Integration tests need Postgres, Redis and Qdrant, as in CI's `integration` job.
They never use `DATABASE_URL` from `.env`: `tests/configure-test-environment.ts`
overwrites it and refuses any URL whose database name lacks a distinct `test`
segment.

```bash
npm run test:db:setup     # create, migrate and seed the test database (idempotent)

# Throwaway Redis and Qdrant: some suites delete Redis keys by pattern, so never
# point them at the Redis your dev server uses.
docker run -d --rm --name oddjob-test-redis -p 6391:6379 redis:7-alpine
docker run -d --rm --name oddjob-test-qdrant -p 6343:6333 qdrant/qdrant:v1.18.3

REDIS_URL=redis://127.0.0.1:6391 QDRANT_URL=http://127.0.0.1:6343 npm run test:integration

docker stop oddjob-test-redis oddjob-test-qdrant
```

Set `TEST_DATABASE_URL` in `.env.test` (gitignored) to point at the test database.

**Never hardcode a connection string in a test.** Any test that opens its own pool or
client must obtain the URL from `requireTestDatabaseUrl()`, which applies the same
test-database check and throws rather than falling back to a default.

If suites fail with `sorry, too many clients already`, the database has run out of
connection slots, usually because of orphaned `npm run dev` or worker processes from
earlier sessions, each holding a pool. Stop those first. This failure aborts a suite
during setup, so every test in it reports as *skipped* rather than failed.

## Database seeding

> **`db:seed` DESTROYS the target database.** It runs
> `TRUNCATE ... RESTART IDENTITY CASCADE` on `orgs`, `users`, `jobs`, `pipelines`,
> `apps`, `datasets` and more, cascading across the whole schema. It reads
> `DATABASE_URL`, which normally points at your **development** database.
>
> It refuses to run unless you opt in explicitly:
>
> ```bash
> ALLOW_DESTRUCTIVE_SEED=true npm run db:seed
> ```
>
> Use it only on a fresh or disposable database. For a real install, use
> `npm run setup` instead.

`duplicate key value violates unique constraint` during seeding means the truncate
did not cover a table your data already occupies. Resolve that specific conflict
rather than widening the truncate.
