# Cycle Blueprint Builder — Implementation Backlog

**Design direction:** Operational Timeline Canvas  
**Delivery target:** MVP through Create and Stage  
**Estimation unit:** Story points (1, 2, 3, 5, 8)  
**Reference design:** `CYCLE_BLUEPRINT_BUILDER_DESIGN_SPEC.md`

## Delivery status — July 28, 2026

The agreed feature scope is implemented: canonical drafting, server persistence, Timeline/Flow/Data authoring, Form Agent and pipeline-output mappings, governed published Workbench app steps, App Forge publishing return, readiness, transactional Cycle creation, runtime completion, restart recovery, and authenticated browser coverage.

Infinite-canvas polish, raw-definition editing, simulation, real-time collaboration, reusable nested flows, and full AI structural generation are enhancement candidates rather than blockers. Slack and AgentMail require valid organization credentials for live delivery verification.

## Delivery order

```text
Foundation
→ Draft persistence
→ Builder shell
→ Canonical graph model
→ Editable timeline and outline
→ Inspector
→ Validation and multi-view
→ Review and Cycle creation
→ Hardening
```

## Epic 0 — Product and architecture decisions

**Progress:** CBB-001 through CBB-004 completed in the initial R0 implementation pass.

### CBB-001 — Approve canonical vocabulary

**Owner:** Product  
**Points:** 1

Acceptance criteria:

- Cycle, cycle blueprint, phase, dependency, branch, data flow, milestone, and template have one documented meaning.
- App Forge blueprint terminology is explicitly out of scope.
- UI labels are approved.

### CBB-002 — Approve lifecycle transitions

**Owner:** Product + Cycle domain  
**Points:** 2

Acceptance criteria:

- Define, Build, Connect, Review, Stage, and Active transition rules are documented.
- Builder Draft, Cycle Draft, Staged, and Active persistence states are mapped.
- Backward transitions and active-Cycle editing are specified.

### CBB-003 — Select canvas and layout libraries

**Owner:** Frontend architecture  
**Points:** 3

Acceptance criteria:

- React Flow, Cytoscape, or an alternative is evaluated against typed handles, custom nodes, accessibility, minimap, and large-graph performance.
- Dagre or an alternative is selected for auto-layout.
- A short architecture decision record is committed.

### CBB-004 — Define canonical Cycle draft schema

**Owner:** Cycle domain  
**Points:** 5

Depends on: CBB-001

Acceptance criteria:

- Stable IDs exist for phases and edges.
- Dependencies, branches, and data flows are separate typed collections.
- Existing phase fields have migration mappings.
- Schema version is included.
- JSON examples cover linear, parallel, approval, failure, and prediction Cycles.

## Epic 1 — Draft persistence

### CBB-101 — Add builder draft database schema

**Owner:** Backend  
**Points:** 3

Depends on: CBB-004

Acceptance criteria:

- `cycle_builder_drafts` stores organization, user, source, definition, schema version, validation summary, timestamps, and expiry.
- Organization and ownership indexes exist.
- Secrets are rejected or stripped.
- Migration includes rollback guidance.

### CBB-102 — Implement draft CRUD API

**Owner:** Backend  
**Points:** 5

Depends on: CBB-101

Acceptance criteria:

- Create, fetch, update, and delete endpoints enforce tenant and user permissions.
- Updates support optimistic concurrency.
- API returns a conflict response for stale versions.
- Contract tests cover access boundaries.

### CBB-103 — Implement blank-draft initialization

**Owner:** Backend  
**Points:** 2

Depends on: CBB-102

Acceptance criteria:

- Blank draft contains valid Cycle defaults.
- Draft starts in Define.
- No placeholder phase is persisted until the user adds one.

### CBB-104 — Implement template-to-draft initialization

**Owner:** Backend  
**Points:** 3

Depends on: CBB-102

Acceptance criteria:

- Template structure is copied into a new draft.
- Secrets, run history, and environment identifiers are excluded.
- Missing organization integrations become requirements.

### CBB-105 — Implement Cycle duplicate-to-draft

