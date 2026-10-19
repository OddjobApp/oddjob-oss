# SDLC product journey review — 2026-10-14

## Verdict

SDLC has useful requirements, planning, QA evidence and release-review pieces. This audit does **not** establish a dependable end-to-end product for managing development-agent swarms. Shared execution identity, durable accepted handoffs, contextual discovery and predictable embedded navigation remain critical seams.

This review used CREW room `crew-1791997494282-89x976m`, organization 342, canonical app `sdlc-workbench-org342`, public path `/app/sdlc-workbench-fszvh`. No mission, approval, deployment or external write was executed. Screenshots below were captured during this review; source findings are distinguished from live observations.

## Journey health

1. **Open app / select context — impaired.** Home loads, but unrelated budget-app and flight-search decisions appear inside SDLC. Fleet reports the organization's latest active cycle rather than a bound development project. The home promise of end-to-end delivery exceeds the evidenced readiness.
2. **Requirements / PM — blocked in this live run.** Clicking PM Workbench twice, including after App home reset, left the home page visible. An independent attempt at the proxied PM route timed out. This does not prove every route is broken; it blocks verification of this journey in the current session.
3. **Planning / development — source reviewed, execution unverified.** PM and Scrum launch separate named missions. Planning launch notifications do not prove that development accepted or completed work. No repository/branch/commit/PR/CI acceptance chain was executed.
4. **QA — source reviewed, execution unverified.** Persisted suite evidence and commit-bound gates are useful foundations. Required suite completeness and authenticated CI receipts still need proof; a reported suite is not independently verified CI evidence.
5. **Release — source reviewed, execution unverified.** Same-commit QA/UAT/CAB checks improve continuity. Production deployment was not run. The product needs a visible artifact lineage and deployment receipt rather than an inferred stage transition.
6. **Recovery / measurement — fragmented.** Fleet is scoped to the organization's latest cycle; DevOps reads persisted records. Browser-local handoff notifications are not a durable recovery state machine. VSM requires real correlated change/deployment/incident data before outcome metrics can be trusted.
7. **CREW awareness — failed both live probes.** The auditor called `get_document_content` once and failed. A targeted follow-up explicitly requested `read_app_records` and `read_app_activity`; Backend Architect instead called `get_agent_personality` twice with invalid arguments. These turns provide no app-record or activity evidence. Registered tools alone do not establish agent readiness.

## Prioritized findings and acceptance criteria

| Priority | Finding | Evidence | Required outcome |
| --- | --- | --- | --- |
| P1 | Mounted app disappears when an empty room obtains its persisted session | Live canvas disappeared after first response; AgentChatPanel clears app list on `session?.organizationId` change | Initializing the same room and same effective org preserves selected app, route and canvas. Actual room/org changes still clear context. |
| P1 | Embedded workbench navigation is not dependable | PM home link remained on home after repeat/reset; direct route attempt timed out | Every catalog link reaches its own heading, preserves room/org context, and Back/App home/Exit restore the expected screen. Test in the installed deployment, not template source alone. |
| P1 | CREW cannot reliably choose app evidence tools | Turns 4381 and 4383: one failed document lookup, then two failed personality lookups | A read-only app audit discovers collections and reads applicable records/activity, or states a concrete permission/schema/tool blocker. No unrelated lookup or invented ID request. |
| P1 | Organization activity and decisions look like development-project state | Live budget/flight decisions; fleet.controller latest active org cycle | Explicit project/repository/cycle binding; default views show matching items only. Organization-wide views remain explicitly labeled opt-in views. Preserve existing org/private-project authorization. |
| P1 | Stage notification is mistaken for workflow handoff | `lib/handoff-queue.ts` uses organization-keyed localStorage | Persist a versioned handoff with project/repository/commit/run IDs, source artifact revisions, destination, status, acceptance receipt, idempotency key and failure/reconciliation state. Reload or a second browser must not lose it. |
| P2 | Inputs and approvals have different context durability | Form answers return to local drafts; approved status does not prove execution | Persist request/answer/decision provenance, bind consumption to original source revision, distinguish answered/approved/consumed/executed, and cancel or supersede stale requests. |
| P2 | Catalog overstates disconnected surfaces | Home describes broad functionality; eight business/security surfaces are explicit unconnected states in source | Mark unavailable surfaces before opening, show exact prerequisites, prioritize the core delivery journey. No sample data or pretend actions. |
| P2 | Swarm management lacks a single change-centric control plane | Separate mission triggers, fleet cycle selection, handoff queue | One change view shows objective, owner, repository, worktree/branch, current commit, active agents, dependencies, blockers, approvals, CI/PR evidence and next eligible transition. |

