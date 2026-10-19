# CREW and SDLC swarm integration audit

This audit captures the state before the implementation follow up below. Its screenshots remain evidence of that original state.

The SDLC suite mounts successfully in CREW and provides useful intake, planning, QA, release, and fleet interfaces. It does not yet provide a dependable shared workflow for development swarms. The largest gaps are app-to-chat grounding, execution identity, evidence-based gates, and durable handoffs. Eight linked surfaces contain demonstration data or simulated actions; DevOps mixes real record reads with demonstration infrastructure status.

Audit scope: organization 342, room `crew-1791839278460-gyeon9l`, SDLC Workbench Suite, app 888, deployment 874. All 16 home links were opened in the live embedded app. Read-only tabs, intake-form opening, empty-field validation, and two CREW chat probes were exercised. Mission launches, record submissions, approval changes, external publishing, and patch creation were not executed. Source findings describe the current repository; they are distinguished below from observed behavior. Screenshots were saved and inspected; the initial QA loading capture was replaced with a loaded view.

## Priority findings

| Priority | Finding | Evidence and consequence | Required correction |
| --- | --- | --- | --- |
| P0 | QA can pass without tests | The live gate is available at 0/0 suites. `evaluateRules([], [])` returns pass. Failed data reads are converted to empty arrays. A successful-looking gate can therefore reflect missing or unavailable evidence. | Evaluate on the server against required suites, a specific commit/build, complete reads, and authenticated runner evidence. Empty, stale, or unavailable evidence must block. |
| P0 | Test evidence can be manufactured by an ordinary button | `Log Passing Smoke Suite` writes a fixed passed result, two passes, and 95% coverage; it does not run tests. Resolving a defect writes “Verified fixed by QA operator” without rerunning verification. | Remove production evidence fabrication. Separate manual attestations from runner results; require links to results and the exact tested revision. |
| P0 | Deployment decisions do not establish durable approval | CAB is enabled at 0% readiness and six blocked missions. Its handler ignores the outcome of the approval-record write inside `Promise.allSettled`, then triggers Production Deployment. UAT and CAB default to approved values; the release digest uses form state rather than retrieved saved decisions. | Require a saved, authorized, revision-bound decision before deployment. Treat exceptional overrides as explicit audited actions. Never publish an unsaved default as an approval. |
| P1 | CREW agents cannot reliably identify or read the mounted app | Probe one produced no executed tools and no app context. Probe two, after Discuss app, executed `read_app_records` with the deployment-path slug and failed. CREW displayed 100 app events that were not available as agent evidence. | Pass a trusted app binding and current surface context. Resolve records by app identity with tenant/project checks. Add scoped state/event retrieval rather than expecting agents to interpret an iframe. |
| P1 | Org-wide operations appear to be this room's development swarm | Fleet chooses the latest active organization cycle. The visible six blocked missions are crisis-recovery operations; home/SLA pending items concern flights and Budget Master. | Explicitly bind room → project/repository → cycle → sprint/release. Label organization views separately; never silently choose the latest unrelated cycle. |
| P1 | Queued requests can be called launched | Mission gateway returns HTTP 202 with `runId: null`, `status: queued` for absent missions or failed launches. The client type requires a numeric run ID; PM marks launch success without inspecting status. Similar completion messages appear across QA/planning/release. | Use typed queued/accepted/running/blocked/failed/completed results, an operation ID, reconciliation, and a resumable checkpoint. Show each actual step's outcome. |
| P1 | Cycle controls and the host use incompatible messages | Workbench buttons emit `source: workbench`, `type: trigger-cycle`. CREW Canvas consumes app-activity messages rather than this execution request protocol. Embedded detection expects `embed=1`; nested pages use `embed=cycle`. | Adopt one versioned host bridge with validated source/origin, room and cycle IDs, acknowledgments, timeout, cancellation, and declared actions. |
| P1 | Handoffs are notifications, not accepted work | Stage events contain zero, sprint-number, or record IDs in the run-ID field. Queue deduplication uses run ID plus target stage; zero IDs can collapse distinct handoffs. Current callers omit org ID and share the default browser-local queue. Opening a workbench marks messages read. | Persist typed handoffs with unique IDs, source artifact revisions, destination acceptance, actual run IDs, tenant/project binding, idempotency, and recovery state. Read status must remain separate. |
| P1 | Autonomy promises exceed the wiring found | Fleet saves policies into an app-record collection and says agents will pause at limits. Repository search found UI record consumers but no runtime enforcement consumer of that collection. “Add / Update” creates another record. | Wire a versioned effective policy into execution and verify it at each step/spend boundary. Show enforcement status and policy precedence; update existing policies deterministically. |
| P1 | Demonstration content looks operational | Static health, sales, finance, HR, legal, and security claims have no demo label. Security's PR handler is a timer followed by “Patch PR #1042 Created.” | Label and isolate demonstrations immediately. Disable unsupported actions or explain readiness. Operational claims require evidence, timestamps, and provider identity. |
| P2 | Value-stream metrics do not measure correlated delivery | PM → Dev uses gaps between consecutive signoffs; other stages pair nearest timestamps across unrelated records. MTTR uses the next deployment rather than incident resolution. Zero deployments produce a green 0% failure rate. | Correlate each metric to the same change/release/incident, publish its definition and sample size, and use unavailable where the denominator or required evidence is absent. |