**Owner:** Backend  
**Points:** 3

Depends on: CBB-102

Acceptance criteria:

- Existing Cycle definition is normalized into a new draft.
- Runtime state and schedule identifiers are excluded.
- Draft records source Cycle provenance.

### CBB-106 — Add autosave client

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-102

Acceptance criteria:

- Changes autosave after a short debounce.
- Saving, saved, offline, failed, and conflict states are visible.
- Leaving the page never discards acknowledged unsaved changes silently.
- Conflict recovery preserves both local and server definitions.

### CBB-107 — Add Drafts list to Cycles

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-102

Acceptance criteria:

- Cycles surface can filter or navigate to Drafts.
- Draft rows show name, owner, lifecycle step, validation state, and last edit time.
- Users can resume, rename, duplicate, or discard owned drafts.

## Epic 2 — Builder shell

### CBB-201 — Add builder routes

**Owner:** Frontend  
**Points:** 2

Acceptance criteria:

- `/operations/cycles/new` creates or resumes a blank draft.
- `/operations/cycles/drafts/:draftId` loads a draft.
- `/operations/cycles/:cycleId/design` can initialize an edit draft when authorized.
- Direct navigation preserves authentication return paths.

### CBB-202 — Build Cycle Builder page shell

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-201

Acceptance criteria:

- Existing Oddjob navigation shell is reused.
- Header, workspace, inspector, readiness strip, and drawer regions exist.
- 1440 × 1024 matches the selected design hierarchy.
- Layout handles 1024, 1280, and 1440 px widths.

### CBB-203 — Build title editor and draft status

**Owner:** Frontend  
**Points:** 2

Depends on: CBB-106, CBB-202

Acceptance criteria:

- Cycle title edits inline.
- Draft badge and save status are always visible.
- Empty title validation is accessible and non-destructive.

### CBB-204 — Build lifecycle state and transition controls

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-002, CBB-202

Acceptance criteria:

- Draft, validated, Cycle Draft, staged, and active states have distinct labels.
- Create and Stage focuses unmet requirements when blocked.
- Draft state remains visible beside the Cycle title.
- The builder does not expose Active as an MVP action.

### CBB-205 — Build primary action controller

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-204

Acceptance criteria:

- Primary action label matches the lifecycle step.
- Blocking validation disables only transitions that require validity.
- Disabled state explains the next fix.
- Activation is not available from the MVP builder.

## Epic 3 — Canonical client model

### CBB-301 — Build normalized builder store

**Owner:** Frontend platform  
**Points:** 8

Depends on: CBB-004

Acceptance criteria:

- Cycle settings, lanes, phases, edges, resources, selection, viewport, and validation are normalized.
- Selectors avoid full-canvas rerenders for inspector edits.
- Serialization produces the canonical draft schema.
- Hydration handles supported older schema versions.

### CBB-302 — Add command-based undo and redo

**Owner:** Frontend platform  
**Points:** 5

Depends on: CBB-301

Acceptance criteria:

- Add, delete, move, connect, disconnect, duplicate, and field edit actions are undoable.
- Autosave does not clear history.
- Undo never creates an invalid dangling edge.
- Keyboard shortcuts work on Windows and macOS conventions.

### CBB-303 — Implement existing Blueprint adapter

**Owner:** Frontend + Cycle domain  
**Points:** 5

Depends on: CBB-004, CBB-301

Acceptance criteria:

- Existing `Blueprint` arrays import into the normalized store.
- Names used by legacy dependency references resolve to stable IDs.
- Export remains compatible with current Cycle creation and validation.
- Round-trip fixtures cover every existing phase type and relationship.

### CBB-304 — Add schema migration runner

**Owner:** Frontend platform  
**Points:** 3

Depends on: CBB-004

Acceptance criteria:

- Draft schema versions migrate deterministically.
- Migration does not mutate the stored source until autosave succeeds.
- Unsupported versions display recoverable guidance.

## Epic 4 — Canvas and outline

### CBB-401 — Build base canvas

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-003, CBB-301

Acceptance criteria:

