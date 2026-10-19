# Oddjob Cycle Blueprint Builder — Roadmap

**Status:** Agreed feature scope implemented and release-tested
**Last updated:** July 28, 2026
**Product location:** Operations → Cycles → Create Cycle
**Selected design:** Operational Timeline Canvas (option 3)

## Outcome

Create a Figma-like visual builder that turns an operational idea, template, or existing Cycle into a validated Oddjob Cycle that can move through:

```text
Builder Draft → Validated → Tested → Cycle Draft → Staged → Active
```

The builder is the Cycle creation and design experience. It is not a separate blueprint product.

## Product principles

1. The canvas must represent executable behavior, not an unrestricted drawing.
2. Simple Cycles should be faster to create than they are in the current form.
3. Advanced users retain precise inspector and definition-level control.
4. Drafting is safe and resumable; activation is always explicit.
5. Flow, data, and schedule are different views of one canonical Cycle definition.
6. Existing Cycle staging, validation, and execution remain the downstream system of record.

## Release roadmap

### R0 — Definition and interaction foundation

**Goal:** Remove ambiguity before implementation.

**Duration:** 1–2 weeks

**Status:** Complete.

Deliverables:

- Canonical Cycle draft schema.
- Vocabulary: Cycle, phase, dependency, branch, data flow, milestone, template.
- Navigation and route contract.
- Draft lifecycle and transition rules.
- Canvas interaction specification.
- Three visual directions and one selected design.
- Architecture decision for graph library and normalized state model.

Exit criteria:

- Visual direction approved.
- Schema round-trip examples pass.
- Product, design, and engineering agree on MVP boundaries.

R0 artifacts:

- `docs/cycle-builder/R0_PRODUCT_CONTRACT.md`
- `docs/architecture/ADR-021-cycle-builder-canvas.md`
- `shared/schema/cycle-builder-draft.ts`
- `shared/schema/cycle-builder-draft.fixtures.ts`
- `shared/schema/cycle-builder-draft.test.ts`

### R1 — Resumable Cycle drafting

**Goal:** Make Create Cycle safe to start, leave, and resume.

**Duration:** 2–3 weeks

**Status:** Complete. Organization-scoped optimistic persistence, local recovery fallback, exact-revision updates, and transactional Cycle creation are implemented.

Deliverables:

- Create Cycle start screen.
- Blank, template, and duplicate entry paths.
- Builder draft persistence.
- Autosave state and recovery.
- Cycle-level settings inspector.
- Drafts section on the Cycles dashboard.
- Create as Cycle Draft.

Exit criteria:

- A user can create and resume a draft.
- Draft data survives browser and server restarts.
- Creating a Cycle produces a valid record compatible with existing staging.

### R2 — Visual flow builder

**Goal:** Make the Cycle understandable and editable as a flow.

**Duration:** 4–6 weeks

**Status:** Complete for the agreed builder scope. Timeline, Flow, and Data are synchronized views of the canonical draft.

Deliverables:

- Infinite canvas with pan, zoom, minimap, and auto-layout.
- Mission, milestone, and prediction nodes.
- Typed dependency and success/failure connectors.
- Selection, multi-select, duplicate, delete, undo, and redo.
- Phase library and right-side inspector.
- Keyboard-accessible outline alternative.
- Reuse of existing Blueprint Builder field controls.

Exit criteria:

- A user can construct a five-phase Cycle entirely through the UI.
- Circular dependencies cannot be created silently.
- Canvas, inspector, and outline remain synchronized.

### R3 — Validation, data flow, and timeline

**Goal:** Prove the Cycle is structurally runnable before creation.

**Duration:** 3–4 weeks

**Status:** Complete for the agreed builder scope. Canonical and server readiness validation, governed mappings, Cycle creation, and runtime manifests are implemented.

Deliverables:

- Continuous local and server validation.
- Problems panel with focus-to-fix behavior.
- Data Flow view with input/output mapping.
- Timeline view with parallel paths and critical path.
- Definition view with safe YAML/JSON round-trip.
- Final review summary.
- Create and Stage.

Exit criteria:

- Blocking issues prevent creation or staging.
- Every required phase input has a visible source.
- Visual and text definitions pass round-trip tests.

### R4 — Test and readiness

**Goal:** Show how the Cycle behaves before activation.

**Duration:** 3–5 weeks

**Status:** Complete. Exact-revision readiness, source-Cycle conflict detection, published-app and integration verification, deterministic dependency-aware simulation, cost forecasting, automated tests, authenticated browser contracts, and production builds are delivered.

Deliverables:

- Sample input sets.
- Happy-path simulation.
- Failure injection.
- Branch execution preview.
- Runtime and cost estimate.
- Execution-story results.
- GMS quick score and shadow-validation integration.
- Readiness status on the Cycle review.

Exit criteria:

- Users can predict the selected path for a test scenario.
- Test evidence is retained with the Cycle draft.
- High-risk activation policy can require testing.

### R5 — AI-assisted composition

**Goal:** Reduce the time from operational intent to a strong first draft.

**Duration:** 3–5 weeks

**Status:** Complete. Contextual recommendations and full canonical structural generation are delivered through the configured architecture engine, with schema validation, human review, readiness reset, and a deterministic fallback when no engine is configured.

Deliverables:

- Generate Cycle from objective.
- Suggest phases, parallelization, resources, and integrations.
- Add failure and approval paths.
- Map inputs and outputs.
- Simplify Cycle.
- Reviewable AI structural diff.
- AI change audit trail.

