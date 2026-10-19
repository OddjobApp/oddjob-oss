# Cycle Blueprint Builder — Operational Timeline Canvas

**Status:** Core design implemented and release-tested July 28, 2026
**Selected concept:** Option 3 — Operational Timeline Canvas  
**Reference:** `artifacts/cycle-blueprint-builder/operational-timeline-canvas-selected.png`  

The shipped surface uses the Operational Timeline Canvas with synchronized Flow and Data views. App steps use governed published Workbench deployments and a round trip through App Forge. Advanced canvas gestures and collaborative editing remain optional enhancements.
**Surface:** Operations → Cycles → Create Cycle  
**Primary viewport:** Desktop, 1440 × 1024

## Design intent

Operational Timeline Canvas makes time and orchestration the primary mental model for building Oddjob Cycles.

The UI combines an editable Gantt timeline with workflow connections. A user can see when phases start, what runs in parallel, which dependencies and offsets control them, where human gates stop progress, how failure paths rejoin, and which phases define the critical path.

The canvas is Figma-like in its direct manipulation, zoom, selection, and contextual controls—but every object represents executable Cycle behavior.

The design optimizes for:

- Understanding total Cycle duration at a glance.
- Designing parallel work intentionally.
- Editing dependencies without leaving the schedule.
- Making gates, rework, and failure paths visible.
- Preserving Flow and Data views for relationships that time alone cannot explain.

## Navigation

```text
Operations
└── Cycles
    ├── All Cycles
    ├── Drafts
    ├── Templates
    └── Create Cycle
```

Routes:

```text
/operations/cycles
/operations/cycles/new
/operations/cycles/drafts/:draftId
/operations/cycles/:cycleId/design
/operations/cycles/templates
```

The navigation label remains **Cycles**. Operational Timeline Canvas is the creation experience, not a new primary product object.

## Lifecycle

```text
Builder Draft → Validated → Tested → Cycle Draft → Staged → Active
```

The header communicates the current system state through a Draft badge and save status. The MVP does not need a large multi-step wizard; readiness and validation determine whether the Cycle can be created or staged.

Primary actions:

- Validate.
- Run Preview.
- Create Cycle.

Create Cycle opens the final choice:

- Create as Draft.
- Create and Stage.

Activation remains downstream and explicit.

## Page anatomy

```text
┌──────────┬───────────────────────────────────────────────────────────────┐
│ App nav  │ Header: title, draft state, undo/redo, actions               │
│          ├───────────────────────────────────────────────────────────────┤
│          │ View mode: Flow | Data | Timeline                            │
│          ├──────────────┬────────────────────────────────────────────────┤
│          │ Phase groups │ Editable time-based canvas                    │
│          │ and rows     │ dependencies, gates, branches, critical path  │
│          ├──────────────┴───────────────────────────────┬────────────────┤
│          │ Data readiness drawer                       │ Inspector      │
└──────────┴──────────────────────────────────────────────┴────────────────┘
```

### App navigation

- Reuse the existing Oddjob navigation shell.
- Operations is expanded.
- Cycles is selected.
- Do not add a separate Blueprints item.

### Header

Left:

- Create Cycle breadcrumb.
- Editable Cycle title.
- Draft save status.

Center or right:

- Undo and redo.
- Validate.
- Run Preview.
- Primary Create Cycle action.

The header must keep total duration visible near the timeline controls rather than turning it into a dashboard metric.

### View selector

```text
Flow | Data | Timeline
```

Timeline is the default for this direction.

- **Timeline:** schedule, parallelism, dependencies, offsets, gates, and critical path.
- **Flow:** topology, outcomes, and complex branching without a time scale.
- **Data:** resources, inputs, outputs, and mappings.

All views edit one canonical Cycle draft.

## Timeline canvas

### Time axis

The horizontal scale adapts to the Cycle:

- Minutes or hours for short operational Cycles.
- Days for most business processes.
- Weeks or months for strategic Cycles.

Controls:

- Zoom in and out.
- Fit entire Cycle.
- Jump to critical path.
- Select time unit.
- Toggle non-working time when calendar-aware scheduling is supported.

The grid shows major and minor intervals with restrained contrast.

### Phase rows

The left column groups phases into user-editable operational stages such as:

- Discover.
- Review.
- Decide.
- Remediate.

Each group displays its orchestration mode:

- Parallel.
- Sequential.
- Gated.

Groups are organizational in the MVP. Execution remains governed by explicit dependencies.

Each row provides:

- Phase name.
- Type icon.
- Owner when space permits.
- Validation state.
- Add Phase control.
- Collapse and expand.

### Phase bars and nodes

Missions and predictions appear as duration bars:

