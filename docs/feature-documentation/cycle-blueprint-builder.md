# Cycle Blueprint Builder

## Overview

Cycle Blueprint Builder is Oddjob's visual authoring experience for creating and revising **Cycles**. It is not a separate blueprint marketplace or a new primary object: the output is an Oddjob Cycle that can be staged and activated through the existing operational workflow.

The selected interface direction is the **Operational Timeline Canvas**. It combines a schedule-first timeline with Flow and Data views, so an author can understand time, dependencies, conditional outcomes, and value handoffs without treating the canvas as an unrestricted drawing surface.

## Location and entry points

The feature lives under **Operations → Cycles**.

| User intent | Target experience |
|---|---|
| Create a Cycle | `Operations → Cycles → Create Cycle` |
| Resume authoring | `Operations → Cycles → Drafts` |
| Revise an existing Cycle | `Operations → Cycles → [Cycle] → Design` |

Planned routes are:

```text
/operations/cycles/new
/operations/cycles/drafts/:draftId
/operations/cycles/:cycleId/design
```

## Draft-to-activation lifecycle

```text
Builder Draft → Cycle Draft → Staged → Active
```

- A **Builder Draft** is autosaved authoring state and is safe to leave and resume.
- **Create as Draft** turns a structurally valid builder draft into an inactive Cycle. It does not require credentials, a schedule, or a completed test run.
- **Create and Stage** creates the Cycle and moves into the existing staging workflow to resolve agents, integrations, runtime inputs, approvals, and schedule.
- Only a ready staged Cycle can be explicitly activated. The builder never activates a Cycle directly.
- Editing an active Cycle creates a new builder draft; it does not mutate the running Cycle.

Validation (`unchecked`, `invalid`, `valid`) and testing (`not_run`, `failed`, `passed`) are revision properties rather than independent Cycle lifecycle states.

## Canvas behavior

The primary Timeline view presents phases in a time-aware operational layout. The secondary Flow and Data views operate on the same draft, rather than maintaining separate definitions.

- **Phases** are mission, prediction, or milestone nodes.
- **Dependency edges** control schedule constraints.
- **Outcome edges** represent conditional control flow.
- **Data edges** map Cycle inputs, resources, or phase outputs into a phase input.
- **Stage groups** organize the authoring canvas only; they do not change execution behavior.

Moving a phase adjusts its manual timing constraint only. It must not silently alter dependencies, outcome routes, or data mappings.

## Current implementation status

The builder is available at `Operations → Cycles → Create Cycle`. Timeline, Flow, and Data edit one canonical draft. Drafts use optimistic server autosave with local fallback, exact-revision validation/readiness, and transactional Cycle creation. Phases can bind Form Agents, pipeline outputs, and governed published Workbench apps.

Created Cycles contain executable phase manifests. Mission phases launch through the normal Cycle orchestrator; app phases pause in `waiting_on_app` until an authorized completion, failure, or skip action is recorded. Cycle Manager exposes the bound app and its runtime actions.

The agreed feature scope is complete as of July 28, 2026. Verification includes schema, component, and App Forge return tests plus seven authenticated Playwright contracts. Browser coverage verifies Timeline/Flow/Data synchronization, phase creation, persistence, accessible controls, draft CRUD, stale-version rejection, readiness gating, governed app rejection, transactional Cycle creation, duplicate prevention, and durable app completion. Live Slack and AgentMail delivery depends on valid external organization credentials and is integration readiness rather than missing builder functionality.

## Draft API

