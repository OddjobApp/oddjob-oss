# CREW workflows: studio composition, releases, and project ownership

Date: 2026-09-26

Status: source-backed gap analysis and implementation proposal. No production readiness is implied. This review did not run the application, provision a database, invoke external providers, or execute the verification gate.

## Objective and scope

A user can create a Project Space, assemble a workflow in CREW using Project, Signal, Prediction, Agent, Form, Flow, Scribe, Media, and Computer Studio, save and reopen its components, test and publish an immutable release, activate it, observe its runs, and safely release edits.

Studios are authoring surfaces. Their persisted assets and callable operations are workflow dependencies. A mounted pod, a successful proposal, or a stored cycle is insufficient evidence of an operational product.

App Studio remains a supported neighboring capability and may supply a workflow's user-facing application. A custom app is not required to operate a workflow through a form, manual run, API, or event.

## Product responsibilities

| Surface or record | Responsibility |
| --- | --- |
| Project Space | Durable ownership, membership, access, budget, resource discovery, and history |
| CREW | Discussion, proposals, decisions, and opening the relevant authoring surface |
| Project Studio | Versioned delivery plan: objectives, deliverables, dependencies, assignments, milestones, acceptance evidence |
| Flow Studio | Executable graph: inputs, steps, conditions, mappings, waits, and error behavior |
| Specialist studios | Author the resources used by graph steps or entry points |
| Operational cycle | Bounded execution of project work; can build or use several workflows |
| Workflow release | Immutable executable graph and dependency snapshots |
| Deployment | Active release, environment bindings, entry points, and operational status |
| Run | One invocation, pinned to a release, with step attempts, waits, results, and evidence |

A delivery-plan dependency means one deliverable is needed before another. A runtime edge means one step's result controls or feeds another. Keep those graphs separate and explicitly link deliverables to workflows, releases, and assets.

## Evidence and gaps

Paths below are repository-relative. Evidence describes inspected code paths, not live verification. Existing uncommitted changes to packaged Flow/Prediction/Signal pods and studio conformance were present during review and are outside this document's changes.

