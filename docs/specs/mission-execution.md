# Mission Execution Contract

**Part of:** [Oddjob Mission Execution Specification](./SPEC.md)  
**Status:** Draft — v1.0.0

---

## 1. Mission Run State Machine [NORMATIVE]

A Mission Run MUST be in exactly one of the following states at any point in time:

```
                  ┌─────────────────────────────────────────┐
                  │                                         │
     launch()     ▼         pause signal                   │
  ──────────► active ──────────────────────► paused ───────┘
                  │                                  resume()
                  │  HIL gate or file wait
                  ▼
         waiting_on_human ◄──── resume condition: human_approval
         waiting_on_file  ◄──── resume condition: file
                  │
                  │  resume condition satisfied
                  ▼
               active  (re-dispatched)
                  │
          ┌───────┴────────┐
          ▼                ▼
       completed         failed
```

### Valid Transitions

| From | To | Trigger |
|---|---|---|
| — | `active` | `missionRunService.create()` followed by orchestrator dispatch |
| `active` | `paused` | In-process pause signal checked at cycle/step boundary |
| `active` | `waiting_on_human` | `CONCLUDE` action OR `HIL_REQUEST` action OR wave governance gate |
| `active` | `waiting_on_file` | `folder_import` step with pending file |
| `active` | `completed` | Human confirms deliverable OR synthesis governor forces completion |
| `active` | `failed` | `FAIL` action, max cycles/waves exceeded, governance veto with no retry, or unrecoverable error |
| `paused` | `active` | Resume signal |
| `waiting_on_human` | `active` | `approvalRequests` satisfied (`human_approval` resume condition) OR mission chat directive |
| `waiting_on_file` | `active` | File matching `filePattern` detected in `folderPath` |

An implementation MUST NOT transition to any state not listed in this table.

> **EXEC-001:** A compliant implementation MUST fail the run (transition to `failed`) when `cycleCount` exceeds `missionContext.maxCycles`.  
> **EXEC-002:** A compliant implementation MUST fail the run when `current_wave` exceeds `missionContext.max_waves` in `rolling_wave` strategy.  
> **EXEC-003:** A compliant implementation MUST NOT dispatch a new cycle or wave if the run's current status is not `active`.

---

## 2. Launch Contract [NORMATIVE]

Before dispatching any cycle, wave, or pipeline execution, a compliant implementation MUST:

1. Create a `missionRuns` record via `missionRunService.create()` with status `active`
2. Set `missionContext` with at minimum: `cycleCount: 0`, `maxCycles` (default 20), `executionStrategy`
3. Emit no trace entries until the run record is committed to the database

The `OrchestrationContext` object constructed at dispatch time MUST contain:

```typescript
{
  missionRunId: number;       // REQUIRED
  missionId: number;          // REQUIRED
  userId: string;             // REQUIRED — effective user identity
  orgId: number | null;       // REQUIRED — tenant scope
  blackboard: Record<string, any>;     // from missions.blackboard
  missionContext: Record<string, any>; // from missionRuns.missionContext
  objective: string;          // from missions.objective
  allowedTools: string[];     // from missionContext.allowedTools || missions.allowedTools
  cycleCount: number;         // current cycle number
  maxCycles: number;          // ceiling
  dynamicTrace: any[];        // current trace array
  effectiveUserEmail: string; // resolved from userId
}
```

---

## 3. Dual-State Model [NORMATIVE]

**Implementation Note:** The current implementation splits orchestration state across two stores. This split is normative and both stores MUST be respected.

### 3.1 Blackboard (`missions.blackboard`)

- **Scope:** Mission-level; shared across all runs of a mission
- **Writers:** Action handlers (via `missionService.updateBlackboard`)
- **Semantics:** Append-only. Keys MUST NOT be deleted except via explicit GC.
- **GC rule:** A compliant implementation SHOULD evict the oldest `tool_output_*` keys when their count exceeds 20.
- **Well-known keys:**

| Key | Type | Written by | Semantics |
|---|---|---|---|
| `result` | `string \| any` | `CONCLUDE` | Final mission product |
| `high_value_deliverable` | `string` | `CONCLUDE` | Alias for primary deliverable |
| `last_tool_run` | `string` | `CALL_TOOL` | Name of last tool executed |
| `last_tool_status` | `"success" \| "failed"` | `CALL_TOOL` | Status of last tool call |
| `tool_output_{name}_{ts}` | `any` | `CALL_TOOL` | Timestamped tool output |
| `messages` | `array` | Various | Conversation history for chat-mode missions |
| `sharedMemories` | `array` | Various | Cross-agent shared observations |

> **BB-001:** A compliant implementation MUST write `last_tool_run` and `last_tool_status` to the blackboard on every `CALL_TOOL` completion (success or failure).  
> **BB-002:** A compliant implementation MUST write `result` to the blackboard via `missionContext.result` when `CONCLUDE` executes.