## Implementation order

1. Repair navigation and session initialization; add regression coverage and rerun live checks.
2. Repair app-grounded agent tool selection and validate with the same CREW probes. Tool results, not prose, decide success.
3. Bind the room to a specific development project/repository/cycle; filter decisions, records and fleet accordingly.
4. Introduce durable, idempotent stage handoffs and consumer acknowledgements using existing governance and tenant boundaries.
5. Connect one real vertical slice: reviewed requirement → planned change → agent branch/PR → CI gate → UAT/CAB → deployment receipt → incident/recovery → measured outcome. Use a provisioned test environment; do not manufacture records to simulate success.
6. Extend other surfaces only after that slice survives refresh, duplicate submission, expired authorization and unknown write outcome.

## Evidence

- `artifacts/sdlc-product-review-2026-10-14/01-home.png`: loaded app, organization-wide unrelated decisions, unverified prerequisites.
- `02-crew-request.png`: submitted read-only multi-perspective review request.
- `03-navigation-stalled.png`: PM click did not leave home.
- `04-crew-grounding-failure.png`: first CREW tool failure.
- `crew-first-response.txt`: first probe transcript.
- `server/domain/apps/platform/fleet.controller.ts`: latest active cycle selected by org.
- `server/blueprints/apps/sdlc-workbench/lib/handoff-queue.ts`: browser notification queue.
- `server/blueprints/apps/sdlc-workbench/app/{pm-workbench,scrum-master-workbench,qa-workbench,stakeholder-workbench}/content.tsx`: separate mission triggers and stage notification paths.

## Fix status

First patch changes app-list/activity reset dependencies from the optional persisted session org to the effective app studio org. This is intended to preserve the mount when an empty room initializes under the same organization, while still resetting on a real org or room change. Live regression remains pending.

A second patch removes the timestamp from handoff notification identity: the same source/target mission, run and destination stage now deduplicate even when retried later. The handoff queue regression suite now supplies explicit organization context and verifies cross-organization isolation: **12 tests passed**. This is a notification repair, not durable workflow implementation. The installed app has now been rebuilt and restarted with this patch.

`npm run verify` passed its static gates and TypeScript check, then encountered unit failures including GMS distillation and cross-domain auth fixtures. Its first handoff suite run also failed; the handoff repair and focused rerun above occurred afterward. Full verification is not green. See `artifacts/sdlc-product-review-2026-10-14/verify.log` and `handoff-tests.log`.

Additional live evidence: `05-crew-app-probe-result.png` and `crew-probes.txt` capture the failed targeted app-read probe. Browser control also timed out opening the direct PM route; navigation therefore needs reproduction independently of browser-controller instability before assigning a precise code cause. The upstream Next server returned HTTP 200 for `/pm-workbench`; this does not verify the rendered screen.

## Repair pass: configuration and contextual evidence