Exit criteria:

- AI never activates a Cycle or binds credentials.
- Every AI change can be applied or dismissed independently.
- Generated drafts meet the same validation rules as manual drafts.

### R6 — Reuse and optimization

**Goal:** Make successful Cycle designs easier to repeat and improve.

**Duration:** 4–6 weeks

Deliverables:

- Save Cycle as a sanitized template.
- Parameterized template fields.
- Reusable phase groups.
- Organization sharing.
- Template quality signals.
- Improvement suggestions based on run history.

Exit criteria:

- Templates contain no environment credentials or run data.
- A template can create a new valid Cycle draft.
- Suggested improvements are traceable to execution evidence.

## MVP boundary

The MVP consists of R0 through R3.

It supports:

- Blank, template, and duplicate starts.
- Autosaved builder drafts.
- Figma-like flow canvas.
- Mission, milestone, and prediction phases.
- Dependencies, branches, resources, and data mappings.
- Problems, Data Flow, Timeline, and Definition views.
- Create as Draft and Create and Stage.

It does not require:

- AI generation.
- Simulation.
- Direct activation.
- Reusable nested flows.
- Collaboration.
- Public marketplace distribution.

## Workstreams

### Product and UX

- Finalize information architecture.
- Define draft and Cycle state transitions.
- Select visual direction.
- Specify canvas gestures and keyboard behavior.
- Define empty, loading, validation, and failure states.
- Usability-test simple and complex Cycle creation.

### Frontend platform

- Normalized builder state.
- Graph canvas and auto-layout.
- Inspector and phase library.
- Undo/redo command model.
- Draft autosave.
- Multi-view synchronization.
- Definition round-trip.

### Cycle domain and API

- Draft persistence.
- Schema normalization.
- Validation contract.
- Draft-to-Cycle creation transaction.
- Duplicate-to-draft.
- Template-to-draft.
- Audit and permissions.

### Intelligence and simulation

- Test scenario schema.
- GMS scoring adapter.
- Shadow-validation adapter.
- Runtime and cost estimation.
- AI generation and structural diff.

### Quality

- Schema property tests.
- Graph invariant tests.
- Accessibility and keyboard tests.
- Autosave recovery tests.
- Large-cycle performance tests.
- End-to-end create-and-stage tests.

## Initial epic backlog

### Epic A — Builder shell and navigation

- Add Create Cycle entry from Cycles dashboard.
- Add Drafts filter or tab.
- Create builder route and page shell.
- Add draft status, save state, and exit behavior.
- Add lifecycle indicator.

### Epic B — Draft service

- Define `cycle_builder_drafts`.
- Create CRUD endpoints.
- Add optimistic autosave.
- Add recovery and expiry policy.
- Add duplicate and template initialization.

### Epic C — Canonical Cycle model

- Normalize existing `Blueprint` phase fields.
- Define stable node and edge IDs.
- Separate dependencies, branches, and data-flow edges.
- Add schema version.
- Implement Cycle import/export adapters.

### Epic D — Canvas

- Select graph library.
- Build viewport, controls, minimap, and auto-layout.
- Build phase node types.
- Build typed connection handles.
- Add selection and editing commands.
- Add accessible outline.

### Epic E — Inspector

- Build Cycle settings mode.
- Reuse mission objective and duration controls.
- Reuse dependency and offset controls.
- Reuse resource, input, and output controls.
- Add milestone approval configuration.
- Add prediction configuration.

### Epic F — Validation

- Extract local structural rules.
- Adapt server validation to drafts.
- Add Problems panel.
- Implement focus-to-fix.
- Gate Create and Stage actions.

### Epic G — Multi-view editing

- Build Flow view.
- Build Data Flow view.
- Integrate Timeline or Gantt preview.
- Build Definition editor.
- Add safe visual/text round-trip.

### Epic H — Cycle creation

- Build review summary.
- Create Cycle Draft transaction.
- Create and Stage transition.
- Preserve source and validation audit.
- Add success handoff to Cycle detail or staging.

### Epic I — Verification

- Unit-test graph transformations.
- Property-test schema round-tripping.
- Test autosave conflict and recovery.
- Add keyboard and screen-reader coverage.
- Add five-, twenty-, and hundred-phase performance fixtures.
- Add create-and-stage end-to-end test.

## Tasking status

The Operational Timeline Canvas direction is selected. Detailed stories, dependencies, points, and acceptance criteria are captured in `CYCLE_BLUEPRINT_BUILDER_IMPLEMENTATION_TASKS.md`.

Backend schema, draft persistence, validation, and lifecycle work can proceed in parallel with the builder shell and canvas foundation.

## Milestones

| Milestone | Demonstrable outcome |
|---|---|
| M1 — Draft saved | Start a Cycle, leave, and resume it. |
| M2 — Flow composed | Build a valid five-phase Cycle on the canvas. |
| M3 — Ready to stage | Resolve validation, inspect data and timeline, and create the Cycle. |
| M4 — Behavior tested | Run scenarios before activation. |
| M5 — AI accelerated | Generate and review a Cycle draft from an objective. |
| M6 — Reusable | Save a safe template and create another Cycle from it. |

## Key product decisions

1. Default first-time users to guided outline or free canvas.
2. Decide whether agent assignment is required before creation or staging.
3. Define which warnings require acknowledgement.
4. Define retention and ownership for abandoned drafts.
5. Define how edits to an active Cycle create a safe new revision.
6. Define the exact snapping, calendar, and manual-start rules for editable Timeline behavior.