- Pan, zoom, fit, selection, and viewport restore work.
- Canvas respects Oddjob theme tokens.
- Canvas remains responsive with the inspector open.
- Reduced-motion preference is honored.

### CBB-402 — Build phase groups and timeline rows

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-401

Acceptance criteria:

- Groups show name, orchestration hint, collapse, and contextual Add Phase.
- Rows align precisely with the editable time grid.
- Phases can move between groups.
- Group movement does not change execution behavior.
- Collapsed groups preserve dependency comprehension.

### CBB-403 — Build Mission node

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-401

Acceptance criteria:

- Node shows name, type, owner, and validation.
- Selected state exposes typed handles and toolbar.
- Node is keyboard selectable and announces its summary.

### CBB-404 — Build Prediction node

**Owner:** Frontend  
**Points:** 2

Depends on: CBB-403

Acceptance criteria:

- Prediction is distinguishable without relying on color.
- Prediction-specific validation appears on the node.

### CBB-405 — Build Milestone node

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-403

Acceptance criteria:

- Approval gate is distinguishable without relying on color.
- Approved and rejected handles are semantically labeled.
- Pausing behavior is visible.

### CBB-406 — Build dependency edge

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-401

Acceptance criteria:

- Default connection creates finish-to-start.
- Non-default dependency type and offset are inspectable.
- Invalid cycles are rejected before committing the edge.

### CBB-407 — Build outcome edges

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-405

Acceptance criteria:

- Success, failure, approved, and rejected edges have labels and distinct line styles.
- One outcome cannot silently target multiple phases unless the schema permits it.
- Edge creation can target an existing or newly inserted phase.

### CBB-408 — Build selection toolbar

**Owner:** Frontend  
**Points:** 2

Depends on: CBB-403

Acceptance criteria:

- Edit, duplicate, delete, and more actions work.
- Toolbar does not obscure connectors.
- Delete remains undoable.

### CBB-409 — Build Add Phase command palette

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-403, CBB-404, CBB-405

Acceptance criteria:

- Mission, Prediction, Milestone, and Saved Pattern are searchable.
- Contextual insertion between connected phases rewires safely.
- Keyboard shortcuts are documented and functional.
- New phase name receives focus.

### CBB-410 — Add timeline layout and collision handling

**Owner:** Frontend platform  
**Points:** 5

Depends on: CBB-003, CBB-402, CBB-406, CBB-407

Acceptance criteria:

- Layout derives bar positions from dependencies, offsets, durations, and manual start constraints.
- Parallel phases receive distinct readable rows.
- Milestones align to their computed time.
- Rework and failure branches avoid critical labels where possible.
- Twenty-phase fixture remains readable.

### CBB-411 — Build accessible outline

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-301

Acceptance criteria:

- Every canvas phase and relationship is represented.
- Add, reorder, duplicate, delete, and connect have non-drag controls.
- Keyboard-only users can construct a valid three-phase Cycle.
- Outline and canvas selections remain synchronized.

## Epic 5 — Inspector

### CBB-501 — Build selection-aware inspector shell

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-301, CBB-202

Acceptance criteria:

- Inspector switches between Cycle, phase, edge, and lane modes.
- Switching selection does not lose unsaved edits.
- Sections use consistent progressive disclosure.

### CBB-502 — Build Cycle settings inspector

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-501

Acceptance criteria:

- Name, objective, recurrence, timezone, priority, budget, integrations, and global resources are editable.
- Required Define fields are clearly marked.
- Existing Cycle form controls are reused where practical.

### CBB-503 — Build Mission inspector

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-501

Acceptance criteria:

- Purpose, agent, inputs, outputs, duration, timeout, retry, budget, and failure behavior are editable.
- Advanced settings remain collapsed by default.
- Existing input components and validation messages are reused.

### CBB-504 — Build Prediction inspector

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-501

Acceptance criteria:

- Dataset, features, target, confidence threshold, output, and low-confidence behavior are editable.
- Unsupported legacy config remains visible in Raw config.

### CBB-505 — Build Milestone inspector

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-501

Acceptance criteria:

- Decision, approver policy, evidence, pause, timeout, escalation, and outcomes are editable.
- A pausing milestone cannot pass validation without an approver policy.

### CBB-506 — Build connection inspector

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-501, CBB-406, CBB-407

Acceptance criteria:

- Dependency type, offset, outcome, condition, source, and target are inspectable.
- Unsupported combinations are disabled with explanations.

## Epic 6 — Validation and readiness

### CBB-601 — Extract local graph validation

**Owner:** Frontend platform  
**Points:** 5

Depends on: CBB-301

Acceptance criteria:

- Duplicate names, missing names, dangling edges, circular dependencies, missing branch targets, and unmapped required inputs are detected.
- Validation returns stable issue IDs and object references.
- Rules run incrementally after edits.

### CBB-602 — Adapt server validation for drafts

**Owner:** Backend  
**Points:** 5

Depends on: CBB-102, CBB-004

Acceptance criteria:

- Draft validation accepts the canonical schema.
- Existing Cycle validation logic is reused.
- Errors, warnings, and suggestions have stable codes.
- Response maps issues to phase or edge IDs.

### CBB-603 — Build Problems drawer

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-601, CBB-602

Acceptance criteria:

- Issues group by severity.
- Selecting an issue focuses the object and field.
- Resolved issues disappear without closing the drawer.
- Empty state confirms readiness.

### CBB-604 — Build readiness strip

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-603

Acceptance criteria:

- Shows phases, approvals, errors, suggestions, estimate, and save state.
- Each metric opens the related view.
- It remains one row at 1280 px.
- It is not styled as a set of dashboard cards.

### CBB-605 — Add lifecycle validation gates

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-204, CBB-603

Acceptance criteria:

- Each forward transition evaluates the correct requirements.
- Blocked transition focuses the highest-priority issue.
- Warnings require acknowledgement only where policy specifies.

## Epic 7 — Multi-view Cycle inspection

### CBB-701 — Add Timeline/Flow/Data mode control

**Owner:** Frontend  
**Points:** 2

Depends on: CBB-401

Acceptance criteria:

- Current mode is URL- or state-restorable.
- Switching modes preserves selection.
- Timeline remains the default.

### CBB-702 — Build Data Flow view

**Owner:** Frontend  
**Points:** 8

Depends on: CBB-301, CBB-601

Acceptance criteria:

- Cycle inputs, resources, phase inputs, outputs, and mappings are visible.
- Required unmapped inputs are prominent.
- Mappings can be created without editing raw JSON.
- Data edges are distinguishable without color.

### CBB-703 — Build editable Timeline canvas

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-301

Acceptance criteria:

- Existing Gantt and critical-path logic is adapted to canonical draft phases.
- Parallel work, milestones, offsets, critical path, and total duration are visible.
- Phase bars support accessible start and duration editing.
- Dragging horizontally changes only the manual start constraint.
- Resizing changes only estimated duration.
- Dependency constraints prevent impossible moves and explain the blocker.

### CBB-704 — Build Definition view

**Owner:** Frontend platform  
**Points:** 8

Depends on: CBB-303, CBB-304

Acceptance criteria:

- Generated YAML or JSON reflects current canonical state.
- Valid text edits update the visual model.
- Invalid edits never replace the last valid state.
- Large text changes show a structural diff before apply.

### CBB-705 — Add round-trip property tests

**Owner:** Quality + Frontend platform  
**Points:** 5

Depends on: CBB-704

Acceptance criteria:

- Visual model → definition → visual model preserves semantics.
- Tests cover all phase and edge types.
- Randomized valid graph fixtures are included.

## Epic 8 — Review and Cycle creation

### CBB-801 — Build Review screen

**Owner:** Frontend  
**Points:** 5

Depends on: CBB-603, CBB-703

Acceptance criteria:

- Objective, recurrence, phase counts, approvals, inputs, integrations, duration, cost when available, validation, and test status are summarized.
- Review links back to the relevant editor location.
- No activation control appears in the MVP.

### CBB-802 — Implement draft-to-Cycle transaction

**Owner:** Backend  
**Points:** 8

