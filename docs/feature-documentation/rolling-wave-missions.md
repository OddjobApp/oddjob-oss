# Rolling Wave Mission Orchestration

## Overview

Rolling wave missions are autonomous, iterative execution loops where an AI strategist plans a "wave" of tool calls, executes them, critiques the results, and then plans the next wave — continuing until the objective is met or the mission is paused for human review.

Each wave is an isolated BullMQ job so hung waves cannot block other missions, and the state survives server restarts.

## Phase State Machine

```
         ┌─────────────────────────────────────────────────────────┐
         │                                                         │
    ┌────▼────┐     ┌──────────┐     ┌───────────┐     ┌──────────▼──────┐
    │PLANNING │────►│EXECUTING │────►│CRITIQUING │────►│  REFLECTING     │
    └─────────┘     └──────────┘     └─────┬─────┘     └────────┬────────┘
         ▲                                 │                     │
         │                    isForge=true │                     │
         │                                 ▼                     │
         │                    ┌────────────────────┐             │
         │                    │ WAITING_FOR_ORDERS │             │
         │                    └────────────────────┘             │
         │                                                        │
         └────────────────────────────────────────────────────────┘
```

### Phase descriptions

| Phase | DB status | Description |
|-------|-----------|-------------|
| `PLANNING` | `active` | AI strategist plans the next wave blueprint |
| `EXECUTING` | `active` | Tool calls from the blueprint are executed sequentially |
| `CRITIQUING` | `active` | Vibe detector audits output quality and alignment score |
| `WAITING_FOR_ORDERS` | `paused` | Paused for human command (Forge missions always pause here) |
| `REFLECTING` | `active` | Brief synthesis before planning the next wave |

## Crew Recruitment

On mission launch, three crew members are assembled — one per role — each backed by an AI config fetched from `systemAiService`:

| Role | Config Key | Responsibility |
|------|------------|----------------|
| Strategist Lead | `copilot` | Plans the wave objective and tool workflow |
| Technical Developer | `copilot` | Executes tool calls and writes code |
| Vibe Critic | `copilot` | Audits output for quality and aesthetic alignment |

If a role-specific config is unavailable, the role falls back gracefully with `model: 'default'`.

The assembled crew is stored in `missionRuns.missionContext.crew` and broadcast as a `mission.crew_assembled` SSE event.

## Idle Detection

When a mission is in `WAITING_FOR_ORDERS` for 3 consecutive wave cycles, it is considered idle:
- The polling interval is increased from **5s → 30s** to avoid busy-polling a paused mission
- A `mission.idle` SSE event is emitted for the UI to show an idle indicator
- The idle counter resets automatically when the phase changes to an active state

## SSE Events

All phase transitions and trace entries are published to the global event stream so the browser receives live updates without polling.

| Event | Payload |
|-------|---------|
| `mission.crew_assembled` | `{ missionRunId, crew: CrewMember[] }` |
| `mission.phase_changed` | `{ missionRunId, phase }` |
| `mission.trace` | `{ missionRunId, traceEntry }` |
| `mission.idle` | `{ missionRunId }` |

## API Reference

### `POST /api/missions/:id/launch`

Starts a rolling wave mission. Returns `{ success, missionRunId }`.

Sets up the crew, schedules the first BullMQ wave job, and emits `mission.crew_assembled`.

### `POST /api/missions/:id/pause` / `/resume`

Pauses or resumes the mission by setting `missionRuns.status`.

### `GET /api/mission-runs/:id`

Returns the full mission run including `missionContext` (contains `phase`, `current_wave`, `crew`).

## MissionWaveProgress Component

```tsx
import { MissionWaveProgress } from "../components/MissionWaveProgress";

<MissionWaveProgress
    missionRunId={runId}
    organizationId={run?.organizationId}
/>
```

Renders:
- **Phase step track** — visual progress bar through PLANNING → EXECUTING → CRITIQUING → REFLECTING, with animated icons for the active phase
- **Crew panel** — badges for each crew member showing role and model
- **Live trace feed** — real-time log of every trace entry streamed via SSE; auto-scrolls to bottom; seeded with the last 50 entries from `dynamicTrace` on first render

The component subscribes to `mission.*` SSE events filtered by `organizationId` and updates immediately when `mission.phase_changed`, `mission.trace`, or `mission.crew_assembled` events arrive for the current `missionRunId`.

## Configuration

| Value | Location | Default |
|-------|----------|---------|
| Wave cycle interval | `rolling-wave-queue.ts: WAVE_INTERVAL_MS` | 5000ms |
| Idle threshold (cycles) | `rolling-wave-queue.ts: IDLE_THRESHOLD` | 3 |
| Idle interval | `rolling-wave-queue.ts: IDLE_INTERVAL_MS` | 30000ms |
| Max concurrent missions | Worker `concurrency` option | 10 |

## Error Handling

- **AI planning failure**: phase set to `WAITING_FOR_ORDERS`, error logged, trace entry added
- **Tool execution error**: wave stops at the failed step, error added to trace, phase moves to `CRITIQUING`
- **Wave cycle exception**: `activeLoops.delete(missionRunId)` — mission stops cycling, requires manual resume
- **Crew recruitment failure**: graceful fallback per role, `model: 'default'`, mission still launches
