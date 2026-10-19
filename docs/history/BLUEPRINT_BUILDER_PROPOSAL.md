# Oddjob Cycle Blueprint Builder — Product Proposal

**Status:** Agreed feature scope delivered and release-tested
**Last updated:** July 28, 2026
**Primary surface:** Operations → Create Cycle

The implemented release provides canonical draft persistence, synchronized Timeline/Flow/Data authoring, governed Form Agent/pipeline/Workbench app dependencies, App Forge publishing return, exact-revision readiness, transactional Cycle creation, runtime app-step orchestration, and restart-safe recovery. Simulation, collaboration, nested reuse, and full AI structural generation remain follow-on opportunities.

## Executive summary

Oddjob should introduce a visual Blueprint Builder whose output is a complete, runnable **Cycle**.

The builder turns an operational objective into a coordinated sequence of missions, predictions, approval milestones, dependencies, data flows, resources, schedules, and failure paths. A user can begin with a plain-language description, a cycle template, an existing cycle, or a blank canvas; design the cycle visually; validate it continuously; simulate its behavior; and create it without hand-authoring YAML or JSON.

The product principle is:

> Describe the operation, design the flow, prove it can run, then create the Cycle.

Reusable templates are a helpful secondary outcome. They should not become a separate blueprint lifecycle in the MVP.

## Product definition

In this proposal:

- A **Cycle** is the top-level operational object the user is creating.
- A **cycle blueprint** is the Cycle's editable design before creation.
- A **phase** is one node within the Cycle: a mission, prediction, or milestone.
- A **template** is a saved starting configuration for creating another Cycle.

This terminology avoids confusing Cycle blueprints with App Forge application blueprints.

## Why this matters

Oddjob already contains most of the underlying capabilities:

- A `BlueprintBuilder` embedded in cycle staging and editing.
- Mission, milestone, and prediction phase types.
- Advanced dependency relationships and offsets.
- Success and failure branches.
- Required resources, inputs, outputs, and data-flow mappings.
- Timeline, compact, comparison, history, and Gantt views.
- Server-side cycle blueprint validation.
- Cycle templates and a full Cycle creation flow.
- Mission synthesis, scoring, simulation, and shadow-validation services.

The current builder is primarily a stack of expandable configuration cards. It makes individual fields editable, but does not yet give the user a clear spatial understanding of the Cycle they are creating.

The opportunity is to turn the existing configuration surface into a purpose-built Cycle design workflow.

## Problem statement

To create a Cycle today, a user must translate an operational goal into several technical concepts at once:

- What phases should happen?
- Which work can run in parallel?
- What must happen first?
- Which agent or capability performs each mission?
- What information, datasets, or credentials are required?
- What does each phase produce?
- Where should a person approve or intervene?
- What happens when a phase fails?
- How long will the Cycle take?
- Is the Cycle actually executable?

The current form-led experience creates four gaps:

1. **The Cycle is hard to see as a system.** Dependencies and branches are configured in cards but understood as a graph or timeline.
2. **Validation arrives too late.** Structural problems are easier to prevent while the user is connecting phases.
3. **New users must learn the schema first.** The interface begins with configuration rather than operational intent.
4. **Creation and preview are separated.** Users need to move between authoring fields and visualization to understand the result.

## Product goals

The Cycle Blueprint Builder should:

- Let a first-time user create a useful Cycle without knowing Oddjob's schema.
- Let an expert precisely control dependencies, data contracts, timing, agents, and policies.
- Make parallel work, approval gates, data flow, and failure handling visible.
- Prevent invalid Cycles before creation.
- Estimate schedule, cost, and readiness before the first run.
- Produce a Cycle that works with Oddjob's existing execution and monitoring surfaces.
- Allow a well-designed Cycle to be saved as a reusable template.

## Non-goals for the MVP

- A general-purpose BPMN editor.
- A builder for App Forge applications.
- A separate marketplace or publishing system for blueprints.
- Real-time multiplayer editing.
- Arbitrary code execution on the canvas.
- Automatic activation or scheduling without user confirmation.
- Full support for every advanced Cycle YAML property on day one.

## Target users

### Operations lead

Wants to translate a repeatable business process into a Cycle with clear ownership, approval points, timing, and failure handling.

### Automation designer

Wants precise control over phases, agents, dependencies, data mappings, integrations, schedules, and runtime policy.

### Technical operator

Wants to inspect the generated definition, test edge cases, resolve validation issues, and understand whether the Cycle is ready to run.

## Entry points

The primary entry point is **Create Cycle** from the Cycles dashboard.

Additional entry points:

- Duplicate an existing Cycle.
- Edit a draft Cycle.
- Create from a Cycle template.
- Convert an active Cycle into a new draft revision.
- Ask Oddjob to create a Cycle from a plain-language objective.

## End-to-end flow

