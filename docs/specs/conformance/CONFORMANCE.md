# Conformance Requirements

**Part of:** [Oddjob Mission Execution Specification](../SPEC.md)  
**Status:** Draft — v1.0.0

---

## 1. Conformance Levels

A conformant implementation declares one of the following levels:

| Level | Requirements |
|---|---|
| **Level 1 — State Machine** | All `EXEC-*` and `RESUME-*` assertions |
| **Level 2 — Action Protocol** | Level 1 + all `ACT-*`, `TRACE-*`, `BB-*` assertions |
| **Level 3 — Full Governance** | Level 2 + all `GOV-*`, `LOOP-*`, `PIPE-*`, `WAVE-*`, `STRAT-*`, `SYNTH-*` assertions |

A production deployment SHOULD target Level 3.

---

## 2. Numbered Assertions

### EXEC — Mission Run Lifecycle

| ID | Assertion | Level |
|---|---|---|
| EXEC-001 | If `cycleCount > maxCycles`, the run MUST transition to `failed` and stop | 1 |
| EXEC-002 | If `current_wave > max_waves`, the run MUST transition to `failed` and stop | 1 |
| EXEC-003 | A new cycle or wave MUST NOT be dispatched if run status is not `active` | 1 |
| EXEC-004 | A `missionRuns` record MUST be created before any cycle, wave, or step executes | 1 |
| EXEC-005 | Run status MUST follow only the valid transition table in `mission-execution.md §1` | 1 |

### RESUME — Resume Conditions

| ID | Assertion | Level |
|---|---|---|
| RESUME-001 | On `human_approval` resume condition satisfied, run MUST transition to `active` and re-dispatch | 1 |
| RESUME-002 | On `file` resume condition satisfied (matching file detected), run MUST transition to `active` | 1 |

### BB — Blackboard Contract

| ID | Assertion | Level |
|---|---|---|
| BB-001 | `last_tool_run` and `last_tool_status` MUST be written on every `CALL_TOOL` invocation | 2 |
| BB-002 | `missionContext.result` MUST be written when `CONCLUDE` executes | 2 |
| BB-003 | Blackboard keys MUST NOT be deleted except via GC protocol | 2 |

### TRACE — Dynamic Trace

| ID | Assertion | Level |
|---|---|---|
| TRACE-001 | The `note` field in any trace entry MUST be a string | 2 |
| TRACE-002 | An `action_validating` trace entry MUST be emitted before executing any action handler | 2 |
| TRACE-003 | An `action_succeeded` or `action_failed` trace entry MUST be emitted after handler completion | 2 |
| TRACE-004 | A `decision` trace entry MUST be emitted before any governance check or execution | 2 |

### ACT — Action Protocol

| ID | Assertion | Level |
|---|---|---|
| ACT-001 | All actions MUST be dispatched through `runActionWithRuntimeKernel` | 2 |
| ACT-002 | `last_tool_run` and `last_tool_status` MUST be written on every `CALL_TOOL` | 2 |
| ACT-003 | 3 consecutive failures of the same tool MUST trigger `HIL_REQUEST` escalation | 2 |
| ACT-004 | `CONCLUDE` MUST transition run to `waiting_on_human`, not `completed` | 2 |
| ACT-005 | `FAIL` MUST immediately transition run to `failed` | 2 |
| ACT-006 | `HIL_REQUEST` MUST create an `approvalRequests` record | 2 |
| ACT-007 | `HIL_REQUEST` MUST transition run to `waiting_on_human` | 2 |
| ACT-008 | `HIL_REQUEST` MUST set `resumeCondition.type = "human_approval"` | 2 |
| ACT-009 | `DELEGATE` MUST create a child missions record with `isSubTask: true` | 2 |
| ACT-010 | `DELEGATE` MUST link child run to parent via `parentId` | 2 |
| ACT-011 | `DELEGATE` MUST be non-blocking (parent continues cycling) | 2 |
| ACT-012 | `LAUNCH_SUBMISSION` MUST create a new missions record | 2 |
| ACT-013 | `LAUNCH_SUBMISSION` child MUST be linked to parent via `parentId` | 2 |
| ACT-014 | `SYNTHESIZE_TOOL` MUST request human approval (risk: high) before creating any skill | 2 |
| ACT-015 | `ARCHIVE_ASSET` MUST request human approval (risk: medium) | 2 |
| ACT-016 | `EXTRACT_BLUEPRINT` MUST request human approval (risk: low) | 2 |
| ACT-017 | `THINK_STEP` MUST enqueue the next cycle and MUST NOT transition to a terminal state | 2 |
| ACT-018 | Unknown action names MUST NOT fail the run — they MUST be treated as `THINK_STEP` | 2 |