- Drag horizontally to set a manual earliest start.
- Resize the right edge to change estimated duration.
- Move vertically to another stage group.
- Select to expose handles and inspector.

Milestones appear as zero-duration diamonds aligned to the time grid.

Failure and rework phases use the same phase shape with a restrained red status treatment. They are not a separate executable type.

Each phase object shows:

- Name.
- Duration.
- Type icon.
- Validation indicator.
- Optional owner.

### Dependencies

Dependency connectors are editable directly on the timeline.

Supported relationships:

- Finish to Start.
- Start to Start.
- Finish to Finish.
- Start to Finish.

Non-default dependencies show a compact label. Offsets display inline, for example:

```text
FS +2h
SS -1d
```

Selecting a dependency opens the inspector with:

- Type.
- Offset direction.
- Offset value and unit.
- Source.
- Target.
- Delete.

Circular dependencies are rejected before the edit commits.

### Branches

Outcome branches are overlaid on the schedule:

- Success or approved: solid green connector with text label.
- Failure or rejected: dashed red connector with text label.
- Neutral conditional branch: labeled neutral connector.

Branches may rejoin the main path. Rejoining must not imply a dependency unless the canonical model explicitly creates one.

### Critical path

The critical path is a first-class timeline layer.

- Critical phases and dependencies receive a stronger stroke.
- Non-critical paths remain visible but quieter.
- Total Cycle duration updates when duration, offset, or dependency changes.
- A “Critical path” toggle isolates the path without hiding approval or failure behavior required for comprehension.

### Now marker

For a new Cycle draft, do not show a real “Now” marker unless the user sets an intended start date. When a start exists, the marker and calendar dates derive from it.

## Inspector

The inspector appears as a right-side panel or contextual floating panel that does not cover the selected phase.

Selection modes:

- No selection: Cycle settings.
- Phase selected: phase configuration.
- Dependency selected: scheduling relationship.
- Branch selected: outcome and condition.
- Group selected: stage label and description.

### Phase inspector

Essential:

- Objective.
- Agent or owner.
- Estimated duration.
- Inputs.
- Outputs.

Advanced:

- Timeout.
- Retry.
- Budget.
- Tools and permissions.
- Integrations.
- Failure policy.
- Raw configuration.

### Milestone inspector

- Decision requested.
- Approver policy.
- Evidence required.
- Pause behavior.
- Timeout.
- Approved and rejected outcomes.

### Cycle inspector

- Name and objective.
- Start and recurrence.
- Timezone.
- Priority.
- Budget.
- Global inputs and resources.
- Required integrations.

## Data readiness drawer

The bottom drawer summarizes whether the Cycle has what it needs to run:

- Cycle input readiness.
- Resource bindings.
- Integration availability.
- Credential requirement status without exposing credential values.
- Unmapped phase inputs.

Collapsed state:

```text
Data readiness — 3 of 4 inputs ready — 1 warning
```

Expanded state uses a grouped list, not large dashboard cards.

Selecting an issue switches to Data mode and focuses the mapping.

## Flow view

Flow view removes the time grid and emphasizes topology:

- Phase nodes.
- Dependencies.
- Success and failure branches.
- Approval gates.
- Rework loops.

It reuses the same positions when possible, but may apply an explicit auto-layout.

Flow view is recommended for:

- Complex conditional routing.
- Explaining the Cycle to stakeholders.
- Editing branches that are visually crowded on the timeline.

## Data view

Data view shows:

- Cycle inputs.
- Resources.
- Phase inputs and outputs.
- Data mappings.
- Required integrations.

Control-flow edges fade while dashed data connections become primary.

Every required input must show a source:

```text
Risk Prediction
├── identity_inventory  ← Identity Inventory.output
├── privilege_summary  ← Privilege Analysis.output
└── policy_exceptions   ← Cycle resource: ServiceNow
```

Unmapped required inputs are validation errors.

## Add Phase workflow

The Add Phase action lives above the phase-row column and within each group.

Palette entries:

- Mission.
- Prediction.
- Milestone.
- Saved Pattern.

Insertion behavior:

1. Add to the selected stage group.
2. Place at the selected time or after the selected phase.
3. Create a sensible default finish-to-start dependency only when insertion context is unambiguous.
4. Move focus to the phase name.
5. Open the phase inspector.

All insertion actions have keyboard and menu equivalents.

## Direct manipulation

### Move a phase

Dragging horizontally adjusts `scheduledStart`, not hidden dependency logic.

If dependencies constrain the phase:

- The bar cannot move earlier than its computed earliest start.
- The UI shows the blocking dependency.
- Moving later creates or updates a manual scheduling constraint.

### Resize a phase

Dragging the end handle updates estimated duration.

