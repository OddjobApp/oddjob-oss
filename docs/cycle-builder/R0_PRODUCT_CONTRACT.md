# Cycle Blueprint Builder — R0 Product Contract

**Status:** Contract implemented. Last reconciled July 28, 2026.

The implementation extends this baseline with governed Workbench app-step bindings, App Forge publishing return, persisted readiness, runtime completion actions, and restart-safe orchestration without changing the R0 vocabulary.

**Status:** Accepted for implementation  
**Date:** July 26, 2026  
**Roadmap tasks:** CBB-001, CBB-002

## Vocabulary

| Term | Canonical meaning |
|---|---|
| Cycle | The persisted Oddjob operational object that can be staged and activated. |
| Cycle blueprint | The editable design of a Cycle before or during creation. It is not a separate marketplace object. |
| Builder draft | Autosaved authoring state that has not yet become a Cycle. |
| Phase | A node inside a Cycle blueprint. Its type is mission, prediction, or milestone. |
| Mission | Executable work assigned to an agent or Oddjob capability. |
| Prediction | An analysis phase that produces a forecast, score, or recommendation. |
| Milestone | A zero-duration decision or checkpoint that may pause execution. |
| Dependency | A scheduling relationship that controls when phases may start or finish. |
| Outcome branch | A control-flow route chosen from an explicit phase outcome. |
| Data flow | A mapping from a Cycle input, resource, or phase output to a phase input. |
| Stage group | A visual organization of phase rows in the builder. It does not alter execution. |
| Template | A sanitized starting configuration used to create a new builder draft. |
| Stage | The process of resolving agents, inputs, integrations, credentials, approvals, and schedule before activation. |
| Active | A Cycle that may run according to its trigger or schedule. |

## Naming boundaries

- Main navigation uses **Cycles**.
- The authoring page descriptor is **Cycle Blueprint Builder**.
- Canvas nodes are **phases**, not blueprints.
- App Forge application blueprints are outside this feature and schema.
- “Publish” is reserved for reusable templates or marketplace behavior.
- The Cycle lifecycle uses **Create**, **Stage**, and **Activate**.

## Persisted lifecycle

```text
Builder Draft → Cycle Draft → Staged → Active
```

Validation and test readiness are properties of a revision, not separate persisted Cycle states:

```text
Builder Draft
├── validation: unchecked | invalid | valid
└── test: not_run | failed | passed
```

### Pre-Flight Readiness & Multi-Studio Probing

Setting `test: "passed"` requires executing `POST /api/cycle-builder/drafts/:id/readiness` which performs:
1. **Topological Simulation**: Zero circular dependencies and valid critical path.
2. **Contract Auditing**: Zero port-to-port schema type mismatches and all required inputs fulfilled.
3. **Multi-Studio Availability Probes**: Active Workbench App deployments, active Form Agents (`jobs.type = 'form_agent'`), active Data Pipelines, and valid prediction target objectives.
4. **Readiness Score**: Achieving a deterministic score >= 90/100 and status `VERIFIED`.

See [SIMULATION_AND_VERIFICATION.md](./SIMULATION_AND_VERIFICATION.md) for full technical details.

## Transition contract

### Builder Draft → Cycle Draft

Required:

- Name and objective.
- At least one phase.
- No blocking structural errors.
- Test readiness must be `passed` (pre-flight simulation and multi-studio verification).
- On create or revision publish, an immutable `studioManifest` is compiled and persisted in `operationalCycles.metadata.studioManifest`.
- Explicit Create as Draft action.

Not required:

- All agents resolved.
- Credentials supplied.
- A test run.
- An activation schedule.

### Builder Draft → Staged

Implemented as one atomic Cycle creation followed by the existing staging flow.

Required:

- All Cycle Draft requirements.
- Explicit Create and Stage action.

Staging may still require:

- Agent assignments.
- Integration authorization.
- Credential entry.
- Runtime input values.
- Schedule confirmation.
- Approval policy completion.

### Staged → Active

Required:

- Staging readiness passes.
- Activation permission.
- Explicit activation confirmation.

The builder MVP does not activate a Cycle directly.

### Active → Edit

Editing an active Cycle creates a new builder draft sourced from the active definition. It never mutates the running definition in place.

## Relationship semantics

The canonical model keeps three edge collections separate:

1. Dependency edges determine schedule constraints.
2. Outcome edges determine conditional control flow.
3. Data edges map values.

Moving a phase on the timeline changes only its manual start constraint. It must not silently create, delete, or rewrite dependency edges.

Moving a phase between stage groups changes only authoring organization.

## Source of truth

- The canonical builder schema is the source of truth during authoring.
- Timeline position is derived from dependencies, offsets, durations, and manual constraints.
- React Flow positions are authoring layout metadata only.
- The existing Cycle model becomes the source of truth after creation.
- Adapters own conversion between the canonical draft and legacy Cycle blueprint arrays.