P0 means a correctness or release-trust blocker that should be addressed before relying on the workflow for production changes. It does not mean this audit executed a deployment or proved a backend authorization bypass.

## Live chat grounding tests

1. **Adjacent app state, failed.** Copilot was asked to identify the current screen, active/blocked/completed counts, pending decisions, and their scope without taking actions. Home showed 0 active, 6 blocked/HIL, 0 completed and two pending decisions. Copilot could not identify any of them. The response had no execution badge and explicitly reported no calls. This is a context-availability failure; the agent appropriately avoided inventing an answer.
2. **Discuss app, failed with a recorded tool call.** With Fleet's SLA Monitor selected, Discuss app populated only the suite title, app/deployment IDs, and base deployment path. The probe asked for the selected tab and pending items without supplying their contents. The expanded execution evidence shows `read_app_records` failed: no app `sdlc-workbench-fszvh` available to this organization, with guidance to call `list_installed_apps`. The agent stopped without resolving the canonical catalog identity. It also could not use the app activity shown in chat.

The second failure does not establish a wrong database or missing app records. The app is visibly mounted while the reader resolves catalog slug/name under organization and private-project visibility rules. Resolve identity and project binding before diagnosing storage loss. Agents should retain both the deployment URL and canonical app slug; those values serve different purposes.

Both responses ended mid-sentence in the persisted transcript. The supervisor labeled the rounds “No weakness,” correctly recognizing read-only discipline but missing the product failure. Feedback should separately score safe behavior, retrieval success, and completion of the user's requested task.

First grounding test and home state

Discuss app probe with failed executed tool

## Surface by surface walkthrough

Health describes readiness for the intended workflow, not whether the page renders. All 16 pages rendered during this run.

### 1 Sprint Zero — partial

The five-step sequence establishes codebase, architecture, threat model, backlog, and launch. Required-field validation prevented progressing from an empty Codebase step. This is a useful foundation. Repository URL, stack, and team size were empty rather than derived from a room/project binding. Launch uses a mission name, so it inherits queued-result and identity ambiguity. Add a preflight for repository access, execution workspace, branch strategy, credentials, team roles, and budget. Preserve the wizard as a versioned project brief that later stages can read.

Sprint Zero validation

### 2 PM Workbench — blocked intake, partial implementation

The backlog reports 0/0 alongside a clear missing-Jira-connector error. Filtering and a document/manual intake form are present. Opening the form worked; an empty title leaves Create & Draft PRD disabled. However, the error instructs the user to use the Connectors Dashboard without a direct recovery link. The prominent Force Approval action suggests bypassing gates before normal intake is ready. Requirements, PRD, reviewed story points, and approval should share a stable change ID and selected source revisions. Signoff records use `submittedAt`, whereas VSM expects `timestamp`, adding another metric seam. The source also permits a stage handoff with run ID zero and a launch toast for a queued response.

PM intake and missing connector

### 3 Scrum Master — partial, disconnected planning

Capacity, Backlog, and Blockers tabs were inspected. Sprint 13, 80 engineer-days, and target velocity 45 are source defaults, not loaded planning facts. Backlog and blockers were empty while Fleet showed six blocked runs. These are separate stores, but the UI gives no scope explanation. Save & Trigger Sprint Kickoff combines two operations; its handler ignores the capacity-write result and emits a handoff whose run ID is the sprint number. Bind a real sprint and chosen backlog to worker capacity, concurrency, spend limits, file ownership, dependency readiness, and a saved capacity plan. Surface upstream blockers instead of requiring duplicate manual entry.

Scrum planning defaults

### 4 QA Workbench — release-trust blocker