### 3.2 MissionContext (`missionRuns.missionContext`)

- **Scope:** Run-level; not shared with other runs
- **Writers:** Orchestrators; action handlers (for `result`, `phase`)
- **Semantics:** Key-value map; overwrite semantics (not append-only)
- **Normative keys:**

| Key | Type | Default | Semantics |
|---|---|---|---|
| `cycleCount` | `number` | `0` | Incremented each OODA cycle |
| `maxCycles` | `number` | `20` | Ceiling; EXEC-001 applies |
| `allowedTools` | `string[]` | `[]` | Whitelist of tool names; empty = all allowed |
| `rulesOfEngagement` | `object` | `{}` | Governance configuration |
| `phase` | `string` | `'PLANNING'` | Current phase in `rolling_wave` |
| `current_wave` | `number` | `1` | Current wave number |
| `max_waves` | `number` | `10` | Ceiling; EXEC-002 applies |
| `intent` | `string` | — | Mission objective copy |
| `result` | `any` | — | Written by `CONCLUDE` |

---

## 4. Dynamic Trace Contract [NORMATIVE]

The dynamic trace (`missionRuns.dynamicTrace`) is an append-only JSONB array. Every orchestration event MUST be appended; no entry may be deleted or modified after append.

### 4.1 Base Event Shape

Every trace entry MUST include:

```typescript
{
  type: TraceEventType;      // REQUIRED — see enumeration below
  event: string;             // REQUIRED — specific event name
  timestamp: string;         // REQUIRED — ISO 8601
  note?: string;             // human-readable summary (MUST be string, not object)
  // ...additional type-specific fields
}
```

> **TRACE-001:** The `note` field in any trace entry MUST be a string. A compliant implementation MUST serialize non-string values with `JSON.stringify()` before storing.

### 4.2 Trace Event Types

| Type | Semantics |
|---|---|
| `system` | Infrastructure events (concluded, action rejected, governance events) |
| `decision` | AI decision output — includes `action`, `thought`, `params` |
| `execution` | Tool or action execution result — includes `success`, `result`, `latencyMs` |
| `error` | Failure events — includes `error` message |
| `critic` | Quality audit output (vibe audit) — includes `score` |
| `strategist` | Planning/reflection narration |
| `action_execution` | Structured record from `runActionWithRuntimeKernel` — see `MissionActionExecutionRecord` |

### 4.3 Action Execution Record Shape [NORMATIVE]

When an action is dispatched via `runActionWithRuntimeKernel`, the trace MUST record:

```typescript
{
  type: "action_execution";
  event: `action_${"validating" | "executing" | "succeeded" | "failed" | "paused"}`;
  actionId: string;           // "${missionRunId}:${cycle}:${ACTION}:${Date.now()}"
  missionRunId: number;
  missionId: number;
  cycle: number;
  action: string;
  toolName?: string;          // only for CALL_TOOL
  status: string;
  startedAt: string;          // ISO 8601
  completedAt?: string;
  latencyMs?: number;
  thought?: string;           // from decision.thought_process
  error?: string;             // only on failure
}
```

> **TRACE-002:** A compliant implementation MUST emit an `action_validating` trace entry before executing any action handler.  
> **TRACE-003:** A compliant implementation MUST emit an `action_succeeded` or `action_failed` trace entry after handler completion.

---

## 5. Resume Conditions [NORMATIVE]

When a run transitions to `waiting_on_human` or `waiting_on_file`, the implementation MUST set `missionRuns.resumeCondition` to a typed object:

### 5.1 Human Approval Resume Condition

```typescript
{
  type: "human_approval";
  approvalRequestIds: number[];  // REQUIRED — IDs in approvalRequests table
}
```

> **RESUME-001:** A compliant implementation MUST transition the run to `active` and re-dispatch the orchestrator when all `approvalRequestIds` are resolved.

### 5.2 File Resume Condition

```typescript
{
  type: "file";
  folderPath: string;          // REQUIRED
  filePattern: string;         // REQUIRED — glob pattern
  pipelineExecutionId: number; // REQUIRED
  stepId: number;              // REQUIRED
}
```

> **RESUME-002:** A compliant implementation MUST transition the run to `active` when a file matching `filePattern` is detected in `folderPath`.

---

## 6. Terminal State Side-Effects [INFORMATIVE]

The following hooks are executed by this implementation on terminal state transitions. They are not required for conformance:

- **TrustGraph update** — records mission outcome in agent trust scores
- **Soul Evolution** — evolves the agent's character state
- **Compaction** — archives the blackboard snapshot for long-term storage
- **HIL sync** — notifies pending approval requests of completion
- **App-mission sync** — updates linked app state if mission was forge-originated

Conformant alternative implementations MAY omit these hooks.