The builder backend now exposes an organization-scoped persistence contract at `/api/cycle-builder`:

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/drafts` | List the caller's drafts. |
| `POST` | `/drafts` | Create a validated canonical draft. |
| `GET` | `/drafts/:id` | Load an owned draft. |
| `PATCH` | `/drafts/:id` | Update a draft with its current `version`; stale updates return `409`. |
| `DELETE` | `/drafts/:id` | Delete an owned draft. |
| `POST` | `/drafts/:id/create-cycle` | Atomically create an inactive Cycle and phase records from a valid draft. |
| `POST` | `/cycles/:cycleId/edit-draft` | Open or resume an owner-scoped revision draft populated from the current Cycle settings. |
| `POST` | `/drafts/:id/publish-revision` | Publish a ready revision in place for planning Cycles, or create a planning successor for a Cycle that has already run. |
| `POST` | `/copilot/generate` | Generate a canonical phase and dependency graph through the configured architecture engine, with a deterministic starter-graph fallback. |
| `POST` | `/simulate` | Forecast dependency-aware duration, token consumption, blended cost, limit compliance, and structural risks. |

The deployable database migration is [0002_cycle_builder_drafts.sql](../../migrations/runtime/0002_cycle_builder_drafts.sql); [0073_cycle_builder_drafts.sql](../../migrations/0073_cycle_builder_drafts.sql) is retained for the legacy migration series. The browser authoring shell uses the API and retains local storage only as an offline/recovery fallback.

## Editing and existing settings

Cycle Detail exposes **Edit in Builder** at `/operations/cycles/:cycleId/edit`. The builder loads a separate, autosaved revision draft, resets validation after every edit, and requires the exact revision to pass readiness before publication. Planning and pending-approval Cycles are updated transactionally in place. Active, paused, reviewing, closed, and cancelled Cycles are immutable; publishing creates a new planning successor linked by `revisesCycleId`.

Cycles created before the canonical builder are supported. On first edit, Oddjob reconstructs a canonical draft from the Cycle's relational blueprints, dependencies, executable configuration, and current operational metadata; later edits resume normal canonical revisions.

Revision drafts record the source Cycle timestamp and status. Publication returns `409 SOURCE_CYCLE_CHANGED` if another surface changed the Cycle after the revision was opened, preventing a structurally valid draft from overwriting newer operational settings.

The revision contract preserves the settings previously exposed by the Cycle edit panel:

| Setting | Revision behavior |
|---|---|
| Name, description, objective, priority, budget, token limit | Stored in the canonical draft and published to the Cycle. |
| Approval requirement | Stored in the draft and published to `requiresApproval`. |
| Recurrence, timezone, next run, overlap, failure pause, catch-up, cooldown, run limit | Stored under the typed scheduling contract and published to Cycle fields and metadata. |
| Follow-up template and timeline unit | Stored in the draft and published to operational metadata. |
| Blueprint resources and resource answers | Blueprint resources remain on the graph; answers are preserved in Cycle metadata. |
| Revision reason | Recorded in the published Cycle metadata for audit context. |
| Integration credential values | Deliberately excluded from builder JSON. They remain encrypted, organization-scoped, and managed through Cycle integrations. An in-place revision retains them; a successor must complete integration readiness before activation. |

Approval and manual triggering now query the Cycle integration contract and return `422 INTEGRATIONS_NOT_READY` with sanitized missing integration identifiers when a required secret has neither an encrypted value nor an environment fallback.

## Copilot generation and simulation

**Generate graph with Copilot** submits the current objective and resource context to the organization's configured architecture engine. The returned phases and dependencies must pass the canonical schema before they can replace the canvas. If no architecture engine is configured, Oddjob supplies an explicit three-step starter graph rather than silently failing or inventing an unvalidated payload. Generated graphs always return to unchecked readiness and require human review, validation, and staging.

**Simulate cost and duration** performs a deterministic, non-executing forecast over the current draft. It calculates dependency critical-path duration, default or phase-configured token estimates, a documented blended token-cost estimate, budget and token-limit compliance, and risks such as dependency cycles or phases without an owner, app, or tool. Simulation assumptions are returned with every result and do not replace provider-specific billing or runtime readiness.

## App Builder and Component Gallery integration

The Data view provides a governed round trip from a selected phase into App Builder or the Component Gallery. The builder saves the current draft and return context before navigation.

Only installed, published Workbench deployments are eligible for phase binding. The phase definition records the app identifier, deployment identifier, release reference, publication assertion, and launch route. Unpublished or mutable app drafts are excluded from the binding catalog.

The authoring shell now uses the draft API for optimistic server autosave and retains local storage as an offline fallback. Form Agents, pipeline outputs, and published Workbench apps can be mapped directly from the Data view.

After validation, **Create Cycle** persists the exact current revision and invokes the transactional draft-to-Cycle endpoint. Stale revisions are rejected, duplicate creation returns the existing Cycle, failures retain the draft, and successful creation opens the new planning Cycle.

Created Cycles include executable blueprint manifests in operational metadata. At runtime, an app phase verifies that its deployment remains published and belongs to the Cycle organization, records `waiting_on_app`, and blocks dependent phases. Operators can open the bound app and complete or skip the step from Cycle Manager; apps may also report completion through the scoped app-action endpoint. Completion output is attached to the configured output port, dependency gates resume, and lifecycle changes are published over the existing Cycle event stream. Failed or timed-out app steps fail the phase.

App-step resolution is durable across process restarts. Terminal status, output, and completion time are stored on the relational Cycle blueprint before the in-process wake-up is emitted. Waiters poll this persisted state as a backstop, so a completion cannot be lost in the event-registration race. On worker startup, active Cycles left in `waiting_on_app` are replayed. Replay treats completed/skipped app phases and completed or already-running mission phases idempotently, allowing downstream dependency gates to continue without launching duplicate work.

Validation includes a server-side staging-readiness preflight against the exact optimistic draft revision. It revalidates the canonical graph and verifies that each Workbench binding is complete, published, active or installed, organization-scoped, and still associated with the expected app. Results and their timestamp are persisted on the draft. Any subsequent edit clears the result, and Cycle creation is rejected until the current revision passes.

The App Builder round trip preserves the source draft and phase through Forge and App Publishing. Publishing returns the exact app and deployment metadata to the originating builder. The builder verifies that the draft and phase still exist, writes the governed binding using optimistic concurrency, selects the affected phase, and automatically reruns staging readiness. Conflicts retain the return payload and surface an actionable error instead of silently binding to a changed draft.

## Reference artifacts

- [Product proposal](../history/BLUEPRINT_BUILDER_PROPOSAL.md)
- [Roadmap](../history/CYCLE_BLUEPRINT_BUILDER_ROADMAP.md)
- [Design specification](../history/CYCLE_BLUEPRINT_BUILDER_DESIGN_SPEC.md)
- [Implementation backlog](../history/CYCLE_BLUEPRINT_BUILDER_IMPLEMENTATION_TASKS.md)
- [R0 product contract](../cycle-builder/R0_PRODUCT_CONTRACT.md)
- [Canvas architecture decision](../architecture/ADR-021-cycle-builder-canvas.md)
- [Draft schema](../../shared/schema/cycle-builder-draft.ts)
- [Copilot for Cycles and Missions proposal](../proposals/COPILOT_CYCLE_OPERATIONS_PROPOSAL.md)