Suites, Defects, and Quality Gate tabs were inspected. All counts were zero. The loaded Suites view exposes Log Passing Smoke Suite; source confirms it creates fixed successful evidence. The gate treats no suites and no defects as success and swallows record-read errors. A rejected quality-gate write can still lead to downstream mission triggering because its settled result is not required to succeed. Failed-gate retry counts aggregate the whole collection rather than one change/revision; after repeated failures, HIL is created but the development retry still occurs. Require verified runner output, required-suite coverage, artifact/commit binding, durable gate storage, and a stop condition when human triage is required.

Loaded QA suites

Gate available with zero suites

### 5 Stakeholder — release-trust blocker

Readiness, Approvals, and Jira & Confluence tabs were inspected. The readiness map contains six stale crisis-recovery missions, not a selected development release. Readiness is a formula over completed and blocked runs rather than a verified checklist of release artifacts. CAB approval remains enabled at 0% and defaults to approval; UAT also defaults to approved. No approval was submitted. CAB's source ignores a rejected approval-record write before triggering deployment. The digest publishes current form values rather than saved UAT/CAB decisions. Introduce a release candidate with commit/build IDs, saved QA/UAT/security evidence, authorized CAB record, rollback plan, environment, and explicit exceptional-override policy.

CAB action at zero readiness

### 6 Fleet Command — real telemetry, incomplete swarm control

Fleet, Autonomy, and SLA Monitor tabs were inspected. Live telemetry exposes six stale blocked runs and $0.00 spend. That is useful failure visibility, but the backend labels mission runs as agents, supplies an empty dependency list, and picks the latest organization cycle. The roster does not offer a visible drilldown into the backend flight recorder or specific resume/checkpoint actions. PIP records a coaching action and triggers Sprint Kickoff & Planning; it does not repair the selected stale run and suppresses errors. Autonomy policies were absent; saving them only writes app records in the wiring found. SLA Monitor shows unrelated flights/Budget Master requests with no SLA. Its notification code runs in the browser and deduplicates only during that mount, making repeated notifications and missed unattended checks possible. Separate worker identities, runs, chat participants, policies, approvals, and actual repair actions.

Fleet blocked runs

Autonomy policy form

SLA scope mismatch

### 7 VSM Dashboard — partial data view, unreliable metric definitions

The screen shows no deployments, incidents, or gates, with 0/day deployment frequency and green 0% change failure rate. Empty stage values are correctly labeled No data, but the zero failure rate implies evidence that is absent. Source computes temporal proximity, not change lineage: consecutive PM signoffs for PM → Dev, nearest subsequent CAB/deployment for other stages, and next deployment for incident recovery. It also expects a PM timestamp field that the signoff writer does not populate. Link work-item, commit, build, deployment, and incident IDs before reporting delivery performance. Expose date range, environment, sample size, and definitions.

VSM empty metrics

### 8 DevOps Workbench — hybrid, incomplete delivery handoff

QA gates/defects and Fleet are retrieved, but production-health services and CAB rows are static. The engineering branch is hardcoded to `mission/run-3913`. Read failures become empty gates/defects; “No blocking reasons” can mean no gate was evaluated. PR readiness takes the newest app-wide passing gate and zero open defects, without checking commit, branch, environment, build, or required checks. The page states Core Development creates a PR but offers only Refresh, with no visible PR ID/link or actual handoff control. Replace static infrastructure claims and branch selection with provider evidence, correlate checks to the intended artifact, and expose PR → review → merge → deploy → verify → rollback operations.

DevOps mixed live and static status

### 9 Ops Workbench — demonstration

Incident INC-9942 and hotfix OJB-552 are static table rows. Declare Incident and View Postmortems have no handlers. There is no working incident → severity/triage → hotfix → QA → release → verification → postmortem loop in this surface. Replace the demonstration with scoped incidents, accountable owners, linked production evidence, safe mitigation proposals, repair runs, and verified recovery. It should reuse development handoffs rather than create a separate parallel process.

Ops demonstration

### 10 Sales Workbench — demonstration

Pipeline stages, conversion rates, probabilities, and deals are hardcoded. Add Lead and View Forecast have no handlers. There is no customer request → approved requirement/roadmap linkage. Monetary strings omit decimal precision and currency codes. Before enabling this surface, connect real CRM records, allow a selected opportunity to become a traceable PM request, and identify the forecasting model, period, currency, and assumptions.

Sales demonstration

### 11 Marketing Workbench — demonstration

Campaign budgets, spend, ROI, and content calendar are static. Create Campaign and View Analytics have no handlers. The calendar calls June dates upcoming in the current October session. An overspent campaign is not flagged. No release-ready artifact feeds launch content, and no Scribe/Media output returns with review status. Bind campaigns to a release, versioned assets, approvals, publication results, and real measurement sources.

