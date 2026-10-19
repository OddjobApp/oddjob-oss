# ADR-021: Cycle Builder Canvas and Layout Architecture

**Status:** Accepted and implemented
**Date:** July 26, 2026  
**Roadmap task:** CBB-003

**Implementation verification:** July 28, 2026. The release uses one normalized canonical draft across Timeline, Flow, and Data; the timeline layer remains authoritative for temporal presentation.

## Context

The selected Cycle Builder design is an editable operational timeline with secondary Flow and Data views. Oddjob already depends on React Flow, Dagre, D3, and scheduling/Gantt utilities.

The canvas must support:

- Custom phase nodes and typed handles.
- Dependency and outcome edges.
- Pan, zoom, selection, minimap, and keyboard support.
- Auto-layout for Flow view.
- A time-scaled editable Timeline view.
- Large graphs without making visual coordinates execution truth.

## Decision

Use three coordinated layers:

### Flow view

Use `reactflow` for node and edge interaction.

Use `dagre` for explicit, user-invoked topology layout.

Reasons:

- Both are already installed.
- Oddjob already has multiple working implementations.
- Custom nodes, handles, selection, controls, and minimap are proven locally.
- Reuse reduces package and design-system risk.

### Timeline view

Use a purpose-built React time grid backed by existing Cycle scheduling and critical-path calculations.

Use SVG or React Flow edge overlays for dependency and outcome connectors only where they improve interaction. Timeline bars, milestones, resizing, snapping, and row virtualization remain owned by the timeline layer.

Reasons:

- Dagre has no scheduling semantics.
- React Flow positions are pixel coordinates, not time values.
- The canonical definition needs deterministic start and duration fields.
- Timeline virtualization and snapping differ from freeform graph interaction.

### Data view

Use React Flow with data-specific ports and edges, sharing canonical phase IDs with the other views.

## State boundary

The canonical builder store owns:

- Phase definitions.
- Dependency, outcome, and data edges.
- Stage groups.
- Durations and manual start constraints.
- Cycle settings and resources.

View state owns:

- React Flow x/y positions.
- Zoom and viewport.
- Collapsed groups.
- Selected view and object.

View state must never alter execution semantics without dispatching an explicit canonical command.

## Consequences

Positive:

- Reuses the existing Oddjob graph stack.
- Keeps schedule calculations deterministic.
- Allows Flow, Data, and Timeline to evolve independently.
- Makes round-trip tests possible.

Trade-offs:

- Some edge rendering logic will exist in both Flow and Timeline.
- Cross-view selection and focus need a shared controller.
- Timeline virtualization requires dedicated engineering.

## Rejected alternatives

### React Flow for the entire timeline

Rejected because time snapping, row virtualization, duration resizing, and calendar scaling would be implemented against arbitrary pixel positions.

### Cytoscape for all views

Rejected because Oddjob has less reusable product UI with Cytoscape and it does not remove the need for a dedicated timeline.

### D3-only canvas

Rejected because it would require rebuilding interaction, accessibility, selection, and node editing primitives already available in React Flow.

### BPMN editor

Rejected because the product model is not BPMN and the additional vocabulary would increase authoring complexity.