- Duration snaps to the visible grid.
- Modifier key enables finer adjustment.
- Milestones cannot be resized.
- Total duration and critical path update live.

### Connect phases

Dragging from a typed handle creates a dependency.

- Default is finish-to-start.
- A compact popover allows another relationship or offset.
- Invalid connections explain why they were rejected.

## Draft and validation behavior

- Draft autosaves after meaningful edits.
- Save state is always visible.
- Undo and redo remain independent of autosave.
- Local validation runs incrementally.
- Server validation is authoritative.

Issue levels:

- Errors block Create and Stage.
- Warnings require acknowledgement when policy specifies.
- Suggestions are optional.

Selecting an issue:

1. Switches to the best view.
2. Scrolls or zooms to the object.
3. Selects it.
4. Opens the precise inspector field.

## Preview behavior

Run Preview opens an execution simulation:

- Supply sample inputs.
- Preview happy path.
- Inject phase failure.
- Show selected branches.
- Show actual versus estimated schedule when historical data exists.
- Estimate cost and duration.
- Present an execution story alongside technical detail.

Simulation is post-MVP but the action location is reserved in the design.

## Empty states

### Empty timeline

Show:

- A clear Add Phase action.
- A concise prompt: “Add the first phase to begin this Cycle.”
- Optional template suggestions.

Do not cover the timeline with a large tutorial modal.

### No selection

Inspector shows Cycle settings and:

> Select a phase or connection to configure it.

### No data issues

Collapsed readiness state:

> Data ready. All required inputs have sources.

## Responsive behavior

### ≥1280 px

- Full nav, phase rows, timeline, inspector, and data drawer.

### 1024–1279 px

- Navigation collapses to icons.
- Inspector becomes a narrower overlay.
- Phase row labels truncate with tooltips.

### 768–1023 px

- Inspector becomes a slide-over.
- Data drawer becomes a full-width sheet.
- Flow view may be more practical than Timeline for editing.

### <768 px

View and light-edit only:

- Outline becomes primary.
- Timeline is pan/zoom and selection only.
- Full schedule authoring directs users to desktop.

## Accessibility

- Every timeline operation has a form or outline equivalent.
- Keyboard users can change start, duration, dependency, and offset numerically.
- Edge types use labels and line styles, not color alone.
- Screen-reader phase labels include type, name, owner, start, duration, validation, and dependencies.
- Arrow keys navigate rows and time positions.
- Reduced-motion mode removes animated path traversal and smooth zoom.
- Primary controls meet a 40 × 40 px target minimum.

## Visual language

- Base: near-black and graphite.
- Primary: cool indigo.
- Valid/success: restrained emerald.
- Approval: amber.
- Failure: red.
- Grid: low-contrast neutral.
- Critical path: stronger primary or white stroke, never color alone.
- Typography: existing Oddjob sans-serif stack.
- Icons: existing Lucide library.
- Shadows: reserved for the floating inspector and menus.

Avoid:

- Neon cyberpunk styling.
- A card for every row.
- Excessive gradients or glass.
- Permanently bright grid lines.
- Dashboard KPI tiles.
- Unlabeled dependency lines.

## Component map

```text
CycleBuilderPage
├── CycleBuilderHeader
│   ├── CycleTitleEditor
│   ├── DraftSaveStatus
│   └── BuilderActions
├── BuilderViewSwitcher
├── TimelineWorkspace
│   ├── PhaseGroupColumn
│   │   ├── PhaseGroup
│   │   └── AddPhaseButton
│   ├── TimelineCanvas
│   │   ├── TimeAxis
│   │   ├── TimelineGrid
│   │   ├── MissionBar
│   │   ├── PredictionBar
│   │   ├── MilestoneDiamond
│   │   ├── DependencyEdge
│   │   ├── OutcomeEdge
│   │   ├── CriticalPathLayer
│   │   └── TimelineControls
│   └── BuilderInspector
│       ├── CycleInspector
│       ├── PhaseInspector
│       ├── MilestoneInspector
│       ├── DependencyInspector
│       └── BranchInspector
├── DataReadinessDrawer
├── FlowView
├── DataView
└── DefinitionView
```

## Design acceptance criteria

- The user always understands they are creating a Cycle.
- Total duration, parallel work, gates, and critical path are visible at a glance.
- Moving a phase never silently changes dependency semantics.
- Dependencies and offsets can be edited without leaving Timeline.
- Approval and failure paths remain distinguishable without color.
- Required data issues link directly to Data view.
- Create, Stage, and Active cannot be confused.
- All direct manipulation has a keyboard-accessible numeric alternative.
- Timeline, Flow, Data, and Definition share one canonical state.