Depends on: CBB-004, CBB-602

Acceptance criteria:

- A valid builder draft creates one Cycle atomically.
- Canonical phases export into the current execution-compatible model.
- Source draft and validation provenance are recorded.
- Retry cannot create duplicate Cycles.

### CBB-803 — Add Create as Draft

**Owner:** Frontend  
**Points:** 3

Depends on: CBB-801, CBB-802

Acceptance criteria:

- User explicitly selects Create as Draft.
- Success navigates to Cycle detail.
- Created Cycle cannot run until staged or activated.

### CBB-804 — Add Create and Stage

**Owner:** Frontend + Backend  
**Points:** 5

Depends on: CBB-802

Acceptance criteria:

- Action creates the Cycle and enters existing staging.
- Validation errors block the action.
- Staging receives unresolved agent, integration, credential, input, and schedule requirements.

### CBB-805 — Add creation audit

**Owner:** Backend  
**Points:** 3

Depends on: CBB-802

Acceptance criteria:

- Audit includes creator, source, validation, applied AI changes when applicable, and chosen creation path.
- Secret values are never stored in the audit.

## Epic 9 — Quality and rollout

### CBB-901 — Add keyboard and screen-reader test suite

**Owner:** Quality  
**Points:** 5

Depends on: CBB-411, CBB-501

Acceptance criteria:

- Keyboard-only user can create a three-phase Cycle.
- Focus order and announcements meet the design spec.
- Axe reports no critical violations in core states.

### CBB-902 — Add large-Cycle performance fixtures

**Owner:** Quality + Frontend platform  
**Points:** 5

Depends on: CBB-410

Acceptance criteria:

- Fixtures include 5, 20, and 100 phases.
- Pan, select, and inspector edits stay within agreed responsiveness targets.
- Validation does not freeze the main thread.

### CBB-903 — Add autosave recovery tests

**Owner:** Quality  
**Points:** 3

Depends on: CBB-106

Acceptance criteria:

- Tests cover refresh, offline, conflict, server error, and stale draft.
- No acknowledged edit is silently lost.

### CBB-904 — Add create-and-stage end-to-end test

**Owner:** Quality  
**Points:** 5

Depends on: CBB-804

Acceptance criteria:

- Test builds a Cycle with parallel phases, approval, failure branch, resource, and data mapping.
- Validation is resolved.
- Cycle is created and staging opens with correct requirements.

### CBB-905 — Add feature flag and migration rollout

**Owner:** Platform  
**Points:** 3

Acceptance criteria:

- Builder can be enabled by organization.
- Existing Create Cycle remains available during pilot.
- Draft data has an export path before disabling the flag.

### CBB-906 — Run moderated usability pilot

**Owner:** Product design  
**Points:** 3

Depends on: CBB-904

Acceptance criteria:

- At least five target users complete a five-phase Cycle task.
- Time, errors, confusion points, and confidence are recorded.
- Critical issues are triaged before broad release.

## MVP critical path

```text
CBB-001
→ CBB-004
→ CBB-101
→ CBB-102
→ CBB-301
→ CBB-401
→ CBB-403/404/405
→ CBB-406/407
→ CBB-501
→ CBB-601/602
→ CBB-603
→ CBB-801
→ CBB-802
→ CBB-804
→ CBB-904
```

## Suggested parallel tracks

### Track A — Domain and persistence

CBB-004, CBB-101–105, CBB-602, CBB-802, CBB-805

### Track B — Builder foundation

CBB-003, CBB-201–205, CBB-301–304

### Track C — Canvas

CBB-401–411

### Track D — Inspector and validation

CBB-501–506, CBB-601, CBB-603–605

### Track E — Review, quality, and rollout

CBB-701–705, CBB-801–804, CBB-901–906

## Definition of done

A story is complete when:

- Acceptance criteria pass.
- Loading, empty, error, permission, and keyboard states are handled.
- Unit or integration coverage matches the risk.
- No new critical accessibility violation is introduced.
- Draft schema and API changes are documented.
- Existing Cycle creation and staging tests continue to pass.
