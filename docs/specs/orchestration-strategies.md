# Orchestration Strategies Contract

**Part of:** [Oddjob Mission Execution Specification](./SPEC.md)  
**Status:** Draft — v1.0.0

---

## 1. Strategy Routing [NORMATIVE]

A compliant implementation MUST dispatch a mission run to exactly one orchestrator, determined by `mission.executionStrategy`.

| Strategy value | Orchestrator |
|---|---|
| `pre_planned` | Pipeline Executor — see [pipeline-execution.md](./pipeline-execution.md) |
| `dynamic_autonomous` | Dynamic Orchestrator — OODA loop, this document §2 |
| `rolling_wave` | Rolling Wave Orchestrator — this document §3 |
| `human_driven` | Reserved — informative only |

> **STRAT-001:** A compliant implementation MUST NOT start a cycle, wave, or step execution without first creating a `missionRuns` record (see [mission-execution.md §2](./mission-execution.md)).

**Implementation Note:** The current codebase also uses the string `"dynamic"` and `"dynamic_hybrid"` in some ML prediction paths. The canonical value is `dynamic_autonomous`. Alternative values SHOULD be treated as aliases for routing purposes but MUST NOT be persisted as the strategy value.

---

## 2. `dynamic_autonomous` — OODA Loop [NORMATIVE]

### 2.1 Cycle Structure

Each cycle of a `dynamic_autonomous` run executes five phases in order. A compliant implementation MUST execute them in this sequence and MUST NOT skip any phase:

```
┌──────────────────────────────────────────────────────┐
│                  PENTAGONAL OODA CYCLE               │
│                                                      │
│  1. OBSERVE   Read blackboard + missionContext       │
│       │                                              │
│  2. ORIENT    Call thinking service → OrchestrationThought │
│       │                                              │
│  3. DECIDE    Emit decision trace entry              │
│       │                                              │
│  4. ACT       Run governance check → dispatch handler│
│       │                                              │
│  5. SYNTHESIZE Call synthesis governor               │
└──────────────────────────────────────────────────────┘
         │
         ▼
    Queue next cycle (unless concluded/failed)
```

### 2.2 Phase Contracts

**Phase 1 — OBSERVE**

Read `mission.blackboard` and `missionRun.missionContext`. Increment `missionContext.cycleCount`. Check max cycles:

> **EXEC-001:** If `cycleCount > maxCycles`, MUST transition run to `failed`, emit `max_cycles_exceeded` trace, and stop.

**Phase 2 — ORIENT**

Call the thinking service (`orchestrationThinkingService.determineNextAction`) with the full `OrchestrationContext`. This returns an `OrchestrationThought`:

```typescript
{
  action: string;       // normalized action name
  reasoning: string;    // human-readable explanation
  params: Record<string, unknown>;
  rawResponse: string;  // raw AI output for audit
}
```

**Phase 3 — DECIDE**

Emit a `decision` trace entry:

```typescript
{
  type: "decision",
  cycle: number,
  traceCycleId: string,  // "${missionRunId}:${cycle}"
  action: string,
  thought: string,       // from OrchestrationThought.reasoning
  params: Record<string, unknown>,
  timestamp: string
}
```

> **TRACE-004:** A compliant implementation MUST emit this trace entry before any governance check or execution.

**Phase 4 — ACT**

Run the governance check (see [agent-governance.md](./agent-governance.md)). Then dispatch to the named action handler via `runActionWithRuntimeKernel`. Emit `execution` trace entry after completion.

If governance rejects the action: emit `action_rejected` system trace, queue next cycle with 1000ms delay, return (do not fail the run).

**Phase 5 — SYNTHESIZE**

Call `synthesisGovernorService.synthesize()` with execution trace and context. The synthesis MUST evaluate:
- Whether the objective is met (`completionStatus`)
- Confidence level (0–1)
- Recommendation (`continue` | `conclude` | `escalate`)

> **SYNTH-001:** If synthesis returns `recommendation: "conclude"` with `confidence >= 0.8`, a compliant implementation MUST treat this as equivalent to a `CONCLUDE` action.