### 1. Choose how to start

The creation screen offers four clear paths:

- **Describe with AI** — explain the operation and constraints in plain language.
- **Use a template** — start from a proven Cycle pattern.
- **Duplicate a Cycle** — use an existing Cycle as the starting point.
- **Start blank** — open an empty canvas.

AI generation creates a reviewable draft. It never creates or activates the Cycle automatically.

### 2. Define the Cycle

A short brief establishes:

- Cycle name.
- Operational objective.
- Trigger or recurrence.
- Expected outcome.
- Required systems or integrations.
- Human approval expectations.
- Budget and time constraints.

The brief keeps the workflow outcome-first. Detailed phase configuration belongs in the builder.

### 3. Build the flow

The main workspace uses a three-panel layout:

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Create Cycle  Cycle name  Draft saved  Undo/redo  Validate  Test  Create     │
├───────────────┬────────────────────────────────────────────┬─────────────────┤
│ Phase library │                                            │ Inspector       │
│               │               Cycle canvas                 │                 │
│ Mission       │                                            │ Selected phase  │
│ Milestone     │  Intake ──▶ Research ──▶ Approval ──▶ Act  │ Objective       │
│ Prediction    │               │                    ╲        │ Agent           │
│ Saved pattern │               └── failure ──▶ Escalate     │ Inputs/outputs  │
│               │                                            │ Runtime policy  │
├───────────────┴────────────────────────────────────────────┴─────────────────┤
│ Problems · Data flow · Timeline · Definition                                 │
└──────────────────────────────────────────────────────────────────────────────┘
```

The workspace presents the same Cycle through complementary views:

- **Canvas:** control flow and relationships.
- **Inspector:** precise configuration of the selected phase or connection.
- **Data flow:** inputs, outputs, resources, and mappings.
- **Timeline:** schedule, parallelism, milestones, and critical path.
- **Definition:** generated YAML or JSON for expert inspection.

### 4. Validate continuously

Validation runs as the user builds. Fast structural checks happen immediately; the server remains authoritative.

Issues are grouped by severity:

- **Errors:** block Cycle creation.
- **Warnings:** allow creation after acknowledgement.
- **Suggestions:** optional design improvements.

Examples:

- Circular dependency.
- Duplicate or missing phase name.
- Branch target does not exist.
- Required resource has no label or configured source.
- A phase input is not provided by a resource or upstream output.
- Output-to-input mapping is incompatible.
- A required integration is not available to the organization.
- A critical mission has no failure behavior.
- A pausing milestone has no approver policy.
- A scheduled phase can never start because of its constraints.

Selecting an issue focuses the node and opens the exact field that needs attention.

### 5. Test the proposed Cycle

The **Test** action opens a simulation drawer:

- Supply sample Cycle inputs.
- Run the happy path.
- Inject a failure at a selected phase.
- Preview dependency timing and parallel execution.
- Show which branches activate.
- Estimate runtime, token usage, and cost when available.
- Run quick scoring or shadow validation through existing GMS services.

The result should be an execution story rather than only a technical log:

```text
Request received
→ Triage completed
→ Risk score exceeded threshold
→ Human approval requested
→ Approval denied
→ Escalation mission selected
→ Cycle completed with intervention
```

Testing is recommended but should not block creating an inactive draft Cycle in the MVP.

### 6. Review and create

The final review summarizes:

- Objective and recurrence.
- Phase count by type.
- Parallel paths and critical path.
- Human approval gates.
- Required inputs, credentials, and integrations.
- Estimated duration and cost.
- Validation and test status.

The final action is **Create Cycle**.

The user then chooses:

- **Create as draft** — save without scheduling.
- **Create and stage** — open the existing staging experience.
- **Create and activate** — only when validation passes and scheduling details are complete.

Activation is always explicit.

## Canvas behavior

- Drag a phase from the library to add it.
- Connect phases to create a finish-to-start dependency by default.
- Draw from success or failure handles to create a conditional branch.
- Drag a simple linear sequence to reorder it.
- Multi-select, duplicate, group, or delete phases.
- Auto-layout left-to-right or top-to-bottom.
- Zoom to fit and use a minimap for larger Cycles.
- Undo and redo every structural or field edit.

Each node shows only the information needed to understand the plan:

- Name and phase type.
- Assigned agent or capability.
- Estimated duration.
- Validation state.
- Input and output counts.
- Approval badge when applicable.

Advanced configuration stays in the inspector.

## Phase types

### Mission

Executable work assigned to an agent or Oddjob capability.

Key properties:

- Objective.
- Primary agent or capability.
- Tools and permissions.
- Inputs and outputs.
- Duration, timeout, and retry policy.
- Budget and failure behavior.

### Milestone

A zero-duration checkpoint that may pause the Cycle for a human decision.

Key properties:

- Decision required.
- Approver policy.
- Form or evidence required.
- Timeout and escalation.
- Approved and rejected branches.

### Prediction

An analysis phase that produces a forecast, score, or recommendation.

Key properties:

- Dataset or feature inputs.
- Prediction target.
- Confidence threshold.
- Output contract.
- Low-confidence handling.

## Cycle-level configuration

When no node is selected, the inspector shows Cycle settings:

- Name, description, objective, and owner.
- Recurrence, timezone, and start conditions.
- Priority and budget limit.
- Default timeout and retry policy.
- Required integrations.
- Global resources and Cycle inputs.
- Approval policy for activation.
- Tags and template eligibility.

This preserves the distinction between Cycle behavior and phase behavior.

## Data flow model

The builder should visually distinguish three relationship types:

- **Dependency:** when a phase may start.
- **Branch:** which path is selected after an outcome.
- **Data flow:** what value moves between phases.

These relationships should not share the same line treatment.

Recommended visual language:

- Solid neutral line for dependency.
- Green and red labeled lines for success and failure branches.
- Dashed blue line for data flow.

The Data Flow tab should list every phase input and show its source:

```text
Qualification Scorer
├── company_profile  ← Contact Enricher.profile
├── scoring_model    ← Cycle resource: scoring-model
└── threshold        ← Cycle input: qualification-threshold
```

Unmapped required inputs appear as validation errors.

## Definition view

The Definition tab gives experts access to the generated Cycle YAML or JSON.

- Visual edits update the definition.
- Valid definition edits update the canvas.
- Invalid text remains recoverable and does not replace the last valid visual state.
- A structural diff appears before applying a large text edit.
- The exported definition conforms to the canonical Cycle schema.

The visual builder and text editor must use one normalized in-memory model to prevent drift.

## AI-assisted Cycle creation

Recommended AI actions:

- Generate a Cycle from an objective.
- Break a broad mission into phases.
- Suggest parallel work.
- Add a missing failure path.
- Add an approval gate.
- Suggest required resources and integrations.
- Map outputs to downstream inputs.
- Explain a dependency.
- Simplify an overly complex Cycle.
- Generate test scenarios.
- Summarize the Cycle before creation.

Every AI change appears as a structural diff with **Apply** and **Dismiss**. AI must not activate a Cycle, bind credentials, or silently replace user work.

## Save and recovery

- Autosave the creation draft.
- Show the last saved timestamp.
- Restore an abandoned draft from the Cycles dashboard.
- Keep undo/redo history for the current session.
- Warn before leaving with unapplied Definition edits.
- Allow export at any point.

A Cycle blueprint draft is temporary authoring state. After creation, the Cycle becomes the system of record.

## Template behavior

After creating a Cycle, the user may choose **Save as template**.

A template should:

- Copy Cycle structure and safe defaults.
- Exclude credentials, secrets, run history, and environment-specific identifiers.
- Mark organization-specific integrations as requirements.
- Allow selected fields to become creation-time parameters.
- Remain secondary to the core create-Cycle workflow.

The MVP does not require template versioning beyond the existing template management capability.

## Data model recommendation

Avoid introducing a new top-level blueprint entity for the MVP.

### `cycle_builder_drafts`

- `id`
- `organization_id`
- `user_id`
- `source_type` — blank, prompt, template, duplicate, or edit
- `source_id`
- `name`
- `definition`
- `schema_version`
- `validation_summary`
- `last_saved_at`
- `created_at`
- `expires_at`

### Cycle creation

When the user selects **Create Cycle**, normalize the draft into the existing Cycle model:

- Cycle identity and settings go to the operational Cycle record.
- Phases go to the existing blueprint metadata or canonical phase storage.
- Dependencies, branches, data flows, and resources remain part of the Cycle definition.
- Draft provenance may be retained for audit purposes.

Longer term, Oddjob may normalize phases and connections into first-class tables, but the initial builder should not depend on that migration.

## API proposal

```text
POST   /api/cycle-builder/drafts
GET    /api/cycle-builder/drafts/:draftId
PATCH  /api/cycle-builder/drafts/:draftId
DELETE /api/cycle-builder/drafts/:draftId