| Area | Existing code and reusable behavior | Gap to the objective |
| --- | --- | --- |
| CREW mounting | `shared/studio-registry.ts`; `client/src/components/agent-chat/ModularAssemblyPuzzleRail.tsx`; `server/domain/crew/core/crew-orchestrator.service.ts` | Mounting and proposal rendering need a shared workflow/project/asset context, independent of conversation lifetime. Preserve actual mounted client components and packaged wrappers. |
| Project Studio | `client/src/modules/project-studio/ProjectStudio.tsx`, `types.ts`, `dag-utils.ts`; packaged `ProjectStudioPod.tsx` imports the client implementation | Editable waves live in component state. Delivery targets include Scribe, App, Media, Computer, and none; Signal, Prediction, Agent, Form, and Flow are missing. Targets need concrete resource/revision references. |
| Project launch | `ProjectStudio.tsx:handleCommitCycle`; `server/routes/operational-cycles.ts:POST /launch`; `server/domain/mission/core/cycle-manager.service.ts:launchCycle` | Client sends `cycleName` and `waves`; service reads `name` and `blueprints`. Client ignores HTTP status and catches network failures, then emits a committed event. Request omits project identity and multiple plan fields. |
| Alternate plan commit | `server/domain/tools/v1/capabilities/assembly-tools.ts:commit_project_plan_to_cycle` | Separately inserts an active cycle and blueprints; description says atomic but inspected writes are not in a transaction. It does not use the same launch service. Its wave schema omits dependency edges, studio bindings, and acceptance criteria. Consolidate rather than add a third path. |
| Signal | `client/src/modules/signal-studio/SignalStudioPod.tsx`; `server/domain/signal-intelligence/core/signal-feeds.service.ts`; `infrastructure/signal-feed-poller.ts`; `server/worker-entrypoint.ts` | Feed CRUD and scheduled polling are present; the worker calls `startSignalFeedPoller`. Reuse these. Add explicit project/release trigger bindings and prove event-to-workflow delivery, deduplication, and pause behavior. |
| Signal delivery | `server/domain/signal-intelligence/core/world-model-bridge.service.ts:emitStateTransition` | Transition and Kafka outbox commit together; Redis and cycle subscription delivery are also present. Decide the durable workflow-consumer path and test it; do not assume the pipeline event emitter receives these messages. |
| Prediction | `server/domain/tools/v1/capabilities/prediction-studio-tools.ts`; `client/src/modules/prediction-studio/PredictionStudioPod.tsx`; `server/domain/jobs/core/executors/prediction-inference-executor.ts` | CREW's model-test tool builds sample curves and fixed metrics without resolving the model. The executor computes a kinematic forecast locally and echoes model/framework labels; it does not load an ONNX/Python model. Require truthful mode labels and verified model resolution, version/hash, feature schema, and provenance. |
| Agent | `server/domain/agent-cards/core/agent-studio.service.ts`; `shared/schema/agent-cards.ts`; job executor registry | Agent Studio proposals edit agent cards. A card ID is not proof of an executable `ai_agent` job binding. Resolve that mapping explicitly and snapshot instructions, model binding, tools, and configuration for each release. |
| Form | `server/domain/pipeline/core/form-studio.service.ts:publish`; `form-studio-stage-requests.service.ts`; `server/domain/jobs/core/executors/human-approval-executor.ts` | Reuse revision/release storage, published links, project checks, and the existing `{formId, stageId}` job path. Prove release-pinned stage definitions and responses through wait/resume; public form release behavior alone does not establish this. |
| Flow | `server/domain/tools/v1/capabilities/flow-studio-tools.ts`; `server/domain/crew/core/crew-flow-studio.service.ts` | CREW proposes existing jobs and creates manual flows. Schedules, signals, dependencies, deployment bindings, and project attachment need a unified lifecycle. The orchestrator calls the direct flow action, so this path is wired. |
| Runtime | `server/domain/pipeline/core/pipeline-engine.ts`; `server/core/pipeline-executor.ts`; `server/core/pipeline-step-runner.ts` | Pipeline snapshots exist, but start and resume fetch current pipeline steps and current jobs. Make release snapshots the source for execution and resume; a version-history table by itself does not freeze a run. |
| Pipeline event triggers | `server/domain/pipeline/core/pipeline-trigger.service.ts`; `server/domain/pipeline/index.ts` | Service subscribes to `eventStream` in `start()` and is exported through the facade. Review searches did not establish a production start caller. Trace lifecycle registration before claiming automatic triggers work; add a startup/delivery test. |
| Scribe | `shared/schema/scribe.ts`; `server/domain/scribe/core/scribe.service.ts`; `scribe-export.service.ts` | Reuse documents, branches, authoring operations, and Word/Markdown export. Add immutable source snapshots and a runtime generation/export adapter returning durable artifacts. PDF export explicitly reports unsupported in the inspected exporter. |
| Media | `shared/schema/media-studio.ts`; `server/domain/media-studio/core/media-studio.service.ts`; `api/media-studio.routes.ts` | Reuse project-scoped productions, manuscript import, requests for takes, status refresh, assembly, and assets. Add release-bound templates and an async job adapter that waits for actual completion, with cancellation and recovery. |
| Computer | `client/src/modules/computer-studio/ConnectedComputerUseStudio.tsx`; `server/domain/integrations/trycua/computer-use-task.service.ts`; `gemini-computer-use.ts`; `shared/schema/integrations/trycua.ts` | Studio uses persisted tasks, steps, and confirmation state. Bind reusable automation definitions to a project and deployment; do not publish a live desktop session as the definition. Verify private-project access beyond org scoping. |
| Computer pipeline job | `server/domain/jobs/core/executors/computer-use-executor.ts`; `executor-registry.ts`; `server/worker-entrypoint.ts`; `server/core/bootstrap.service.ts` | Executor discovery is wired at startup. This executor uses `runAgentLoop`, creates a session, and always ends it in `finally`; it does not invoke the Studio task service. Reconcile these paths before promising durable takeover/login waits in a workflow. |
| Project ownership | `shared/schema/projects.ts`; `server/domain/projects/core/project.service.ts` | Existing junction allows cycle, mission, app, dataset, job_collection, kb_document, and form. Resource IDs are integers; Computer tasks and other assets may use UUIDs. Existing direct project columns and room-derived ownership also need reconciliation. Validate each resource type before attachment. |
| Resource discovery | `server/domain/resource-catalog/resource-catalog.service.ts`; `resource-studio.service.ts` | Reuse resource keys, graph relations, action contracts, and impact analysis. Extend collectors and project filtering instead of creating a competing catalog. A catalog graph is not an immutable release manifest. |