- **Browse/configure:** App Studio's SDLC toolbar now mounts `CrewDevelopmentSetup`. It loads real cycles in the room's exact Project Space, offers repository URLs recorded in project connections, and accepts a repository URL, branch and named test environment. The room host or an organization manager can save; the server rechecks the selected cycle's organization and project. Saving persists configuration only, preserves other cycle context, reloads the canvas, and supplies the configured target to agent prompts. It does not verify credentials, clone a repository, launch agents, grant access or execute a cycle.
- **Fleet binding:** workload reads use the room's explicit numeric cycle binding, with organization and exact app/room/cycle Project Space checks. Missing or incompatible bindings return no agents, not the organization's unrelated latest cycle. Private-project access is not inferred from an org-level app token.
- **App request queue:** SDLC asks for `scope=app`; the gateway filters to the current deployment's app-authored requests. Organization-wide and pipeline decisions are not implicitly presented as SDLC app requests. Cycle-specific pipeline approval aggregation is still outstanding.
- **Tool focus:** explicit read-only app reviews now offer only installed-app discovery, app records and app activity reads. An executed tool-pass regression verifies the declarations offered to generation and the tools allowed at execution. This is bounded to read-only app reviews, not a universal planner.
- **Navigation hardening:** the proxy's tested navigation guard preserves destination filters/hash and CREW context and stops competing React/Next handlers after taking ownership of a proxied link. Modified/middle clicks and reserved/external links retain their normal behavior. The original live failure remains unverified because browser control continues to time out.
- **Installed deployment:** reviewed `platform-client.ts`, `handoff-queue.ts`, and home-page changes were copied to the actual org342 workspace after comparing differences and saving backups. The Next production build passed and the exact verified port10002 process was restarted; runtime reported ready. Build uses `tenantProcessEnv`, not the server environment.
- **Regression results:** 72 relevant tests passed: 66 across seven files (`configuration-tests.log`), three additional binding query checks (`binding-query-tests.log`, 10 tests total), and three configuration persistence tests (`configuration-persistence-tests.log`). These cover configuration save, URL validation, binding guards, organization/null-project query predicates, stale-stage clearing, navigation behavior, app-tool passes and notification isolation. The host build and installed Next build passed. The full gate rerun passed static checks and TypeScript, then reproduced GMS distillation and cross-domain authorization-test failures; it was stopped after those failures while media-test noise continued. `fixes-verify.log` is not a green full gate.

### Isolated test setup

Created an actual local Git fixture outside the Oddjob working tree at a scratch checkout (`%LOCALAPPDATA%/Oddjob/sdlc-acceptance-fixture-<date>`), branch `codex/sdlc-acceptance`, initial commit `43c46b3`. Three executable Node tests passed. It has no remote, customer records, credentials, or production deployment. It is a local repository/test boundary, not a fabricated PR, CI, approval, or deployment receipt; none of those stages have been exercised. This fixture is not injected into SDLC product data.

### Still required

At that checkpoint, durable accepted stage handoffs, source revision/commit lineage, contextual pipeline approval aggregation, resumable cross-provider execution, and the real PR → CI → deployment → recovery acceptance slice remained unimplemented/unverified. The durable handoff pass below supersedes the first two items. Configuration still does not provision all execution adapters.

### Live verification after development-server restart

A fresh browser tab recovered. The main development server restarted with the reviewed source and returned HTTP 200 for the login page. Existing authenticated room access remained available.

1. **Configuration browsing — passed:** the toolbar opens the dialog and lists real same-Project-Space cycles, including SDLC cycle81. There are zero repository URLs recorded in this project's connections. Screenshot `06-development-configuration-live.png`. No arbitrary real cycle or repository was selected as a disposable test target.
2. **Scoped home — passed:** unrelated budget-app/flight requests are absent; the unbound fleet explicitly reports that no development cycle is configured.
3. **PM — passed navigation, blocked execution prerequisite:** the PM heading loads with room/org preserved. Jira is missing; the screen reports the connector blocker. Screenshot `07-pm-navigation-repaired.png`.
4. **QA — passed navigation, no recorded runner evidence:** the QA heading loads and shows zero test suites. No passing CI result was invented.
5. **Other core navigation — passed destination checks:** Sprint Zero, Scrum, Stakeholder, Fleet, VSM and DevOps load their own headings. Initial immediate post-click reads sometimes observed the previous home; the successful checks explicitly waited for destination headings. See `confirmed-navigation.json` and `surface-confirmed-*.txt`; the earlier `repaired-navigation.json` records the premature observations, not successful destination assertions.
6. **CREW app reads — improved, not flawless:** the targeted Backend Architect probe made four calls: an initial `read_app_records` with a missing app argument failed, followed by successful `read_app_activity` and two successful `read_app_records` calls. No document/personality tools were used. The agent obtained app telemetry and the persisted integration-outbox collection. This proves app-evidence access, not a complete SDLC audit or successful mission execution. Screenshot `08-crew-app-reads-repaired.png`, transcript `crew-repaired-probe.txt`.

