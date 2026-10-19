# Sales Pipeline Management Apps Proposal

Date: July 2, 2026

## Executive Summary

Oddjob already has the raw ingredients for a strong sales pipeline management offering: a prospecting domain with behavioral intent capture, BANT/S.C.O.R.E. scoring, visitor identification, AI concierge intervention, and an existing `sales-opportunity-workbench` app blueprint with pipeline board, opportunity register, forecast, risk, and advisor surfaces.

The recommendation is to productize this into a small suite of connected revenue apps rather than a single oversized CRM clone. The suite should turn Oddjob's strengths - missions, HIL gates, app records, behavioral SDK, knowledge search, forecasts, and AI recommendations - into a sales operating layer that can sit beside Salesforce/HubSpot or operate standalone for teams that do not yet have a full CRM.

## Current Functionality Reviewed

### Existing App Portfolio

Reviewed `server/blueprints/apps/` and found relevant app patterns:

- `sales-opportunity-workbench`: existing revenue workbench with Pipeline Board, Opportunity Register, Forecast & Calibration, Deal Risk Center, and AI Sales Advisor.
- `product-launch-workbench`: useful pattern for multi-module operational command centers.
- `budgetmaster-workbench` and `budgetmaster-advisor`: useful pattern for paired workbench plus focused advisor app.
- `sdlc-workbench`: useful pattern for multiple role-specific workbenches sharing app-record collections and handoff queues.
- `stakeholder-workbench`, `pm-workbench`, `qa-workbench`, `scrum-master-workbench`: useful pattern for forms, approvals, status review, cross-workbench reads, and mission-triggered actions.

### Existing Sales/Prospecting Capability

Reviewed:

- `shared/schema/prospecting.ts`
- `server/domain/prospecting/prospecting.service.ts`
- `server/domain/prospecting/prospecting.route.ts`
- `server/domain/prospecting/scoring.service.ts`
- `packages/behavioral-sdk/README.md`

Implemented today:

- Multi-property prospect tracking.
- Anonymous visitor profiles with first-party IDs.
- Identify/merge flow from anonymous visitor to known user.
- Behavioral events, page views, clicks, dwell/scroll style signals.
- BANT/S.C.O.R.E. scoring stored on `prospect_leads`.
- AI concierge intervention when score crosses threshold.
- Optional IP/company de-anonymization through MCP enrichment providers.
- Dashboard APIs for prospecting properties and property leads.
- Behavioral SDK with `signal`, `identify`, `setAttributes`, `getScore`, threshold callbacks, consent, and offline replay.

### Existing Sales Opportunity Blueprint

Reviewed `server/blueprints/apps/sales-opportunity-workbench`.

Implemented in blueprint:

- `Pipeline Board`: stage-based opportunity board with live probability ceilings and decay windows.
- `Opportunity Register`: lead intake, deal list, opportunity detail, activity feed, semantic search, and decay history.
- `Forecast & Calibration`: weighted pipeline, committed, best case, quota attainment, and stated-vs-realized gate calibration.
- `Deal Risk Center`: recommendations, risk scans, pending HIL gates.
- `AI Sales Advisor`: snapshot cards and planned chat experience grounded in opportunity/forecast data.
- Collection client contract around `leads`, `accounts`, `opportunities`, `activities`, `stage_history`, `opportunity_windows`, `window_snapshots`, `forecasts`, `quotas`, and `sales_recommendations`.

### Platform Capability To Reuse

- App marketplace/install/runtime: `server/domain/apps/app-registry.service.ts`.
- App-record pattern via dataset collections used by workbenches.
- Mission triggers from apps (`missions.trigger(...)`) for qualification, scans, decay sweeps, and forecast generation.
- Human-in-the-loop decision gates through HIL and approval flows.
- Pipeline automation for scheduled/event-driven revenue workflows.
- Knowledge search for semantic deal/account querying.
- Behavioral SDK and prospecting queue for top-of-funnel data.

## Gap Assessment

The current portfolio has strong top-of-funnel behavior capture and a promising sales-opportunity UI, but it is not yet a trustworthy sales pipeline management system.

Primary gaps:

- First-class sales domain schema and a thin service facade now exist for accounts, contacts, leads, opportunities, stages, activities, opportunity windows, forecasts, quotas, and recommendations. The existing workbench still needs migration from app-record collections to these durable tables. The existing `shared/schema/crm.ts` remains ticket/support oriented, not sales CRM.
- `sales-opportunity-workbench` uses app-record collections as its source of truth. That is fast for app prototyping, but weak for reporting, integrations, permissions, and long-term data quality.
- Lead/prospect records are not formally connected to opportunities.
- Stage movement is mostly UI-driven or mission-triggered; there is no canonical stage policy engine.
- Forecasting exists at the app level, but not as a platform-backed revenue service.
- Advisor chat is a placeholder in the blueprint.
- There is no CRM sync layer for Salesforce, HubSpot, Pipedrive, Attio, or spreadsheets.
- No dedicated sales manager app for inspection, coaching, rep performance, and forecast review.
- No durable audit model for why an opportunity probability changed, who approved a close, or what signal re-armed a deal window.

## Proposed App Suite

### 1. Revenue Command Center

Audience: CRO, VP Sales, RevOps, founders.

Purpose: Executive overview of pipeline health, forecast, coverage, risks, and team performance.

Core screens:

- Pipeline health dashboard: total pipeline, weighted pipeline, commit, best case, coverage ratio.
- Forecast by period, owner, segment, and stage.
- Risk digest: stalled deals, slipping close dates, decaying engagement, single-threaded accounts.
- Quota attainment and rep/team performance.
- Decision inbox summary for pending close/loss/discount/forecast approvals.

Build approach:

- New app blueprint or module in `sales-opportunity-workbench`.
- Read from the new sales domain tables once the workbench migration begins; until then it can aggregate existing app collections.
- Reuse forecast/calibration concepts from the existing blueprint.

### 2. Pipeline Workbench

Audience: AEs, sales managers, RevOps.

Purpose: Day-to-day opportunity movement and pipeline hygiene.

Core screens:

- Kanban pipeline board by configurable stage.
- Inline stage advancement with required evidence and governance checks.
- Bulk pipeline cleanup: missing next step, overdue close date, stale amount, no owner.
- Activity capture and next-best-action.
- Deal window/probability ceiling visualization.

Build approach:

- Harden existing `sales-opportunity-workbench/app/pipeline`.
- Replace hard-coded `OPEN_STAGES` with org-configurable pipeline stages.
- Keep "advisory only" close flow: closed-won/lost requires HIL gate or explicit user action.

### 3. Opportunity 360

Audience: AEs, account managers, sales engineers.

Purpose: One page to understand an opportunity and act on it.

Core screens:

- Opportunity details: account, contacts, amount, products, stage, owner, close date.
- Buyer map: champions, economic buyer, blockers, unknown stakeholders.
- Activity timeline: calls, emails, meetings, website intent, proposal opens, mission events.
- AI-generated deal brief: why now, risks, next steps, missing evidence.
- Handoff actions: request SE support, create follow-up sequence, generate mutual action plan.

Build approach:

- Extend existing Opportunity Register detail panel into a proper detail route.
- Combine app records, prospecting events, and knowledge snippets.
- Use mission-triggered actions for "Generate deal brief", "Draft follow-up", and "Create mutual action plan".

### 4. Lead Intake and Qualification Hub

Audience: SDRs, BDRs, demand gen, RevOps.

Purpose: Convert behavioral and manual leads into qualified pipeline.

Core screens:

- Lead queue from prospecting properties and manual intake.
- S.C.O.R.E./BANT vectors with supporting behavioral evidence.
- De-anonymized company profile and ICP fit.
- Qualification checklist.
- Convert to account/contact/opportunity.
- Disqualify with reason and learning feedback.

Build approach:

- Reuse `server/domain/prospecting` and `packages/behavioral-sdk`.
- Add conversion service from `prospect_leads` to sales-domain `leads/accounts/contacts/opportunities`.
- Surface privacy/consent status from the prospecting domain.

### 5. Deal Risk Center

Audience: Sales managers, RevOps, reps.

Purpose: Turn pipeline risk into actionable interventions.

Core screens:

- Risk feed: slip risk, stalled, aging, low engagement, no next step, discount risk.
- Recommendation cards with evidence, confidence, and suggested action.
- Snooze/dismiss/act workflow.
- HIL gates for close/loss/discount exceptions.
- Risk scan schedule and rule configuration.

Build approach:

- Harden existing `sales-opportunity-workbench/app/alerts`.
- Promote `sales_recommendations` from loose collection shape into a typed sales recommendation table or shared app-record schema.
- Feed recommendations from scheduled missions and pipeline jobs.

### 6. Forecast Review and Calibration

Audience: Sales managers, RevOps, finance.

Purpose: Make forecast calls auditable and calibrated.

Core screens:

- Live forecast: commit, expected, best case.
- Forecast submission workflow by rep/manager.
- Stage and deal-window calibration: stated probability vs realized win rate.
- Change history: what moved forecast since last submission.
- Publish forecast with HIL review.

Build approach:

- Harden existing `sales-opportunity-workbench/app/forecast`.
- Add forecast snapshots and submission history.
- Use HIL for publish/override approvals.
- Integrate with quotas and period definitions.

### 7. AI Sales Advisor

Audience: Reps and managers.

Purpose: Conversational but grounded sales copilot.

Core questions:

- "Which deals need attention today?"
- "What changed since yesterday?"
- "Why did my forecast drop?"
- "Which deals can I pull into this quarter?"
- "Draft a follow-up for this opportunity using recent activity."

Build approach:

- Finish the placeholder advisor in `sales-opportunity-workbench/app/advisor`.
- Use a retrieval scope over sales tables, app records, prospect events, and knowledge graph documents.
- Require citations/evidence snippets for numeric claims.
- Add tool actions behind approval where they mutate opportunity data.

## Recommended Platform Additions

### Sales Domain Schema

Continue hardening the first-class schema in `shared/schema/sales.ts` and service facade under `server/domain/sales/`.

Minimum tables:

- `sales_accounts`
- `sales_contacts`
- `sales_leads`
- `sales_opportunities`
- `sales_opportunity_stages`
- `sales_activities`
- `sales_stage_history`
- `sales_products`
- `sales_opportunity_line_items`
- `sales_forecast_periods`
- `sales_forecast_submissions`
- `sales_quotas`
- `sales_recommendations`
- `sales_opportunity_windows`
- `sales_window_snapshots`

Keep app-record collections for app-local scratch data, but move system-of-record entities into typed tables. The initial durable schema now covers core CRM objects, opportunity windows, forecasts, quotas, and recommendations; products, line items, forecast periods, and forecast submissions remain follow-up additions.

### Sales Services

Add platform services:

- `SalesLeadConversionService`: converts prospect lead to account/contact/opportunity.
- `SalesOpportunityService`: CRUD, stage movement, owner assignment, activity logging.
- `SalesStagePolicyService`: stage rules, evidence requirements, close/loss gating.
- `SalesForecastService`: weighted rollups, submissions, quota/period logic.
- `SalesRiskService`: stalled/slip/aging/engagement-risk detection.
- `SalesAdvisorService`: grounded Q&A and action planning.
- `SalesCrmSyncService`: adapter abstraction for Salesforce/HubSpot/Pipedrive/CSV.

### Mission Templates

Create reusable sales missions:

- Qualify Lead
- Convert Lead to Opportunity
- Deal Risk Scan
- Opportunity Window Decay Sweep
- Generate Revenue Forecast
- Publish Forecast
- Draft Follow-Up
- Generate Mutual Action Plan
- Enrich Account
- Reconcile CRM Sync

### Pipeline Templates

Create pipeline templates:

- Website Intent to Qualified Lead
- Qualified Lead to Opportunity
- Daily Deal Risk Scan
- Weekly Forecast Review
- Proposal Opened Follow-up
- Stale Deal Recovery
- Closed-Won Handoff to Customer Success

## Integration Strategy

Phase 1 should work standalone using Oddjob records. Phase 2 should sync to external CRMs.

Supported integration directions:

- Import accounts, contacts, opportunities, users, products, and activities from Salesforce/HubSpot.
- Push back stage changes, activity summaries, recommendations, and forecast submissions.
- Maintain external IDs on typed sales rows.
- Treat external CRM as configurable source of truth per object.
- Keep Oddjob-generated recommendations and HIL decision history in Oddjob even when syncing updates out.

