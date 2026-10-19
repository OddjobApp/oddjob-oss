# Copilot Cycle Operations

**Status:** Core Cycle operations and builder dependency integration delivered. Last reconciled July 28, 2026.

How the in-app Oddjob Copilot works with operational cycles: approving staged
cycles conversationally, being told when major steps finish, and a per-turn
performance optimization that keeps the toolset small.

## Builder and runtime integration

Copilot is surfaced contextually while a Cycle is authored and operated:

- The Data view can ask Copilot to recommend an input for the selected phase.
- Form Agents, published Workbench apps, and pipeline outputs are first-class typed resources.
- Applying a recommendation creates an explicit resource, phase input, and data edge; Copilot prose is never executable configuration.
- Workbench app steps retain their published deployment and release identity, pause the runtime in `waiting_on_app`, and surface completion controls in Cycle Manager.
- App completion output is durable, resumes dependency gates, and survives worker restarts.
- Material Cycle events can be governed by a notification policy for Slack or AgentMail. Live delivery requires valid organization credentials.

Copilot remains advisory: it does not silently bind credentials, stage or activate a Cycle, or send an external update without applicable policy or approval.

## 1. Approving cycles from the copilot

The copilot can approve a staged (`pending_approval`) cycle and launch its mission
fleet — the same action as the **Approve & Launch** button on the cycle detail page
(`client/src/modules/operations/pages/CycleDetailPage.tsx`).

Two agent tools (in `server/domain/tools/v1/capabilities/cycles.ts`):

| Tool | Access | What it does |
|---|---|---|
| `list_pending_cycles` | any user (org-scoped) | Lists cycles awaiting approval so the copilot can resolve a name → id. Super-admins see all orgs; members see their own. |
| `approve_cycle` | org-admin / super-admin | Flips the cycle to `active`, sets start/end dates from `durationDays`, and spawns the blueprint fleet with dependency ordering (`CycleManagerService.spawnBlueprintsWithDeps`). |

`approve_cycle` refuses if the caller isn't an admin, if the cycle isn't in the
caller's org, or if it isn't actually `pending_approval`. It mirrors the HTTP route
`POST /api/cycles/:id/approve`, so copilot-approval and button-approval behave
identically.

**Usage:** *"Which cycles are awaiting approval?"* → *"Approve the Service Dispatch
Pipeline cycle."*

Tools are registered in `server/domain/tools/v1/capabilities/index.ts` and allow-listed
in `promptService.getTools()` (`approve_cycle` in the admin-only block).

## 2. Major cycle-step announcements

When a mission that belongs to a cycle completes, the copilot announces it in the
**Assistant Updates** feed — but only for **major** steps, to avoid noise.

- Implemented in `MissionLifecycleHooks.runCycleStepAnnouncement`
  (`server/domain/mission/core/mission-lifecycle-hooks.ts`), called from
  `onMissionTerminalState` when the mission has a `cycleId` and completes.
- `CycleManagerService` names each blueprint's mission after the blueprint, so
  `mission.name` is the step (phase) name.
- **"Major" = on the cycle's critical path**, read from
  `operationalCycles.executionPlan` (`criticalPath: string[]` + per-node
  `onCriticalPath`), the authoritative CPM output. If a cycle has no computed plan,
  it falls back to announcing every step so the feature never goes silent.
- Delivery is an `intervention.triggered` event (org-scoped), the same path
  research-mission completions use. It surfaces via `use-intervention-engine.ts` over
  the SSE stream `/api/events/stream`. A deterministic `interventionId`
  (`cycle-step-complete-<cycleId>-<runId>`) dedupes double fires.

Example update: **"Step complete: Provider Assignment — Service Dispatch Pipeline
finished a major step."**

> The critical-path data this relies on is written by
> `CycleManagerService.prepareExecutionPlan`. A prior bug rendered the denormalizing
> UPDATE with a table-qualified SET column (`"cycle_blueprints"."wave_index"`), which
> Postgres rejects, so it silently failed and cycles launched without wave ordering /
> critical-path flags. Fixed with a typed per-row update; the `catch` now emits
> `cycle.plan_generation_failed` instead of swallowing.

## 3. Tool subsetting (copilot performance)

The copilot hands the model ~70 tool schemas every turn, which inflates prompt size,
first-token latency, and cost. `subsetToolsForQuery`
(`server/domain/agents/core/tool-subsetting.service.ts`) trims the model-facing
toolset for a single turn to:

```
CORE (always-on)  ∪  top-K tools most relevant to the user's message
```

- **CORE** always includes `discover_capabilities`, so a tool dropped by the filter
  is still JIT-recoverable — the subset is a hint, never a hard capability wall.
- The relevance scorer is **lexical** (name > group > description, with light
  stemming) so it adds no embedding round-trip. `scoreTool` is the single swap-point
  for an embedding backend later.
- **Conservative:** returns the full set unchanged when the candidate list is already
  small, the query has no meaningful terms, or nothing matches — it never strips tools
  on a vague prompt.
- Applied in `agent.service.ts` for the copilot (no job-bound agent) only, **after**
  MCP-permission derivation, and env-gated via `COPILOT_TOOL_SUBSETTING` (set to
  `false` to disable for A/B).

Observed: ~70 → 12–21 tools per turn across cycle / pipeline / knowledge / dataset
queries, with the right tools selected.

## Tests

- `server/domain/agents/core/tool-subsetting.service.test.ts` — pure unit tests
  (scoring, CORE retention, conservative no-op cases).
- `server/domain/mission/core/mission-lifecycle-cycle-step.test.ts` — announcement
  fires for a major step, stays silent for a non-major step (integration; needs a
  test DB).
- `CycleManagerService.prepareExecutionPlan` denorm-persistence regression in
  `server/domain/mission/core/cycle-manager.test.ts` (integration; needs a test DB).
- `tests/e2e/cycle-blueprint-builder.spec.ts` verifies the authenticated builder route,
  synchronized Timeline/Flow/Data views, phase creation, save behavior, and accessible
  authoring controls.
- `tests/e2e/cycle-blueprint-builder-api.spec.ts` verifies draft CRUD, optimistic
  conflicts, readiness policy, governed app rejection, idempotent Cycle creation,
  and durable app-action completion through the real authenticated API.

## Related

- [Cycle Blueprint Builder](./cycle-blueprint-builder.md)
- [Copilot for Cycles and Missions proposal](../proposals/COPILOT_CYCLE_OPERATIONS_PROPOSAL.md)
- [Agentic Maturity](./agentic-maturity.md)
- Design: honest provider labeling / degraded-mode — `docs/design/ai-degraded-mode-visibility.md`