POST   /api/cycle-builder/drafts/:draftId/generate
POST   /api/cycle-builder/drafts/:draftId/validate
POST   /api/cycle-builder/drafts/:draftId/simulate
POST   /api/cycle-builder/drafts/:draftId/create-cycle

POST   /api/cycles/:cycleId/duplicate-to-draft
POST   /api/cycles/:cycleId/save-as-template
```

The existing `/api/cycles/:cycleId/blueprints/validate` endpoint can be reused or moved behind the builder validation route.

## Permissions and governance

Suggested permissions:

- `cycles:view`
- `cycles:create`
- `cycles:edit`
- `cycles:test`
- `cycles:activate`
- `cycle_templates:create`

The creation audit record should include:

- Draft source.
- User who created the Cycle.
- AI-generated changes that were applied.
- Validation result.
- Simulation result when present.
- Activation choice.

## Accessibility requirements

- All canvas actions have keyboard alternatives.
- The full Cycle is available as an ordered, navigable outline.
- Connections use labels and line styles, not color alone.
- Drag-and-drop actions also exist in menus.
- Focus moves to a newly created phase and returns predictably after dialogs.
- Validation messages are announced and linked to fields.
- Essential node information remains readable without zooming.

## MVP scope

### Included

- New Create Cycle entry flow.
- Start blank, from template, or by duplicating a Cycle.
- Canvas for missions, milestones, and predictions.
- Inspector for Cycle and phase settings.
- Dependencies, offsets, success/failure branches, and data flow.
- Problems, Timeline, Data Flow, and Definition tabs.
- Continuous validation.
- Draft autosave and recovery.
- Review summary.
- Create as draft or create and stage.
- Compatible JSON/YAML import and export.

### Deferred

- AI generation and conversational editing.
- Shadow execution and failure injection.
- Create and activate from the builder.
- Reusable nested Cycle patterns.
- Real-time collaboration.
- Public template marketplace.
- Automated optimization from run history.
- App Forge blueprint authoring.

## Delivery plan

### Phase 0 — Schema and flow alignment (1–2 weeks)

- Confirm the canonical Cycle definition.
- Resolve UI terminology between Cycle phases and App Forge blueprints.
- Map current staging fields into the builder model.
- Define draft storage and create-Cycle normalization.

### Phase 1 — Builder MVP (4–6 weeks)

- Turn Create Cycle into a resumable builder flow.
- Extract and reuse the current `BlueprintBuilder` field logic.
- Add visual canvas, inspector, and auto-layout.
- Reuse dependency, branch, resource, and validation logic.
- Add Problems, Timeline, Data Flow, and Definition tabs.
- Support create as draft and create and stage.

### Phase 2 — Testing and intelligence (3–5 weeks)

- Add simulation scenarios and execution-story output.
- Connect GMS scoring and shadow validation.
- Add AI generation and reviewable structural diffs.
- Surface readiness, cost, and duration estimates.
- Allow create and activate after explicit review.

### Phase 3 — Reuse and optimization (4–6 weeks)

- Add reusable phase groups and richer templates.
- Add template quality signals and organization sharing.
- Suggest improvements from Cycle run history.
- Explore guided migration of existing Cycle definitions.

## Success metrics

### Activation

- Percentage of creation drafts that become Cycles.
- Median time from start to valid Cycle.
- Percentage created without editing raw YAML or JSON.
- Draft recovery rate.

### Quality

- Validation errors prevented before creation.
- First-run success rate.
- Percentage of critical missions with explicit failure behavior.
- Percentage of pausing milestones with complete approver policies.

### Efficiency

- Time to create a five-phase Cycle.
- Number of corrections between staging and first activation.
- Reduction in abandoned Create Cycle sessions.
- Reduction in duplicated manual configuration.

### Confidence

- Percentage of Cycles previewed in Timeline before creation.
- Percentage tested before activation.
- User-reported confidence that the Cycle will behave as designed.

## Key risks and mitigations

| Risk | Mitigation |
|---|---|
| “Blueprint” is overloaded across Oddjob | Name the feature Cycle Blueprint Builder and call internal nodes phases. |
| A canvas is harder than the current form for simple Cycles | Provide an ordered outline, auto-layout, and a simple linear-flow mode. |
| Visual and raw definitions drift | Use one normalized model and round-trip schema tests. |
| AI generates plausible but unsafe Cycles | Keep AI output as a reviewable draft and require validation before creation. |
| Existing Cycle creation regresses | Reuse current field components and preserve the staging route during rollout. |
| Large Cycles become unreadable | Add grouping, minimap, filtering, and focus mode. |
| Users confuse Create with Activate | Keep them as separate explicit actions with a review step. |

## Recommended first release

Ship the narrowest complete job:

> “Turn an operational idea, template, or existing Cycle into a valid visual design, then create a draft Cycle ready for staging.”

The strongest implementation path is to evolve the current `BlueprintBuilder` rather than replace its working field logic. Move it into a dedicated Create Cycle shell, add a graph and inspector around it, reuse server validation, and make the final output an ordinary Oddjob Cycle.

## Open decisions

1. Should editing an existing Cycle use the same builder immediately, or remain a second-phase migration?
2. Is agent assignment required before Cycle creation, or can it remain unresolved until staging?
3. Should testing be required for activation of high-risk Cycles?
4. Which Cycle properties are editable on the canvas versus only in the inspector?
5. Should Create Cycle default to a graph or a guided linear outline for first-time users?
6. How long should abandoned builder drafts be retained?
