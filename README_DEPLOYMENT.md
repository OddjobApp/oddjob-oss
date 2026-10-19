# Production deployment packaging

The root Dockerfile packages the Node API, workers, MCP server, SPA assets,
runtime migrations, blueprint and agent templates, platform documentation,
scaffold and block registries, and the
UI sources App Forge copies into generated applications. Chromium and
its system libraries are included for PDF generation and Forge vision. The
process runs as the `oddjob` user; templates remain read-only.

Run `npm run verify` before publishing. Build the release image with:

```sh
docker build -t ghcr.io/your-org/oddjob:release-sha .
```

The release workflow calls the reusable Verify Suite and makes image publishing
depend on its unit, integration, coverage, and schema-drift jobs. A separate
push-triggered verification run alone would not block deployment.

Real-server/database suites use the `.integration.test.ts` naming convention or
an `integration/` directory. They run with `npm run test:integration` using
`vitest.integration.config.ts`; positional CLI glob filters do not select these
files. Provision a dedicated `TEST_DATABASE_URL` with `npm run test:db:setup`
first. The `integration` CI job supplies disposable Postgres, Redis, and Qdrant.

The Python service is a separate image, built with
`docker build -f Dockerfile.python -t oddjob-python:release-sha .`.

The existing Qdrant server pin is 1.8.1, while the installed JS client is 1.18.
The client reports an unsupported version gap. Plan and validate a compatible
server/client upgrade against a snapshot of existing vector data before release;
the packaging changes retain the current server version.

## Compose

Set `GITHUB_REPOSITORY` and `IMAGE_TAG` to the published repository and immutable
release tag. Supply `DB_PASSWORD`, `SESSION_SECRET`, `ENCRYPTION_KEY`,
`INTERNAL_RPC_KEY`, `JWT_SECRET`, and `GRAFANA_ADMIN_PASSWORD` through the
environment or a local `.env` file. `DB_USER` defaults to `postgres`.
Use the formats and lengths documented in `server/config/env.ts`.
Do not supply shared AI provider keys: production requires organization BYOK.

Optional `QDRANT_API_KEY` is passed to Qdrant and both application roles;
production's published Qdrant port binds to localhost. Configure Node SMTP in
System Settings and set `EMAIL_ENABLED=true` for approval email notifications.
The Python service's `SMTP_*` variables do not configure Node email.

```sh
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up -d
```

Compose runs migrations before starting the API and worker. On a new database,
create the first organization and super-admin once — sign-up gives new users no
organization, so without this nobody can get in:

```sh
docker compose -f docker-compose.prod.yml run --rm \
  -e ODDJOB_ADMIN_EMAIL=you@example.com -e ODDJOB_ADMIN_PASSWORD='…' \
  --entrypoint "node dist/setup.js" oddjob
```

It is idempotent: once a super-admin exists it creates nothing, and it never
modifies existing rows. Append `--dry-run` for a read-only report.

The production proxy uses `nginx/nginx.prod.conf` and routes to `oddjob:5000`. `/nginx-health`
checks the proxy; `/api/health` checks the API. `/pulse` returns 503 because this
stack does not include the optional ingestor. Configure TLS at the ingress or
load balancer; the supplied proxy configuration serves HTTP.

The API and worker share named volumes for uploads, logs, and `/app/storage`.
Storage includes generated Forge workspaces and build caches; retain and back
up this volume alongside the database. Docker-backed Go/Python/Java blueprint
execution additionally requires a configured Docker runtime: the supplied image
and Compose stack do not provide a Docker CLI or daemon connection.

Production tenant execution remains a release blocker. Apps without a Dockerfile
can fall back to `localProcessService`, which launches tenant code with the
platform process's user and process namespace. The environment allowlist does
not provide isolation: a controlled child-process probe could read the parent's
environment through `/proc/1/environ`. Require an isolated tenant runtime before
enabling generated app execution in production, including install/build steps.

For updates to an existing deployment, run `bash scripts/deploy-production.sh`.
It backs up the running database, saves the current application image, keeps
data services running, applies migrations, and checks the new API. A failed API
health check restores the saved application image. Rollback does not restore
the database automatically: migrations must be backward-compatible. A single
Compose API instance may experience interruption during recreation.

Staging uses `docker-compose.staging.yml`, a separate database, and the same
production runtime mode (`NODE_ENV=production`). Do not run staging and
production with overlapping host ports on the same machine.

## Kubernetes CI migrations

Provision an `oddjob-secrets` Secret with a `DATABASE_URL` key in each deployment
namespace. CI calls `scripts/run-k8s-migrations.sh` with the namespace and release
image. It creates a release-specific Job, references that Secret, and waits for
completion before updating the application. Failed Jobs retain logs for one day
and block deployment. The helper requires Node and kubectl plus GitHub Actions'
`GITHUB_SHA`, `GITHUB_RUN_ID`, and `GITHUB_RUN_ATTEMPT` variables.

CI publishes a lowercase repository name with the full commit SHA tag, and
passes that same immutable reference to image scanning, migrations, and rollout.
For private registry images, configure namespace service-account image-pull
credentials for both application pods and migration Jobs.

The CI deployment/service names must already exist in the target cluster. The
base Kustomize resources use `oddjob-api` and `oddjob-worker`; CI's existing
blue/green deployments are a separate topology.

## Switching the primary model

`dist/scripts/switch-primary-model.js` (source `server/scripts/switch-primary-model.ts`)
moves the platform from one model to another: for each `llm_models` row of the old
model (per org, and shared rows) it adds or reuses a row for the new model with the
same provider and limits, rebinds agent cards bound to the old row, and moves the
org default only where the old model was the default. The old rows stay usable.
It runs in one transaction and is a **dry run unless `--apply` is passed**; a second
run changes nothing. It prints the database host first, so check it.

```sh
# Compose: dry run, then apply (defaults: claude-opus-5-5 -> claude-sonnet-5-5)
docker compose -f docker-compose.prod.yml exec oddjob node dist/scripts/switch-primary-model.js
docker compose -f docker-compose.prod.yml exec oddjob node dist/scripts/switch-primary-model.js --apply

# Kubernetes
kubectl -n <namespace> exec deploy/oddjob-api -- node dist/scripts/switch-primary-model.js
kubectl -n <namespace> exec deploy/oddjob-api -- node dist/scripts/switch-primary-model.js --apply

# Other models or one org
node dist/scripts/switch-primary-model.js --from claude-opus-5-5 --to claude-sonnet-5-5 --org 291 --apply
```

The new model needs a price in `server/domain/ai/core/cost-registry.ts` (the script
warns when it has none) and a provider key for each org that uses it. No restart is
needed: model resolution reads the database on every round.