Marketing demonstration

### 12 Customer Success — demonstration

Customer onboarding progress, named contacts, and NPS are static; Start Onboarding and View Templates have no handlers. There is no feedback → bug/requirement → delivered fix → customer notification handoff. Use customer/source IDs, consented communication workflows, linked issues, acceptance outcomes, and escalation owners. Clearly distinguish aggregate feedback scores from per-customer ratings.

Customer Success demonstration

### 13 Finance Workbench — demonstration

Revenue recognition, deferred revenue, and billing rows are hardcoded; Generate Report and View Forecast have no handlers. Whole-dollar and abbreviated strings do not satisfy the requested monetary decimal display. There is no link to QuickBooks, financial snapshots, forecast provenance, or the actual development budget/spend. Mount existing financial capabilities with explicit currency, period, snapshot, scenario, and source definitions; distinguish swarm execution cost from accounting revenue.

Finance demonstration

### 14 HR Workbench — demonstration

Employee onboarding and performance-review rows are static; Start Onboarding and View Templates have no handlers. This is human HR content, not development-agent staffing or capability readiness. Label it accordingly and keep human personnel access distinct from swarm management. A development workforce view should expose agent skills, execution permissions, environment readiness, assignment, concurrency, and proven outcomes without implying these employee ratings measure agent performance.

HR demonstration

### 15 Legal Workbench — demonstration

Contract rows and SOC2/GDPR Compliant labels are static; Create Contract and View Templates have no handlers. These labels cannot establish real compliance. There is no policy/license/privacy review → release gate or evidence reference. Bind actual obligations and reviews to the affected repository/release, include reviewer authority and expiration, and reserve compliance assertions for supported evidence.

Legal demonstration

### 16 Security Auditor — simulated, unsafe to trust as execution

The live-looking threat stream, commit IDs, 1,402 scanned commits, 14 prevented vulnerabilities, 92.8% patch success, and scanning status are static. The page claims history was scrubbed and DevOps alerted without executing those operations. Generate Patch PR sets a local timer and then displays a fixed PR number. The button was not exercised in the live account; source establishes the simulation. Connect a real scanner/webhook and repository identity, evidence-linked findings, remediation proposals, real PR receipts, test results, and QA/release gate integration. Never simulate a consequential success in an operational surface.

Security simulated activity

## Shared UX and accessibility risks

The host navigation is a useful improvement: App home, Back, chat visibility, rail visibility, and Exit remain reachable during the walkthrough. Legacy in-app assistants are hidden, preserving CREW as the conversation location. The suite's breadth and recognizable stage labels help users orient themselves.

The surrounding interface still competes with the workbench: global header, agent catalog, room controls, app toolbar, navigation row, app identity/Discuss row, and an iframe header precede the working content. Consolidate app identity, breadcrumbs, scope, connection status, and navigation into one compact toolbar. Make Discuss selection attach the current record/view and revision. Collapse generic room guidance during focused work, keeping actionable blockers and evidence visible.

At the captured desktop width, opening the rail leaves the chat composer narrow enough for placeholder wrapping/overlap around the attachment and mode controls. Workbench layouts use viewport breakpoints inside the iframe rather than host available width. Fleet alert reasons are truncated; long messages need a details affordance. Low-contrast secondary labels and small badge text are visible risks. Tabs are generic buttons in several views; keyboard focus, selected-state announcements, iframe entry/exit, busy/error live regions, and reduced-motion behavior require dedicated testing. No full accessibility compliance claim follows from these screenshots.

The Connections rail tracks the actual nested QA route, but its dependency manifest lists only the internal API for QA. Source shows QA also uses bug/HIL/knowledge/mission services; Fleet uses Slack, and many other surfaces have no declared contract. Distinguish configured connector, credential validity, scopes, destination permissions, binding, and last verified action. The rail's “not checked” language is appropriately cautious, but a generic internal-API entry does not prove workflow readiness.

## Missing handoffs and target experience

