# Scrum Master Workbench Functional Specification

> X-Ray scope: `scrum-master-workbench`  
> Evidence: `tests/e2e/scrum-master-workbench-functional.spec.ts`

## Purpose

The Scrum Master Workbench combines sprint capacity, backlog coordination, blocker management, retrospective analysis, and AI-assisted planning in one operational interface.

## Functional requirements

| ID | Behavior ID | Requirement | Evidence |
| --- | --- | --- | --- |
| SCM-01 | `scrum-master-workbench.sprint.navigate-planning-surfaces` | Capacity, backlog, blocker, and retrospective views are visible as accessible tabs; the AI planner has an explicit toggle. | Verified |
| SCM-02 | `scrum-master-workbench.sprint.switch-operational-views` | Selecting each operational tab makes it the active view. | Verified |
| SCM-03 | `scrum-master-workbench.sprint.open-ai-planner` | The user can open the AI Sprint Planner from the workbench. | Verified |

## Primary flow

```text
Capacity planning -> Backlog commitment -> Blocker management
  -> Sprint monitoring -> Retrospective
       \-> AI Sprint Planner assistance
```

## Gaps

The suite does not yet save capacity, commit/decommit tickets, create or resolve blockers, verify dependency and burndown calculations, generate forecasts, or persist retrospective actions.