### GOV — Governance Protocol

| ID | Assertion | Level |
|---|---|---|
| GOV-001 | If `run.costUsd` exceeds `mission.budgetLimitUsd`, the run MUST stop | 3 |
| GOV-002 | `MissionGovernanceService.validate()` MUST be called at the start of every wave cycle | 3 |
| GOV-003 | `SAFE_TOOLS` is the fixed set `{think_step, google_search, browse_web}` | 3 |
| GOV-004 | A sentinel-rejected action MUST escalate to human approval | 3 |
| GOV-005 | Both `approvalPolicy.requiresApproval` and `riskLevel === "high"` independently trigger approval | 3 |
| GOV-006 | An action MUST NOT be dispatched if any approval gate returns `approved: false` | 3 |
| GOV-007 | Governance tier thresholds MUST be honoured by the decisionRouter | 3 |
| GOV-008 | All queries and tool calls MUST be scoped to the run's `organizationId` | 3 |
| GOV-009 | Credentials MUST be resolved via `credentialsService` scoped to `orgId` | 3 |

### STRAT — Orchestration Strategies

| ID | Assertion | Level |
|---|---|---|
| STRAT-001 | A mission run MUST NOT start any execution before the `missionRuns` record is created | 1 |
| STRAT-002 | The orchestrator MUST be determined solely by `mission.executionStrategy` | 1 |

### SYNTH — Synthesis Governor

| ID | Assertion | Level |
|---|---|---|
| SYNTH-001 | If synthesis returns `recommend: "conclude"` with `confidence >= 0.8`, the run MUST conclude | 3 |

### WAVE — Rolling Wave

| ID | Assertion | Level |
|---|---|---|
| WAVE-001 | An audit veto MUST prevent transition to `EXECUTING`; the run MUST re-plan | 3 |
| WAVE-002 | Governance validation MUST be called at the start of every wave cycle | 3 |

### LOOP — Loopbane Protocols

| ID | Assertion | Level |
|---|---|---|
| LOOP-001 | Per-step visit counts MUST be tracked for the lifetime of the execution | 3 |
| LOOP-002 | On Protocol A breach with `route_to_fallback`, execution MUST redirect to `destination` step | 3 |
| LOOP-003 | Protocol B payload hash MUST be stored after computing, before comparison | 3 |
| LOOP-004 | Protocol B stagnation MUST abort the pipeline | 3 |
| LOOP-005 | Protocol C MUST be checked at every step boundary | 3 |
| LOOP-006 | Retry attempts MUST NOT exceed `retryConfig.maxAttempts` | 3 |

### PIPE — Pipeline Execution

| ID | Assertion | Level |
|---|---|---|
| PIPE-001 | Steps MUST execute in `order` sequence | 3 |
| PIPE-002 | Variables MUST be resolved before passing configuration to the job executor | 3 |
| PIPE-003 | Variable context MUST be updated before step-complete hooks fire | 3 |
| PIPE-004 | `Stop Pipeline` failure action MUST halt and mark execution `failed` | 3 |
| PIPE-005 | Abort signal MUST halt at next step boundary | 3 |
| PIPE-006 | Pause signal MUST suspend at next step boundary with state preserved | 3 |
| PIPE-007 | `pipelineExecutions.status` MUST be updated on completion | 3 |

---

## 3. Test Harness

See `tests/spec-conformance/` for the test suite. Each test file corresponds to one assertion group and is tagged with assertion IDs in test names.

Tests MUST be pure unit tests with no database, Redis, or BullMQ dependencies. Use mock `appendTrace` and `missionRunService` implementations.

---

## 4. Fixture Format

Each fixture in `conformance/fixtures/` is a JSON file with:

```json
{
  "description": "Human-readable test scenario",
  "assertions": ["ACT-004", "EXEC-001"],
  "input": { ... },
  "expectedBlackboardDelta": { ... },
  "expectedTraceEvents": [
    { "type": "...", "event": "..." }
  ],
  "expectedRunStatus": "waiting_on_human"
}
```