| Transition | Current seam | Needed durable output |
| --- | --- | --- |
| Room → app | UI mounts, agent context absent; computer-studio history remains in room | Canonical app/deployment/project binding plus current surface, selection, evidence revision, and scoped read actions |
| Sprint Zero → PM/planning | Mission-name request; repository and brief are not a shared visible binding | Versioned project brief, repository/workspace/branch, approved scope, chosen cycle and team |
| PM → implementation | Manual launch, zero-ID notification, possible queued-as-success | Approved change package, acceptance criteria, source references, budget, actual run receipt |
| Planning → workers | Person-day defaults; no authoritative dependency/file ownership graph | Task DAG, worker assignment, per-task workspace, leases, dependencies, concurrency and spend budget |
| Workers → review/QA | No dedicated implementation workbench linked from home | Commit/PR/build/test artifacts with producing worker/run IDs and isolated branch/worktree ownership |
| QA → UAT | Empty gate passes, manual synthetic evidence, retry still possible after HIL | Verified immutable test results and saved revision-bound gate, accepted retry/triage decision |
| UAT/CAB → deployment | Form defaults, ignored save failure, unrelated cycle readiness | Authenticated saved approval covering exact release artifact, environment and rollback plan |
| Deployment → Ops/VSM | Static health and incidents, timestamp-only joins | Provider receipt, deployment verification, change-to-incident correlation, resolution evidence |
| App events → chat | Feed displays records but is not model evidence | Durable filtered event references with source, scope, deduplication, replay cursor and task relevance |
| Customer/commercial → delivery | Static disconnected data | Traceable request/obligation → approved change → release → customer/business outcome |

CREW should be the shared conversation and supervision layer. Workbenches should be views over the same scoped execution graph. A persistent header should identify repository, cycle, sprint/release, environment, and effective policy. Selecting a worker or artifact should select the same entity in chat, the main surface, and the rail. Chat speakers and executing workers need different status labels.

An execution operation should have a unique ID and states such as proposed, awaiting approval, queued, running, blocked, failed, succeeded, and canceled. Each handoff needs source/destination identity, artifact revisions, acceptance criteria, permission check, idempotency key, receipt, and recovery checkpoint. A notification that someone opened a view is not an execution acknowledgment. Retries must reconcile unknown outcomes before creating another external record or mission run.

## Repair order and acceptance checks

1. **Restore trustworthy claims and gates.** Label all demonstrations, remove simulated production success, enforce required QA evidence and durable approvals, stop treating read failure as zero findings. Check empty tests, stale commit evidence, rejected gate write, rejected CAB write, unsaved approval defaults, and failed provider reads in isolated fixtures. None may unlock downstream execution.
2. **Bind room, app, and execution context.** Persist explicit project/repository/cycle/release bindings. Pass canonical app identity and current view to scoped readers. Repeat both chat probes: agents must identify the selected surface and retrieve its scoped evidence without being told the answer. Switching rooms/orgs must not carry records, events, or handoff notifications across boundaries.
3. **Unify action and recovery contracts.** Wire one host bridge, require acknowledgments, distinguish queued from running, expose operation cards and receipts, and make handoffs durable. Exercise unavailable mission, launch failure, lost acknowledgment, duplicate click, refresh mid-action, and retry-after-unknown-outcome. Each produces one recoverable operation and at most one downstream write.
4. **Build the swarm execution workbench.** Add worker/run drilldown, task dependency graph, branch/worktree and file ownership, PR/build/test links, pause/resume/cancel, targeted repair, and effective budget/step policies. Verify that saving a policy changes runtime behavior and that a stale-run repair targets the same run rather than creating an unrelated planning mission.
5. **Complete one vertical delivery slice.** Use a disposable project and test repository: requirement → plan → two workers → review → real test result → UAT/CAB → test-environment deployment → verification → VSM. Failure injection must show partial state and recovery at every handoff. Only then expand commercial, finance, legal, HR, and incident surfaces through the same contracts.

No implementation changes were made as part of this audit. Full repository verification was not run for this documentation-only review. The live walkthrough establishes rendering, selected read-only interactions, and the two observed chat failures; source tracing establishes the documented code paths. Actual provider writes, runtime policy enforcement, permission coverage, mobile layouts, and keyboard/screen-reader behavior require the isolated execution and accessibility checks above.

## Source anchors

Paths below are current repository evidence, not proof that every source revision matches the deployed app build.

- App discussion draft and context boundary; request payloads at lines 786 and 827; app activity display at line 1406.
- App reader catalog and project resolution.
- Workbench execution message and [host canvas](../../../client/src/components/agent-chat/CrewCycleAppCanvas.tsx).
- Queued mission response and mutable ticket mapping; client result type.
- PM signoff and launch states.
- Planning save and handoff.
- QA rules, gate writes and synthetic suite.
- CAB persistence and launch.
- Fleet source and identity; policy, PIP and browser SLA handlers.
- Handoff queue identity and default scope; queue caller.
- VSM computation.
- DevOps hybrid data and branch.
- Security PR simulation.
- Static rows and inactive buttons: `server/blueprints/apps/sdlc-workbench/app/{ops-workbench,sales-workbench,marketing-workbench,customer-success-workbench,finance-workbench,hr-workbench,legal-workbench}/page.tsx`; button primitive.
- Incomplete adapter manifest.