The older `docs/PROJECT_SPACES_DESIGN.md` still says proposed/not implemented. The current schema and project service are the evidence for this review; do not infer current implementation status from that header.

## Required architecture decisions

### 1. Reuse the pipeline runtime

Add a workflow lifecycle around pipelines rather than a second graph execution engine. A workflow has a stable product identity; its draft references an editable pipeline; its releases contain an executable snapshot. Existing pipeline APIs remain compatible during migration.

Do not convert every planning wave into an AI mission automatically. A deliverable must declare whether it is manual work, an authoring task, or a bound workflow invocation.

### 2. Separate release and activation

Draft -> validated draft -> immutable release. A deployment binds a release and moves through inactive, activating, active, paused, failed, and retired states. Runs have independent states including waiting for approval, external work, or operator intervention.

Publishing validates and snapshots; activation registers entry points only after runtime/environment readiness succeeds. A failed activation must not leave partly active triggers. Use a transaction for database state and an outbox/reconciler for external registration. A compensating cleanup path is required where registration cannot be transactional.

### 3. Snapshot the transitive execution dependencies

The release manifest includes graph steps and mappings, job configurations, agent definitions, form definitions/stages, Scribe branch content/templates, Media production templates, Computer instructions/skill revisions, prediction implementation/model artifacts, and trigger definitions. Include adapter contract versions and artifact hashes where applicable.

Avoid resolving mutable `latest` dependencies at run time or resume. Record model identifiers and settings, but do not promise identical generative outputs across runs. External providers can change; provenance makes that visible, not deterministic.

Pin code/runtime compatibility too: deployment must refuse a release whose adapter contract or required runtime version is unavailable. Database snapshots cannot freeze a changed executor implementation by themselves.

### 4. Use typed resource references

Proposed logical reference: `{ kind, id: string, revision?, digest? }`. Validate the ID and ownership through a resource-kind resolver. Preserve integer-backed existing APIs; add a surrogate integer asset-reference record if using the existing project junction for UUID resources. Do not coerce UUIDs to integers or widen existing columns without a migration/backfill strategy.

Reuse the resource catalog's keys for discovery. Native studio stores remain authoritative for editing. Immutable release content and retained artifacts must remain available after a draft is edited or its CREW room is archived.

### 5. Enforce organization and project scope at every boundary

Resolve ownership server-side. Apply existing project roles to plan editing, release creation, activation, running, and viewing outputs; explicitly define those permissions rather than assuming org membership grants private-project access.

Validate every transitive reference at publication and authorize access again at execution. Pinned content does not override revoked access, a disabled credential, or current organizational policy. Trigger workers act through a bounded service principal with project permissions. Shared assets retain their source ownership and require an explicit reference grant.

### 6. Standardize adapter outcomes

Each executable adapter supports validation, dependency snapshotting, execution, status/recovery, and cancellation where applicable. Outcomes distinguish completed, failed, waiting, and cancelled; a remote job accepted for processing is waiting, not completed.

Persist a run ID, step identity, attempt, idempotency key, external operation ID, and wait reason before handing off work. Resume reconciles remote state before retrying. For ambiguous Computer submissions, require inspection/operator resolution instead of blindly replaying a consequential action. Do not promise exactly-once external effects where the destination cannot support them.

### 7. Keep secrets and sessions out of releases

Deployments contain authorized credential references, provider settings, and environment requirements. Releases contain no secret values, cookies, or desktop session recordings used as authentication. Store large artifacts in the existing approved durable storage path after validating its retention and access model; retain metadata and checksums in PostgreSQL. Avoid introducing another blob service unnecessarily.

### 8. Make Prediction modes explicit