## Durable handoff pass

The mounted SDLC template now uses a server-backed `sdlc_stage_handoffs` collection for requirements → development, planning → development, QA → UAT, and UAT/CAB → deployment. Existing `app_records` storage is reused; no schema migration is needed. Each handoff preserves the room's configured repository/branch/cycle revision, source record ID/revision/content digest, reviewed ticket references, applicable source mission run or commit, and a destination receipt. The service rechecks organization, application and exact Project Space boundaries.

Offers have deterministic identities and normalized input fingerprints. Concurrent submissions and retries after an unknown response return the original record; conflicting inputs cannot replace it. A small room/app/org-scoped local retry cache retains an unconfirmed offer before sending, but durable history and acknowledgement live on the server. **Retry handoff only** never repeats the analysis mission, decision or source action. Older history is paginated, and source readiness is refreshed explicitly.

Opening a workbench does not acknowledge anything. The destination's explicit **Acknowledge receipt** checks the current binding and source evidence again; pending/failed source runs, edited evidence, superseding same-commit gates and incompatible CAB references block acceptance. Concurrent acknowledgements preserve one original receipt. Generic dataset writes cannot alter handoffs or the protected evidence collections; source workbench writes receive server-derived binding context.

Saving a passing QA gate or approving CAB decision no longer automatically launches UAT or production deployment. It offers a handoff first. An acknowledged destination offers **Prepare review in CREW**, which prepares a read-only draft tied to the installed app and exact handoff ID. The draft reads the persisted source evidence and asks for verified blockers/next actions; it does not send itself or authorize execution. `read_app_records` now supports exact physical `recordId` lookup under its existing access controls. A receipt records software acceptance at a point in time, not human approval, current mission state, CI execution, merge or deployment.

Validation used the provisioned, migration-backed **test database**, not development data. `handoffs-focused.log` records **47 passing tests across seven files**; `handoffs-integration.log` records **26 passing tests across two files**, including real PostgreSQL concurrency, retry, stale-evidence, pagination and isolation checks. Contract fixture quality gates are test-only records, not claims that external CI ran. No sample handoffs or fabricated successful runs were inserted into the live app. The installed Next build passed with the tenant environment allowlist.

The full `npm run verify` static gates and initial TypeScript pass completed, then reproduced the existing GMS distillation and cross-domain authorization-fixture failures. That failed run was stopped; `handoffs-verify.log` is not a green gate. The final incremental `npm run check` and host `npm run build` both exited successfully (`handoffs-check.log`, `handoffs-host-build.log`). Scoped `git diff --check` passed.

After rebuilding the installed template and restarting the verified app and development-server processes, the live authenticated room loaded the new handoff panel. It correctly reported that this room's development repository/cycle must be configured; no handoff acknowledgement or execution was manufactured to populate it. **Configure development** opened and listed the real same-Project-Space cycles, with zero repository URLs recorded in connections. Screenshots `09-durable-handoffs-live.png` and `10-handoff-panel-live.png` capture the installed panel. Populated offer/acknowledgement, concurrency and recovery paths were verified against the isolated test database and component harness, not by writing test records into this live room.