## Implementation follow up

The first repair phase changes the blueprint source and platform gateway. It does not make the entire suite production-ready or replace the installed organization's app workspace automatically.

| Area | Implemented behavior |
| --- | --- |
| QA evidence | Missing or failed reads block evaluation. Full commit SHA, runner/result references, executed-test counts, and coverage are required. The manual fixed passing-suite writer was removed. The gateway recomputes passing gates from persisted test/defect records rather than accepting a browser's pass assertion. |
| Saved release decisions | UAT defaults to blocked and CAB to deferred. CAB cannot ignore a rejected save. Production requests must identify the latest saved CAB, UAT, and QA records covering the same commit. A later rejection supersedes an older approval. Gates/approvals cannot be edited into different decisions through the dataset update endpoint. |
| Launch receipts | Queued requests are not labeled launched. Structured failures return failed. Success without a run receipt and transport exceptions return unconfirmed; unknown outcomes are recorded for reconciliation rather than automatic retry. |
| Concurrent ticket identity | Launch-specific Jira keys remain in run context and pipeline input. Both the platform controller and downstream mission service stopped rewriting the reusable mission template. Mission lookup no longer uses arbitrary substring matches in blueprint payloads. |
| App context in chat | Queued requests preserve the mounted app path. The server resolves canonical app identity and collection counts through organization, project, and private-room access checks. The browser path is explicitly a view hint; collection counts are app-wide. Invalid/inaccessible hints disclose no private metadata. |
| Host bridge | Cycle requests from the exact mounted iframe, same origin and room receive an acknowledgment and prepare a CREW draft. The operator reviews and sends that draft; preparation does not imply a launch. Nested `embed=cycle` pages are supported. A missing acknowledgment is reported. |
| Demonstrations | Eight sample surfaces are labeled, disconnected buttons are disabled, and the simulated Security PR creation/history-scrubbing claim was removed. DevOps is labeled as a partial integration and no longer names a hardcoded engineering branch. Sample financial amounts include two decimals and USD. |
| Fleet and handoff scope | Fleet is labeled as the latest organization cycle and its roster as mission runs. Autonomy records are explicitly planning preferences without runtime enforcement. Handoff notification storage requires organization scope, and deduplication distinguishes separate timestamped events. PM, planning and QA handoff events use confirmed launch IDs. |
| Value stream evidence | Missing evidence stays unavailable. Stage intervals require correlated change IDs and explicit handoff timestamps. Incident recovery uses resolution time; lead time follows the same change. Change failure rate counts incident-linked production deployments rather than dividing unrelated incident counts. Failed record reads clear derived metrics and show an error. |
| Adapter visibility | Fleet's Slack dependency and Stakeholder's Slack/Confluence dependencies are declared. Internal-only implemented views have explicit contracts. Undeclared demonstration integrations remain unverified. |

Focused regression tests cover empty/synthetic/mismatched QA evidence, malformed and queued receipts, approval linkage, gateway rejection of fabricated gates, immutable decisions, superseded approvals, missing run receipts, template ticket isolation, context visibility, iframe/room validation, and metric correlation. The final focused run passed 36 tests across seven files. Repository TypeScript, the compiled SDLC blueprint, root production build, and hermetic smoke checks passed independently.

`npm run verify` was attempted. Its unit-test stage encountered failures in ground-truth distillation, cross-domain knowledge/data authorization fixtures, agent-pod stability, missing Redis, and the workflow-diagram fixture's missing QueryClient provider. The run was stopped after these failures; it is not a full gate pass. Logs are retained in `artifacts/sdlc-swarm-audit/fixes-verify.log`, with focused tests and independent build/smoke/type-check logs alongside it. Two existing TryCUA test typing errors were corrected by importing the type from its defining module and narrowing the outcome union; provider behavior was unchanged.

The compiled standalone preview confirmed disabled QA evaluation on unavailable evidence, blocked/deferred release defaults, a disabled CAB action, and the removal of simulated patch creation. The main localhost:5000 server was not listening during this verification, so live CREW grounding and the installed org-342 deployment have not been reverified after these changes.