Support a declared built-in kinematic implementation separately from registered-model inference. A valid built-in release pins its algorithm/runtime version and clearly identifies heuristic outputs. Registered-model releases resolve an actual accessible artifact and runtime, validate feature names/types/units, and capture model version/hash, horizon, input timestamp, and inference provenance.

Do not present hard-coded confidence or latency as measured quality. Acceptance criteria should include appropriate evaluation/calibration evidence before a model is used for consequential routing. Preview/test results cannot silently become production inference.

## Proposed persistence and APIs

Names are proposed and should be reconciled with the existing pipeline schema before migration.

| Record | Minimum responsibility |
| --- | --- |
| Project plan + plan revision | Project owner, optimistic revision, structured waves/deliverables and resource bindings |
| Workflow | Stable ID, org/project owner, title, draft pipeline binding, draft revision, archive status |
| Workflow release | Workflow ID, release number, immutable manifest/digest, creator, validation evidence |
| Deployment | Workflow/release, environment, trigger/config bindings, status and activation generation |
| Run binding | Existing pipeline execution -> workflow release/deployment/project; initiating event ID |
| Step snapshot/attempt | Stable release step ID, configuration snapshot, attempt and remote/wait correlation |
| Artifact reference | Run/step provenance, storage reference, content type/hash, access and retention metadata |

Prefer extending current execution and artifact records to duplicating them. Use unique constraints for workflow release numbers, scoped publication request keys, deployment activation generations, and trigger-event run deduplication.

Proposed operations:

- Read/save project plan with expected revision; return 409 on concurrent changes.
- Create/reopen workflow draft in a project and open a bound asset in its studio.
- Validate/test the exact draft revision and retain results tied to its digest.
- Publish that revision idempotently; reject stale approval/validation evidence.
- Activate/pause a deployment and report readiness and failures accurately.
- Start a run, inspect it, resolve authorized waits, and cancel where supported.
- Compare releases and switch the deployment to a compatible prior release for new runs.

Initial API home: existing project routes for project plans; a lifecycle submodule in the pipeline domain for workflow releases/deployments. Thin controllers delegate validation/authorization and persistence to services. Any new route must be mounted and tested; any new top-level UI path needs both dev/prod SPA dispatch entries and the Operations router.

## User experience

Project Space offers Overview, Plans, Workflows, Assets, Runs & approvals, Connections, and CREW rooms, adapted to existing navigation. A workflow page exposes its draft, releases, active deployment, and run history.

Project Studio shows each deliverable's bound asset, owning studio, draft/release status, blockers, and acceptance evidence. Opening a specialist studio preserves project/workflow/deliverable context. Saving returns a canonical resource identity and revision to the plan.

Release readiness aggregates actual validation evidence. It must distinguish missing configuration, failed validation, pending human decision, published-but-inactive, and active. A green plan checkbox cannot substitute for runtime checks.

Editing a live product starts/updates a draft. Publishing a new release changes no running invocation. Activating it affects new invocations. Rollback affects future runs and never claims to undo an already delivered document, message, or portal submission.

## Ordered implementation packages

### P0 — Repair Project Studio's delivery handoff

First bounded implementation slice: Project Studio plan -> validated, project-scoped backend request -> durable cycle/blueprints -> confirmed UI result -> reloadable result.

- Define one shared Zod request/response contract; resolve `name`/`blueprints` versus `cycleName`/`waves` explicitly.
- Carry project identity, dependency edges, studio/resource bindings, acceptance criteria, task assignments, budget, token limit, and concurrency settings without loss.
- Consolidate the UI and `commit_project_plan_to_cycle` tool through a service; avoid bypassing authorization or changing execution semantics as an incidental UI fix.
- Persist related rows transactionally and use an idempotency key. Queue publication must be recoverable; a queue/cache failure after insertion must not make a retry create a duplicate cycle.
- Return cycle ID and actual state. Emit committed/saved events only after validated success; display actionable errors and preserve the draft on failure.
- Treat mission spawning/synthesis as distinct from persistence and show their actual states.

Acceptance: failures never emit success; retry after uncertain response returns the same cycle; private-project/foreign-org references are rejected; dependencies and studio bindings round-trip; existing launch callers retain compatibility.

### P1 — Durable plans, ownership, and discovery