### 2.3 Cycle Queueing

After phase 5, if the run is still `active`, a compliant implementation MUST queue the next cycle. The queue mechanism is implementation-defined; it MUST eventually dispatch `processMissionCycle` for the same `missionRunId`.

### 2.4 Execution Context Continuity

Between cycles, the `OrchestrationContext` MUST be reconstructed fresh from the database on each cycle dispatch. A compliant implementation MUST NOT cache `blackboard` or `missionContext` across cycle boundaries.

---

## 3. `rolling_wave` — Wave-Based Orchestration [NORMATIVE]

### 3.1 Phase State Machine

A rolling wave run progresses through a sequence of named phases within each wave:

```
         ┌─────────────────────────────────────────────────┐
         │                  WAVE N                         │
         │                                                  │
         │  PLANNING ──► DEBATING ──► AUDITING ──► EXECUTING │
         │      ▲                         │                 │
         │      │  (veto: re-plan)        │                 │
         │      └─────────────────────────┘                 │
         │                                  │               │
         │                         CRITIQUING               │
         │                              │                   │
         │                         REFLECTING               │
         │                              │                   │
         └──────────────────────────────┼───────────────────┘
                                        │
                                   WAVE N+1 (PLANNING)
```

**Additional states:**

| State | Semantics |
|---|---|
| `WAITING_FOR_ORDERS` | Run paused; awaiting human directive via mission chat |
| `EXECUTING_LEGACY` | Internal recovery path — reserved, not user-visible |

> **EXEC-002:** If `current_wave > max_waves` (default 10), MUST transition run to `failed` and stop.

### 3.2 Phase Contracts

**PLANNING**

Call strategic planner to produce a `blueprint`. On success, persist blueprint and transition to `DEBATING`. On failure, transition to `WAITING_FOR_ORDERS`.

**DEBATING**

Call debate service to refine the blueprint. On success, transition to `AUDITING`. On failure, fall back to the unrefined blueprint and transition to `AUDITING`.

**AUDITING**

Call auditor service. If `auditResult.passed`: transition to `EXECUTING`. If vetoed: write `last_criticism` to missionContext and transition back to `PLANNING` (re-plan with constitutional constraints).

> **WAVE-001:** A compliant implementation MUST respect the audit veto. It MUST NOT transition to `EXECUTING` if `auditResult.passed === false`.

**EXECUTING**

Call wave executor. Transition to `CRITIQUING` on both success and failure (failure is non-fatal at this phase).

**CRITIQUING**

Run vibe detector audit. Record score and critique in trace. Transition to `REFLECTING`.

**REFLECTING**

Run context pruning (if context exceeds size threshold). Increment `current_wave`. Transition to `PLANNING` for wave N+1.

### 3.3 Governance Gate

Before each phase execution, the implementation MUST call `MissionGovernanceService.validate()`. If validation fails (e.g., budget exceeded), MUST cancel the wave schedule and stop.

> **WAVE-002:** A compliant implementation MUST call the governance validation gate at the start of every wave cycle, before any phase logic executes.

### 3.4 Initial Context

On launch, the following MUST be written to `missionContext`:

```typescript
{
  phase: "PLANNING",
  current_wave: 1,
  max_waves: 10,          // configurable
  intent: mission.objective,
  executionStrategy: "rolling_wave"
}
```

---

## 4. `pre_planned` — Pipeline Mode [NORMATIVE]

See [pipeline-execution.md](./pipeline-execution.md) for the full contract.

In `pre_planned` mode, the run's `pipelineSequence` MUST be non-empty at launch. Steps execute in order. The orchestrator MUST update `currentPipelineId` and `currentStepIndex` on the run record as execution progresses.

---

## 5. Reserved Strategies [INFORMATIVE]

The following strategy values appear in the routing table but have no normative specification in this version:

- `human_driven` — execution is entirely driven by human-submitted steps
- `parallel_fan_out` — concurrent sub-mission dispatch
- `reactive` — event-triggered execution

These are reserved. A conformant implementation MAY return an error if routed to a reserved strategy.