Remaining work is explicit room/repository/cycle binding, signed or otherwise authenticated runner evidence and approval authority, durable idempotent operation/handoff records, runtime policy enforcement, worker/worktree/PR orchestration, real adapters for the demonstration surfaces, and an isolated end-to-end requirement-to-test-deployment acceptance run. Required test-suite manifests and revision-scoped defect lifecycles also need to replace app-wide collection evaluation. The provenance fields checked in this phase establish shape and revision correlation; they do not authenticate a CI provider.

QA evaluation blocked in compiled preview

Release defaults and disabled CAB action in compiled preview

CAB remains disabled at zero readiness with a synthetic valid-format commit entered

Demonstration security surface without simulated patch creation

### Installed org-342 verification follow-up

The running app was a separate installed workspace at the App Forge workspace (`%LOCALAPPDATA%/oddjob-forge/sdlc-workbench-org<id>`), served on port 10002. Restarting the main server alone retained the old compiled UI. The changed template app/lib files were backed up under `artifacts/sdlc-swarm-audit/installed-source-backup`, applied to this workspace, built successfully, and its specific Next.js process restarted. No missions or approval records were submitted.

Live checks in room `crew-1791839278460-gyeon9l` confirmed:
- The mounted app lookup resolves canonical slug `sdlc-workbench-org342` (app 888). A successful recorded `read_app_records` call listed the app-wide `sdlc_integration_outbox` collection with six records. It did not establish selected-tab, telemetry or decision grounding.
- QA has no manual passing-suite writer; the empty-state quality evaluation button is disabled and a commit SHA is required.
- Release defaults are UAT blocked and CAB defer; CAB save is disabled at 0% readiness with six blocked gates.
- The app-to-CREW next-step button prepares a review draft and receives a host acknowledgment. It explicitly reports that no mission launched. The test draft was cleared after capture.

Evidence: `fixes-installed-build.log`, `fixes-live-qa.png`, `fixes-live-release.png`, and `fixes-live-handoff.png` under `artifacts/sdlc-swarm-audit`.

New seam observed: server-resolved mounted-app context is currently appended to the persisted user message, making internal binding JSON visible in the transcript. That enriched message also coincided with an unrelated Scribe MSA suggestion during the read-only probe. Keep grounding metadata separate from authored text and artifact-intent detection in the next repair phase. The successful app lookup does not resolve this presentation/routing defect.

### Grounding separation and navigation follow-up

Mounted-app context now travels as a separate `runRound` parameter and is included in the speaker's system context. It is no longer concatenated into the message used for authored-text classification, artifact intent detection, or user-turn persistence. Existing historical messages are preserved.

The SDLC root layout now mounts `CrewViewBridge`, which reports Next client-side route changes to CREW. The host accepts messages only from the mounted iframe, same origin, matching room and version, and confines reported paths to the current app deployment. This supplies a browser-reported workbench hint; it does not establish selected sub-tab state, verified events or completed actions.

Verification: 13 focused tests passed across the mounted-app service and canvas; the installed org-342 Next build passed. `npm run verify` passed its initial gates/typecheck and encountered the previously observed cross-domain authorization fixture failures in knowledge/data tests; it was stopped after those failures and is not green. Logs: `fixes-grounding-tests.log`, `fixes-view-bridge-build.log`, `fixes-grounding-verify.log`.

The dev server and installed app process were restarted to load these changes. A live read-only probe was submitted; its visible user message omitted internal binding JSON. The browser then became unresponsive to DOM and accessibility reads, preventing verification of the final response and capture. Do not count selected-workbench agent grounding as live acceptance yet. Event-level grounding remains outstanding; app activity messages alone are not authoritative execution evidence.

### App telemetry reader and read-only routing

Added CREW `read_app_activity`, registered in the capability catalog and offered app-tool set. It resolves installed app identity with the existing room/project access gate and reads `app_telemetry` using both app and organization IDs. Results include IDs, names, levels, timestamps, scope and pagination; arbitrary metadata is omitted. These are persisted app-reported events, not execution receipts or room-bound activity. The existing forensic activity feed is now explicitly labeled organization-wide rather than implying app ownership.

Live testing exposed a negation bug: a read-only prompt containing “Do not create documents” was treated as an active Scribe edit. The authoring classifiers now exclude read-only and negated writing requests. Optional recall/persona reads have a 10-second fallback deadline so unavailable context does not indefinitely hold the round before a speaker starts. Those read requests may still complete in the background; execution tools and approvals are not timed out or bypassed by this helper.