## Governance and Safety

Sales apps should preserve human control over revenue decisions.

Required controls:

- Human approval for closed-won, closed-lost, large discounts, write-offs, and forecast publication.
- Audit trail for every stage change, probability change, owner change, and close decision.
- PII and consent controls for prospecting data.
- Configurable fail-safe when CRM sync fails.
- Role-based permissions: rep, manager, RevOps, executive, admin.
- Advisory labels for AI recommendations.

## Data Flow

1. Behavioral SDK captures anonymous and identified buyer events.
2. Prospecting service stores profile, lead, events, and BANT/S.C.O.R.E. vectors.
3. Qualification hub reviews and converts qualified leads into sales-domain account/contact/opportunity records.
4. Pipeline Workbench manages opportunity movement and activities.
5. Deal Risk Center and scheduled missions generate recommendations.
6. Forecast service generates live and submitted forecast views.
7. Revenue Command Center presents executive rollups.
8. AI Sales Advisor answers questions and proposes actions using grounded retrieval.
9. CRM sync imports/exports configured objects and preserves external IDs.

## Implementation Plan

### Phase 0: Align Current Blueprint

Duration: 1 week.

- Register `sales-opportunity-workbench` as the canonical seed app for sales pipeline management.
- Fix encoding artifacts in the blueprint UI text where needed.
- Document current collection contracts.
- Add smoke tests that each module route renders.

### Phase 1: Standalone Sales Suite

Duration: 3-4 weeks.

- Add typed sales schema and `server/domain/sales`.
- Implement Opportunity CRUD, stage movement, activity logging, forecast rollup, and recommendation APIs.
- Migrate or bridge existing workbench collections to typed APIs.
- Harden Pipeline Board, Opportunity Register, Deal Risk Center, Forecast Review, and Advisor.
- Add lead conversion from prospecting to sales opportunity.

### Phase 2: Intelligence and Governance

Duration: 3-4 weeks.

- Add risk scan mission and schedule.
- Add decay window service and snapshots.
- Add forecast submission workflow with HIL approval.
- Add advisor retrieval/tool actions grounded in sales data.
- Add calibration reports using realized outcomes.

### Phase 3: CRM Sync

Duration: 4-6 weeks.

- Add CRM adapter interface.
- Implement Salesforce and HubSpot first.
- Add conflict resolution and sync status UI.
- Add field mapping configuration.
- Add background sync/reconciliation missions.

## MVP Recommendation

The first shippable bundle should be:

1. Pipeline Workbench
2. Opportunity 360
3. Deal Risk Center
4. Forecast Review
5. Lead Intake and Qualification Hub

Defer full Revenue Command Center and CRM sync until the sales domain schema is migrated into the workbench and exercised by real workflows.

## Success Metrics

- Lead-to-opportunity conversion time reduced by 30%.
- More than 90% of open opportunities have next step, owner, amount, and expected close date.
- Forecast rollup latency under 2 seconds for typical org datasets.
- Risk scan produces actionable recommendations with less than 20% dismissal rate.
- At least 80% of AI Advisor numeric answers include cited source records.
- Closed-won/lost actions have 100% audit coverage.

## Open Questions

- Should Oddjob be the source of truth for opportunities, or should Salesforce/HubSpot remain source of truth for most customers?
- Which CRM should be first-class in Phase 3: Salesforce or HubSpot?
- Should probability be stage-based, AI-scored, rep-entered, or governed by the current decay-window ceiling model?
- Should prospecting S.C.O.R.E. vectors map directly into opportunity risk, or only influence lead qualification?
- What approval threshold should require manager review: close, discount, amount, stage, or forecast delta?

## Recommendation

Proceed with a sales pipeline app suite anchored on the existing `sales-opportunity-workbench`, but add a typed `sales` domain before broadening the UI. The app portfolio should not become a generic CRM clone. It should differentiate around Oddjob-native strengths: buyer-intent capture, mission-triggered workflows, human gates, forecast calibration, risk recommendations, and grounded sales advisory.
