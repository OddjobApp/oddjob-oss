# Sales Pipeline Management

Date: July 2, 2026
Status: Phase 1 foundation in progress

## Current App Portfolio Fit

Oddjob already has one sales-specific app blueprint: `server/blueprints/apps/sales-opportunity-workbench`. It is a Next.js shared-server workbench wired to the platform through `app/api/oddjob/[...path]/route.ts`, which forwards browser calls to `/api/platform/app/*` using `ODDJOB_APP_TOKEN`.

The workbench is still backed by app-record dataset collections. A first-class sales domain foundation now exists in `shared/schema/sales.ts` and `server/domain/sales/core/sales-domain.service.ts`, but the workbench has not yet been migrated onto those durable `sales_*` tables.

## Durable Sales Domain Foundation

Implemented platform schema:

- `sales_accounts`
- `sales_contacts`
- `sales_leads`
- `sales_opportunities`
- `sales_activities`
- `sales_stage_history`
- `sales_opportunity_windows`
- `sales_window_snapshots`
- `sales_forecasts`
- `sales_quotas`
- `sales_recommendations_domain`

Implemented service facade:

- `createAccount`
- `createContact`
- `createLead`
- `createOpportunity`
- `advanceOpportunityStage`
- `listOpenOpportunities`
- `logActivity`

The schema is org-scoped and intentionally table-prefixed with `sales_*` to avoid colliding with current app-record collection ids such as `opportunities` and `sales_recommendations`.

## Implemented Workbench Surfaces

- `/pipeline`: stage board for open opportunities, live window ceilings, stage advancement, stage history writes, activity writes, and manual decay sweep trigger.
- `/opportunities`: opportunity register, lead intake, qualification mission trigger, semantic deal search, activity logging, and window snapshot history.
- `/forecast`: live weighted pipeline rollup, quota table, calibration chart, forecast generation trigger, and forecast review trigger.
- `/alerts`: sales recommendation queue, deal risk scan trigger, and pending HIL decision gates.
- `/advisor`: read-only pipeline snapshot and placeholder chat surface grounded in current opportunity and forecast collections.

## Current Collection Contract

The app client declares these collection names in `SalesCollections`:

- `leads`
- `accounts`
- `opportunities`
- `activities`
- `stage_history`
- `opportunity_windows`
- `window_snapshots`
- `forecasts`
- `quotas`
- `sales_recommendations`

These mirror the `knowledge_datasets` in `server/cycles/sales-opportunity-pipeline.cycle.yaml`. Until the workbench migrates from app records to the durable sales tables, app changes should keep the TypeScript collection contract, cycle manifest, and UI copy aligned.

## Mission And HIL Contract

The app currently triggers these missions by display name:

- `Qualify Lead`
- `Opportunity Window Decay Sweep`
- `Deal Risk Scan`
- `Generate Revenue Forecast`
- `Publish Forecast`

The app reads pending HIL gates through `hil.pending()` and submits decisions through `hil.submit(...)`. Deal closure remains advisory-only: the workbench can request a decision, but closed-won/lost movement should remain explicit or governed.

## Known Drift Risks

- The sales workbench is a Next `app/` blueprint, while older blueprint audits mostly inspect legacy `pages/index.tsx` files.
- Collection names are duplicated between the app client and cycle YAML.
- Mission names are string literals in the UI, so renaming a cycle mission can silently break buttons.
- The advisor is currently a placeholder, not a connected chat agent.
- The durable sales schema exists, but current workbench reads and writes still use app-record collections.
- `shared/schema/crm.ts` is support-ticket oriented and should not be treated as a sales CRM schema.

## Coverage Added

`server/domain/apps/tests/integration/blueprint_audit.test.ts` now includes a targeted sales workbench audit. It checks that:

- the sales Next `app/` blueprint has the expected route pages;
- the workbench source has no non-ASCII/mojibake artifacts;
- `SalesCollections` includes the expected collection names;
- those collection names are present in `sales-opportunity-pipeline.cycle.yaml`.

`server/domain/sales/core/sales-schema.test.ts` checks that the durable sales schema uses `sales_*` table names, validates basic account/opportunity inserts, and keeps sales stage values aligned with narrowing-window stage entitlements.