29 focused tests passed (six files), including access filters, pagination/provenance, optional-context deadlines and negated authoring. Typecheck passed. Full verify reached tests but again encountered the existing cross-domain authorization fixture failures and was stopped after failures; it is not green. See `fixes-app-activity-tests.log`, `fixes-app-activity-types.log`, and `fixes-app-activity-verify.log`.

Live acceptance remains incomplete: the first activity probe executed the new tool but failed its page-size validation (the model requested 25). The reader now accepts a requested size up to 100 while still returning at most 10 events. That probe also confirmed the negated Scribe-routing bug, which is now covered by regression tests. After loading the fixes, subsequent probes remained in client waiting states without a matching server round-start log. Browser control then timed out on both the current tab and fresh-tab navigation. No successful live event response or new screenshot is claimed. The existing unrelated manuscript remains intact.

### Surface requests through CREW: recommended scope and implementation

Plan now includes a typed app → room input/approval bridge:
1. Questions/forms: bounded field schemas, required-value/type/choice validation, request IDs, origin/iframe/room checks, deduplication, accepted acknowledgment and returned answers.
2. Lifecycle: cancel on app/room/canvas replacement, reject stale submissions, a five-second host-ack deadline and a fifteen-minute answer deadline. Requests are transient; a refresh closes them rather than claiming recovery.
3. Approvals: mount only a persisted `app_record_action` proposal already bound to this room and installed app. Server verifies room membership, app/project access and designated approval access. The existing InlineApprovalCard and decision endpoint preserve permissions and execution behavior. Return only the confirmed persisted approval decision; it is not a new execution receipt.
4. PM pilot: “Request requirements in CREW” collects title, requirements and priority; answers populate a local PM draft for review. No automatic save, mission launch or second execution occurs.
5. Next scope: durable input storage/resume, acknowledgment of consumption by the app, broader approval kinds with explicit source-app/room provenance, and end-to-end regression coverage. Do not treat the generic platform HIL value collector as authorization for a consequential action.

Implemented host schema/cards, surface SDK `requestCrewInput`, guarded existing-approval lookup, and the PM pilot. Questions use the same field schema as forms. Approval requests carry a persisted approval ID, never client-authored action details. The deployed SDLC source copy was updated and rebuilt. Fifteen focused tests passed; blueprint and installed-app builds passed. Repository verify status is recorded separately in `fixes-surface-input-verify.log`.

### No mock data and control audit

All 16 surfaces linked from the installed org-342 SDLC home were opened and inspected. The eight demo surfaces (Operations, Sales, Marketing, Customer Success, Finance, HR, Legal and Security) now show a missing-live-source state and a working CREW setup-input request. DevOps displays only stored deployment, incident and quality-gate records. Removed sample repository diff files/branches and sprint capacity values. Removed PM's local-only Force Approval simulation. Replaced Fleet's PIP action, which launched an unrelated Sprint Kickoff mission and swallowed errors, with a CREW recovery-brief request that never launches a mission.

The legacy shared `sdlc-workbench` copy also contained static workbench tables and a dashboard fallback with fabricated metrics. Those surfaces now expose their unconnected state; they do not inherit the live template's capabilities merely because their names match. Legacy and installed-app builds passed.

A JSX source audit found 93 buttons, with zero missing click/submit/forwarded-handler paths. This establishes wiring, not successful external execution. Live navigation verified all 16 workbench routes. Safely tested form/question return and cancellation, and recovery cancellation. No real approvals, missions, purchases, production deployments or external writes were executed in this audit. Missing Jira/adapter/CI evidence remains a real blocker, with explicit UI states.

Live form acceptance: genuine requirements from this user's request returned into a local PM draft; no record was saved or mission launched. Cancellation returned to the requesting Security surface. Existing approved/rejected decisions can be returned from persisted state without a second approval.

Artifacts: `no-mock-live-control-audit.json`, `no-mock-button-source-audit.json`, `surface-input-return-live.png`, `surface-question-cancel-live.png`, `pm-no-fake-approval-live.png`, and `fleet-recovery-controls-live.png`. Root host build passed (`fixes-surface-host-build.log`). Full verify passed initial gates/typecheck after two small UI type fixes, then encountered the existing cross-domain authorization fixture failures and was stopped; it is not green. Durable input recovery, broader governed approval kinds, and verified room/cycle event binding remain follow-on work.

Final focused result: 20 tests passed across five files, including replay of an already-recorded approval without another approval action. Final live checks confirmed PM's Force Approval control is absent on a loaded PM surface and Fleet's recovery request returns cancellation. Installed app was rebuilt and restarted after the final PM/Fleet changes. Input and approval API guidance is documented in `docs/capabilities/crew_surface_requests.md`.
