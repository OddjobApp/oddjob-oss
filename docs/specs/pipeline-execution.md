# Pipeline Execution Contract

**Part of:** [Oddjob Mission Execution Specification](./SPEC.md)  
**Status:** Draft — v1.0.0

Applies to `pre_planned` execution strategy and any pipeline invoked by other strategies via `PipelineExecutor`.

---

## 1. Step Execution Contract [NORMATIVE]

### 1.1 Ordering

Steps MUST execute in ascending order of `pipelineStep.order`. A compliant implementation MUST NOT execute step N+1 before step N has completed (success or handled failure), unless the step's `onFailureAction` is `"Skip Step"`.

> **PIPE-001:** Steps MUST execute in `order` sequence. Concurrent step execution within a single pipeline is non-conformant unless explicitly specified by a `parallel` step type.

### 1.2 Variable Resolution

Before each step invocation, a compliant implementation MUST resolve all `{{variable}}` placeholders in the step's prompt and configuration using the `VariableContext`:

```typescript
interface VariableContext {
  positional: Record<number, string>;   // step.order → output of that step
  named: Record<string, string>;        // step.outputName → output
  history: Record<number, any>;         // step.order → parsed JSON output
}
```

Variables are resolved in this priority order:
1. `named[varName]` — exact match on `outputName`
2. `positional[stepOrder]` — numeric step order
3. Raw string fallback

> **PIPE-002:** A compliant implementation MUST resolve variables before passing the step configuration to the job executor. Unresolved variables MUST NOT cause a step failure — they SHOULD be passed as-is with the `{{...}}` syntax preserved.

### 1.3 Post-Execution Variable Update

After a successful step:
- `context.positional[step.order]` MUST be set to `result.output`
- `context.history[step.order]` MUST be set to `safeJsonParse(result.output)`
- If `step.outputName` is set: `context.named[step.outputName]` MUST be set to `result.output`

> **PIPE-003:** Variable context updates MUST occur BEFORE step-complete hooks are triggered, so that hooks receive the updated context.

### 1.4 Failure Handling

On step failure, a compliant implementation MUST check `step.onFailureAction`:

| Value | Behaviour |
|---|---|
| `"Stop Pipeline"` | Halt execution, mark pipeline execution as `failed` |
| `"Skip Step"` | Continue to next step, record step as `skipped` |
| `"Retry"` | Re-attempt the step (see retry configuration) |
| (absent) | Equivalent to `"Stop Pipeline"` |

> **PIPE-004:** If `onFailureAction === "Stop Pipeline"` or is absent, the pipeline execution MUST transition to `failed` and MUST NOT execute any subsequent steps.

---

## 2. Abort / Pause / Resume Signals [NORMATIVE]

The pipeline executor MUST check for in-process control signals at each step boundary, before executing the next step.

> **PIPE-005:** If an abort signal has been received for the current `executionId`, the implementation MUST stop at the next step boundary and mark the execution as `failed`.  
> **PIPE-006:** If a pause signal has been received, the implementation MUST suspend at the next step boundary. The execution state MUST be preserved such that a subsequent resume signal causes execution to continue from the paused step.

---

## 3. Loopbane Protocols [NORMATIVE]

Three safety protocols apply to pipeline executions that include decision nodes. A compliant implementation MUST invoke all three at every decision node evaluation, in order:

```
Protocol A (Cycle Breaker) → Protocol B (Stagnation Lock) → Protocol C (Doomsday Clock)
```

If any protocol returns `allowed: false`, the pipeline execution MUST be halted according to the protocol's specified action. The step MUST NOT execute.

### Protocol A — Cycle Breaker

**Trigger:** Decision node with `safetyPolicy.maxLoops` configured.  
**Check:** `visitCount >= maxLoops`  
**Action on breach:** `safetyPolicy.onLoopLimitExceeded.action` — either `route_to_fallback` (redirect to `destination` step) or `abort_workflow` (fail the pipeline).

> **LOOP-001:** A compliant implementation MUST track per-step visit counts for the lifetime of the pipeline execution. Visit count persistence is implementation-defined (Redis, database, or in-memory).  
> **LOOP-002:** On breach, if `action === "route_to_fallback"`, the implementation MUST redirect execution to `destination` step ID, not abort.

### Protocol B — Stagnation Lock

**Trigger:** Decision node with `safetyPolicy.onStagnationDetected` configured.  
**Check:** SHA-256 hash of `{ named, positional, data }` is identical to the hash from the previous visit to this step.  
**Action on breach:** Abort the pipeline (`allowed: false`).

> **LOOP-003:** A compliant implementation MUST compute the SHA-256 payload hash AFTER storing it for the current visit, so that the hash from visit N is available for comparison at visit N+1.  
> **LOOP-004:** On stagnation detection, the implementation MUST abort the pipeline and record the reason `"Payload hash unchanged — no progress detected"`.

### Protocol C — Doomsday Clock

**Trigger:** Pipeline execution with `ttl` (seconds) configured AND `startedAt` set.  
**Check:** `(Date.now() - startedAt.getTime()) / 1000 >= ttl`  
**Action on breach:** Abort the pipeline.

> **LOOP-005:** A compliant implementation MUST check the Doomsday Clock at EVERY step boundary, not just at decision nodes. This ensures TTL is enforced even for straight-line pipelines.

### Exponential Backoff Retry

If a step uses retry configuration, the delay between attempts MUST follow:

```
delay = min(baseDelayMs × 2^(attempt - 1), maxRetryBackoffMs)
```

Default `baseDelayMs`: 10000 ms. Default `maxRetryBackoffMs`: 300000 ms (5 minutes).

> **LOOP-006:** A compliant implementation MUST NOT retry a failed step more than `retryConfig.maxAttempts` times (default 3).

---

## 4. Execution Record [NORMATIVE]

A compliant implementation MUST create a `pipelineExecutions` record before the first step executes, and MUST update its `status` field on completion:

| Status | Semantics |
|---|---|
| `running` | Execution is active |
| `completed` | All steps succeeded |
| `failed` | A step failed and pipeline was stopped |
| `paused` | Execution suspended awaiting resume |
| `cancelled` | Execution aborted via abort signal |

> **PIPE-007:** `pipelineExecutions.status` MUST be updated atomically with the last step's completion. A compliant implementation MUST NOT leave the record in `running` state after the execution has terminated.

---

## 5. Shadow Mode [INFORMATIVE]

If `missionRun.isShadow === true`, the pipeline execution MUST be created with `isShadow: true`. Shadow executions SHOULD NOT affect production state (e.g., should not send external notifications, should not commit to production databases). The isolation mechanism is implementation-defined.
