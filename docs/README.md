# Oddjob documentation

Start with the [repository quickstart](../README.md#quickstart), then run your
[first mission](guides/first-mission-in-10-minutes.md). Oddjob uses organization-owned
AI provider keys; Google Gemini is the default.

## Getting started

- [Install and start a development instance](../README.md#quickstart).
- [Run your first mission](guides/first-mission-in-10-minutes.md): setup, expected
  outcomes, and the distinction between fixture checks and a live mission.
- [Keys and credentials](developer-guides/KEYS_AND_CREDENTIALS.md): connect an
  organization's provider and understand production BYOK.
- [Blueprint maturity](guides/blueprint-maturity.md): stable, beta, and experimental
  App Forge templates.

Local generated-app install/build steps, compiler checks, tests and startup are
blocked in production. Read the [tenant execution boundary](../README_DEPLOYMENT.md#tenant-execution-boundary)
before deploying or evaluating App Forge with untrusted code.

## User guides

- [Feature documentation](feature-documentation/README.md): workflows and feature references.
- [Feature index](FEATURES.md): a broader inventory of capabilities.
- [Platform guides](platform/): architecture practices, governance, UI standards,
  component guides, and agent runbooks also served in-app.
- [Cycles](CYCLES.md) and [App Forge lifecycle](APP_FORGE_LIFECYCLE.md).

Feature references describe particular surfaces; they do not imply every capability
is enabled in a fresh install. Check each guide's prerequisites and maturity notes.

## Contributor guides

- [Contributing](../CONTRIBUTING.md): development workflow and required checks.
- [Repository rules](../AGENTS.md): tenant boundaries, migrations, routing, and BYOK.
- [System architecture](SYSTEM_ARCHITECTURE.md): runtime components and request flow.
- [Developer guides](developer-guides/README.md) and [API/schema specs](specs/).

Run `npm run verify` before claiming a change works. Database-backed integration
checks require separately provisioned test services; see [testing](../README.md#testing).

## Operations and security

- [Production deployment](../README_DEPLOYMENT.md): image packaging, migrations,
  first administrator, tenant execution limitations, updates, and rollback.
- [Development server](dev-server.md): startup processes and troubleshooting.
- [Security policy](../SECURITY.md): supported versions and private reporting.
- [Security boundaries](SECURITY_BOUNDARIES.md): enforcement mechanisms and code references.
- [Database migrations](developer-guides/DATABASE_MIGRATION_GUIDE.md).

## Historical and planning material

[Archive](archive/), [history](history/), [proposals](proposals/), [platform RFCs](platform-rfcs/),
[strategy](strategy/), and [reports](reports/) contain designs, investigations,
snapshots, and plans. Their presence is not evidence that a feature is shipped or
that a reported status remains current. Root-level roadmap, plan, and implementation
summary documents should be read with the same care.

The [August 2026 architecture registry snapshot](reports/architecture-registry-snapshot-2026-08-25.md)
is historical. The Evolution Engine writes new registry output to
`docs/reports/generated-architecture-registry.md`; it does not overwrite the
maintained architecture overview.