Remaining scope: configure real adapters and execute the requirement → branch/PR → authenticated CI → UAT/CAB → deployment → recovery slice. This handoff contract does not implement a universal cross-provider transaction or universally gate every direct mission tool. Source strategies that drop the trusted binding metadata cannot qualify as verified source runs. Metadata-bound app runs can appear in the scoped fleet, but universal cycle-FK/budget propagation remains outside this pass.

### Follow-up: deployment evidence consumption

Room-scoped app-gateway **Production Deployment** requests now require `context.handoffId` referencing an acknowledged UAT/CAB → deployment handoff under the room's current development binding. Immediately before mission selection, the server revalidates the source digest, current same-commit QA/UAT/CAB evidence, room/app/organization scope and destination receipt. It derives the release commit and approval IDs from that persisted source, overriding caller-supplied release IDs. The subsequent release-evidence lookup is also restricted to that room and binding revision. Validation failures neither launch a mission nor enqueue a retry.

This closes a gateway evidence-consumption gap; it does not turn software receipt into human approval, make execution atomic with evidence validation, or add idempotency to mission creation. Standalone app launches retain their existing release checks, and direct mission tools outside the app gateway are not universally covered by this contract. No real production launch was attempted.

The isolated PostgreSQL handoff suite passed **14 tests**, including invalid/wrong-stage/stale-binding receipts and UAT supersession after acknowledgement (`release-handoff-integration.log`). Gateway regressions passed **9 tests**, including rejected receipts and caller-ID replacement (`release-handoff-gateway.log`). These fixtures remain isolated test data; they do not represent externally executed CI or a deployment.

`npm run verify` passed its static gates and TypeScript check, then reproduced the existing GMS/cross-domain authorization-test failures; the failing run was stopped (`release-handoff-verify.log`). The backend server, worker and MCP bundles built successfully (`release-handoff-build.log`), and scoped `git diff --check` passed. The development server restarted with this source and its login endpoint returned HTTP 200 with HTML. No frontend/template change was required in this follow-up.

### Follow-up: duplicate deployment attempts

Room-scoped app-gateway production launches now reserve one durable attempt per owning app/organization/acknowledged handoff in `sdlc_deployment_launches` before calling mission execution. The existing app-record uniqueness constraint arbitrates concurrent requests. The original success/failure/unconfirmed response is stored and replayed; a reservation without a recorded outcome returns HTTP 202 `unconfirmed`, never another launch. A failed attempt also remains reserved: a retry is not permission to run production again. The reservation is intentionally not released by a timeout.

The collection is protected from generic dataset and CREW record mutations. Authorized app record reads can inspect an attempt using its handoff ID as the physical `recordId`. Its run ID is an execution-launch receipt, not proof of deployment completion. Reconciliation of an interrupted reservation remains explicit; there is no automatic reset or relaunch. A crash before execution can therefore leave a blocked reservation, which favors preventing a duplicate consequential write over guessing whether a launch occurred. This guarantee is limited to room-scoped production launches through this gateway, not all mission entry points or external providers.

The PostgreSQL suite passed **16 tests**, including concurrent reservation ownership, response replay, interrupted reservations, app isolation and generic mutation rejection (`deployment-reservation-integration.log`). **15 unit tests** passed across the gateway and record writer, including a repeated controller request invoking mission execution only once (`deployment-reservation-unit.log`). Backend bundles passed (`deployment-reservation-build.log`). No real production work was launched to test these paths.

The full gate passed static checks and TypeScript, then again encountered the GMS distillation and cross-domain authorization-fixture failures; it was stopped after those failures (`deployment-reservation-verify.log`). Scoped whitespace checks passed. The local development server restarted with this change and returned HTTP 200 with HTML from its login endpoint. The external PR/CI/deployment acceptance slice remains unverified.

### Follow-up: reconcile an interrupted launch