Persist revisioned project plans and extend deliverable targets to all nine studios. Add typed asset bindings and catalog resolvers, with project-aware list/read/write checks. Reopen exact resources from Project Space and CREW. Preserve working UI state only as a cache of the server record.

Acceptance: close/reopen restores the plan; concurrent edits conflict; a room can be archived without losing owned resources; numeric and UUID resource references work; referenced resources cannot leak private-project data.

### P2 — Release-pinned execution

Add workflow/release records and extend pipeline executions to carry a release binding. Snapshot steps and transitive job/resource definitions. Update both start and resume to read the pinned snapshot. Define legacy-run behavior explicitly; do not silently invent snapshots for historical runs.

Acceptance: pause a run, edit every mutable dependency, resume, and observe the original definitions. A new release uses the edits. Missing/incompatible dependencies fail publication or activation with precise reasons.

### P3 — First operational workflow

Deliver a manually started workflow containing an actual agent job, a Form Studio stage approval, and a Scribe-generated durable document. Reuse the human-approval path and introduce only the missing release-aware adapters. Project Studio tracks the product and evidence; Flow Studio edits its executable graph.

Acceptance: publish, activate, run, approve, obtain artifact, reload history, edit, publish v2, and roll back new runs. Validate permission revocation, duplicate approval, failed provider call, and restart while waiting.

### P4 — Signal and Prediction

Bind a signal subscription to a deployment through the established durable event infrastructure. Confirm worker/start wiring and cross-process event delivery. Add typed prediction steps, truthful built-in mode, and registered-model inference only when a real resolver/runtime is verified. Share the inference service between CREW testing and pipeline execution.

Acceptance: duplicate delivery starts one run; paused deployments do not start new runs; thresholds read typed prediction output; invalid/inaccessible model IDs fail; sample curves cannot be published as measured inference.

### P5 — Media and Computer

Add async Media generation/assembly adapters. Reconcile Computer pipeline execution with the persisted Studio task service. Bind sessions/tasks and generated outputs to run/step/project context and implement waiting, cancellation, timeout, and recovery. Carry prediction/agent/form outputs as structured inputs to these operations.

Acceptance: completion waits for real output; login/takeover survives workflow suspension; duplicate callback does not advance twice; worker restart does not blindly resubmit a portal operation; cancelled runs handle outstanding external work explicitly.

### P6 — Unified release and operations UI

Add dependency diffs, release readiness, deployment activation/pause/rollback, run graph, approval inbox, artifact links, and runtime health/cost information to the existing project surfaces. Reuse the resource catalog and current telemetry rather than synthesizing success from presence of IDs.

Acceptance: every status has a backing record/event; users can navigate plan -> asset -> release -> run -> output and back, with permissions enforced on direct URLs as well as lists.

### P7 — Full multi-studio acceptance and rollout

Exercise: Signal event -> Prediction -> Agent -> Form approval -> Scribe document -> Media asset -> Computer delivery. Project Studio owns the delivery plan, Flow Studio owns the runtime graph, and Project Space holds all records and evidence.

Start with deterministic test providers and a controlled portal fixture; then run a separately configured live-provider smoke test. Fixture success is not evidence that production credentials, desktops, or model providers are ready. Keep external sending/submission disabled except in the explicitly configured test destination.

## Verification and completion criteria

For each implementation package, run targeted behavior tests and the repository gate `npm run verify`. Verify that newly added tests are selected by Vitest. Do not claim a passing gate from historical artifact logs.

For schema/persistence work: add migrations and runtime journal entries, provision the dedicated test database with `npm run test:db:setup`, then run relevant integration tests and `npm run smoke:db`. Never use the development database for integration tests. Coverage thresholds remain a separate CI concern per AGENTS.md.

Required failure cases include stale draft publication, cross-org references, private-project denial, double activation, duplicate signal, worker death during wait, dependency edits during approval, missing provider/model, failed artifact write, ambiguous external submission, cancellation, and rollback compatibility.

The original objective is complete only when the full lifecycle is demonstrated through the mounted UI and real persistence/runtime paths. This document completes the review and implementation plan; P0-P7 remain implementation work, and none is marked delivered by this source review.