The destination handoff panel now offers **Check deployment attempt** for acknowledged deployment handoffs. Its `POST /missions/deployments/:handoffId/reconcile` gateway route requires mission access and the current exact room/app/organization/Project Space binding. It searches only the reservation's mission and originating deployment, with the full trusted binding and exact handoff ID preserved in mission context. Exactly one nondeleted run establishes a launch receipt; the response separately reports that run's current status and success flag. Unknown receipts can then be recovered durably. Missing matches, lost context or multiple matching runs remain unresolved. The endpoint neither launches work nor resets a reservation, and a launch receipt does not prove external deployment completion.

Reconciliation recovers historical execution evidence rather than reauthorizing execution. It checks the current room binding and acknowledged handoff identity but does not require today's approval state to match the state at launch. Reconfiguration blocks reconciliation of the old attempt through the current room. Existing scoped record reads retain historical evidence.

**17 PostgreSQL tests** and **14 unit/component tests** passed (`deployment-reconcile-integration.log`, `deployment-reconcile-unit.log`). Coverage includes lost-response recovery, different-deployment exclusion, ambiguous evidence, wrong-room isolation and the explicit UI action. Backend and installed Next builds passed. No production launch or fabricated live run was used in testing.

Final verification: the full gate passed static checks and TypeScript, then reproduced the existing GMS/cross-domain authorization-test failures and was stopped (`deployment-reconcile-verify.log`). Scoped whitespace checks passed. Both the installed app and development gateway restarted with the changes. The authenticated live DevOps surface loaded with its configuration prerequisite and empty persisted record collections (`11-devops-reconciliation-live.png`). The recovery button's populated state was tested in the component harness; no fake live handoff was created to display it.

### Verification fixture repair and external readiness inspection

The previously reported GMS/auth failures were stale fixtures, not a reason to weaken production guards. Successful admin tool tests now supply an explicit organization and assert that context is forwarded to MCP handlers; additional tests reject an admin invocation without organization context. Heuristic-distillation tests explicitly opt into the feature and restore the environment afterward; a new disabled-mode test confirms no distillation occurs. **36 tests passed** across the three repaired suites (`verification-fixtures.log`). No production authorization or feature flag was changed.

Read-only GitHub inspection confirmed CLI access to `OddjobApp/ODDJOB`, default branch `Development`, and active Verify Suite/CI-CD/Dependency Audit workflows. The inspected Verify Suite run `31261627511` failed theme linting on an older `feat/project-spaces` revision; it does not validate current local changes. CLI access does not establish a configured CREW app adapter or deployment target. No remote branch, PR, workflow dispatch or deployment was created during this inspection.

A scoped, read-only database check confirmed that rooms `crew-1791839278460-gyeon9l` and `crew-1791997494282-89x976m` belong to Project Space 3 in org342 and have no saved cycle/repository/test-environment binding. Connector metadata for that Project Space plus org-wide connections contains only a connected Google connector. No GitHub, Jira or Confluence connector was found. No secrets were selected. This is a concrete blocker for the app-mediated external acceptance journey; CLI GitHub access is a separate identity and was not copied into app credentials.

### Completed full-suite result and remaining fixture corrections (October 15)

The full `final-flow-verify.log` unit stage finished: **14,101 passed, 3 failed, 40 skipped** across **1,510 files** (about 48 minutes). The earlier GMS/auth failures stayed fixed. Remaining failures were stale expectations: BranchDiffView no longer invents a repository diff or claims a merge after a review request, and `crew_room` is now a supported project/catalog resource. Tests now provide their own diff fixture, verify the evidence-free state, assert review-request wording, and include the room resource's existing view action. Production behavior was not loosened.

The three corrected suites passed **103 tests** (`remaining-gate-fixtures.log`); the Blueprint-CREW contract passed **4 checks** (`blueprint-contract-final.log`). Scoped whitespace checks passed. A complete gate rerun was started and writes to `final-flow-verify-rerun.log`; it is not yet a confirmed green run. External acceptance remains blocked by missing GitHub/Jira app connectors and development target binding. The user was asked to connect accounts through the product, not paste credentials into chat.
