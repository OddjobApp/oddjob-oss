# Action Protocol

**Part of:** [Oddjob Mission Execution Specification](./SPEC.md)  
**Status:** Draft — v1.0.0

---

## 1. Base Interface [NORMATIVE]

Every action handler MUST implement:

```typescript
interface ActionHandler {
  execute(ctx: ActionContext, decision: BaseDecision): Promise<PausedResult | void>;
}
```

Where `ActionContext` extends `OrchestrationContext` with:

```typescript
{
  mlPredictedStrategy: string;
  mlCycleStartMs: number;
  currentCycle: number;
  appendTrace: (missionRunId: number, entry: Record<string, unknown>) => Promise<void>;
  trackAsset: (missionRunId: number, asset: Record<string, unknown>) => Promise<void>;
}
```

> **ACT-001:** A compliant implementation MUST dispatch all actions through `runActionWithRuntimeKernel`, which emits the required `action_validating`, `action_executing`, and `action_succeeded|failed` trace entries.

---

## 2. Action Registry [NORMATIVE]

The following action names MUST be recognized. Unknown actions MUST NOT cause a run failure — they SHOULD be logged and treated as `THINK_STEP`.

| Canonical Name | Alias | Handler |
|---|---|---|
| `CALL_TOOL` | — | `CallToolHandler` |
| `CONCLUDE` | `CONCLUDE_MISSION` | `ConcludeHandler` |
| `FAIL` | — | `FailHandler` |
| `HIL_REQUEST` | — | `HilRequestHandler` |
| `DELEGATE` | — | `DelegateHandler` |
| `LAUNCH_SUBMISSION` | — | `LaunchSubmissionHandler` |
| `EXTRACT_BLUEPRINT` | — | `ExtractBlueprintHandler` |
| `ARCHIVE_ASSET` | — | `ArchiveAssetHandler` |
| `SYNTHESIZE_TOOL` | — | `SynthesizeToolHandler` |
| `THINK_STEP` | — | `ThinkStepHandler` |

**Implementation Note:** `CONCLUDE_MISSION` is a deprecated alias for `CONCLUDE`. New implementations SHOULD use `CONCLUDE` as the canonical form. The alias MUST continue to route to `ConcludeHandler` for backward compatibility.

---

## 3. Handler Contracts

---

### 3.1 `CALL_TOOL`

**Purpose:** Invoke a named capability tool against the mission blackboard.

**Input (`action_details`):**

```typescript
{
  tool_name: string;                    // REQUIRED
  arguments?: Record<string, unknown>;  // passed to tool
}
```

**Governance gate:** MUST run before execution — see [agent-governance.md §3](./agent-governance.md).

**Blackboard writes (NORMATIVE):**

| Key | Value | Condition |
|---|---|---|
| `last_tool_run` | `tool_name` | Always |
| `last_tool_status` | `"success"` or `"failed"` | Always |
| `tool_output_{tool_name}_{timestamp}` | Tool result | On success |

> **ACT-002:** `last_tool_run` and `last_tool_status` MUST be written on every `CALL_TOOL` invocation, regardless of success or failure.  
> **ACT-003:** A compliant implementation MUST apply a 3-strike circuit breaker: if `CALL_TOOL` for the same `tool_name` fails 3 consecutive times, the implementation MUST emit a `HIL_REQUEST` to escalate to the human rather than continuing to retry.

**Trace events (NORMATIVE):**

```
type: "system", event: "tool_invoked"      — before execution
type: "system", event: "tool_success"      — on success
type: "system", event: "tool_failed"       — on failure
type: "system", event: "tool_approval_denied" — if governance blocks
```

**HIL gate:** MUST request approval if governance check returns `needsApproval: true`.

**Terminal effect:** None. Run continues to next cycle.

---

### 3.2 `CONCLUDE` / `CONCLUDE_MISSION`

**Purpose:** Signal that the agent believes the mission objective is met and submit a final product for human review.

**Input (`action_details`):**

```typescript
{
  final_product?: string;   // The deliverable content
}
```

`final_product` falls back to `decision.thought_process` if absent, then to the string `"Mission objective achieved."`.

**Blackboard writes (NORMATIVE):**

| Key | Value |
|---|---|
| `missionContext.result` | `final_product` |

**Trace events (NORMATIVE):**

```
type: "system", event: "mission_concluded_review"
note: "MISSION PRODUCT READY FOR REVIEW:\n\n{product}"
```

> **ACT-004:** `CONCLUDE` MUST transition the run to `waiting_on_human`, NOT `completed`. The run reaches `completed` only after a human confirms the deliverable or the synthesis governor overrides.

**Terminal effect:** Run status → `waiting_on_human`.

---

### 3.3 `FAIL`

**Purpose:** Mark the mission as definitively failed.

**Input:** None required.

**Blackboard writes:** None.

**Trace events (NORMATIVE):**

```
type: "error", event: "mission_failed"
note: "Mission marked as failed by Orchestrator."
```

> **ACT-005:** `FAIL` MUST transition the run to `failed` immediately and unconditionally.

**Terminal effect:** Run status → `failed`.

---

### 3.4 `HIL_REQUEST`

**Purpose:** Pause the run to ask the human a specific question.

**Input (`action_details`):**

```typescript
{
  question?: string;   // The question to present
}
```

**Blackboard writes:** None.

**Required side effects (NORMATIVE):**

> **ACT-006:** `HIL_REQUEST` MUST create an `approvalRequests` record in the database.  
> **ACT-007:** `HIL_REQUEST` MUST transition the run to `waiting_on_human`.  
> **ACT-008:** `HIL_REQUEST` MUST set `missionRuns.resumeCondition` to `{ type: "human_approval", approvalRequestIds: [newApprovalId] }`.

**Trace events (NORMATIVE):**

```
type: "system", event: "hil_question_submitted"
note: {question}
```

**Terminal effect:** Run status → `waiting_on_human` (resumable).

---

### 3.5 `DELEGATE`

**Purpose:** Launch an asynchronous sub-mission to handle a delegated task.

**Input (`action_details`):**

```typescript
{
  task_description?: string;
  allowed_tools?: string[];
  agent_name?: string;
}
```

**Blackboard writes:** None directly. The child mission writes to its own blackboard.

**Required side effects (NORMATIVE):**

> **ACT-009:** `DELEGATE` MUST create a child `missions` record with `isSubTask: true`.  
> **ACT-010:** `DELEGATE` MUST create a child `missionRuns` record and link it to the parent via `parentId` on the child run.  
> **ACT-011:** `DELEGATE` MUST be non-blocking: the parent run continues cycling while the child run executes independently.

**Trace events (NORMATIVE):**

```
type: "system", event: "delegation_launched"
note: "Launching async sub-mission for: {task}"
```

**Terminal effect:** None on parent. Parent continues to next cycle.

---

### 3.6 `LAUNCH_SUBMISSION`

**Purpose:** Submit work to an external recipient by launching a new top-level mission.

**Input (`action_details`):**

```typescript
{
  mission_name?: string;
  objective?: string;
}
```

**Required side effects (NORMATIVE):**

> **ACT-012:** `LAUNCH_SUBMISSION` MUST create a new `missions` record with `executionStrategy: "dynamic_autonomous"`.  
> **ACT-013:** The child mission MUST be linked to the parent via `parentId` on the mission record.

**Trace events (NORMATIVE):**

```
type: "system", event: "submission_launched"
note: "Launched sub-mission '{name}' (Run: {runId})"
```

**Terminal effect:** None on parent.

---

### 3.7 `SYNTHESIZE_TOOL`

**Purpose:** Propose synthesis of a new capability tool from patterns observed in this mission.

**Input (`action_details`):**

```typescript
{
  new_tool?: {
    name: string;
    code: string;
    language?: string;
    description?: string;
  };
}
```

**HIL gate (NORMATIVE):**

> **ACT-014:** `SYNTHESIZE_TOOL` MUST request human approval before creating any skill. Risk level: `high`. The run MUST pause until the approval is resolved.

The implementation MAY be non-blocking (`noWait: true`) if the approval is configured to auto-approve for trusted contexts.

**Trace events (NORMATIVE):**

```
type: "system", event: "tool_synthesis_proposed"    — on proposal
type: "system", event: "tool_synthesis_approved"    — on approval
type: "system", event: "tool_synthesis_rejected"    — on rejection
```

**Terminal effect:** None (resumes after human decision).

---

### 3.8 `ARCHIVE_ASSET`

**Purpose:** Decommission a knowledge asset (app or other slug-keyed resource).

**Input (`action_details`):**

```typescript
{
  app_slug?: string;
  asset_type?: string;
}
```

**HIL gate (NORMATIVE):**

> **ACT-015:** `ARCHIVE_ASSET` MUST request human approval before archiving. Risk level: `medium`.

**Trace events (NORMATIVE):**

```
type: "system", event: "asset_archived"     — on approval
type: "system", event: "archive_rejected"   — on rejection
```

**Terminal effect:** None.

---

### 3.9 `EXTRACT_BLUEPRINT`

**Purpose:** Promote a successfully forged app to a reusable blueprint in the library.

**Input (`action_details`):**

```typescript
{
  app_slug?: string;
  blueprint_name?: string;
}
```

**HIL gate (NORMATIVE):**

> **ACT-016:** `EXTRACT_BLUEPRINT` MUST request human approval before extraction. Risk level: `low`. The implementation MAY proceed non-blocking.

**Trace events (NORMATIVE):**

```
type: "system", event: "blueprint_extracted"  — on approval
type: "system", event: "extraction_rejected"  — on rejection
```

**Terminal effect:** None.

---

### 3.10 `THINK_STEP`

**Purpose:** Internal reasoning step; no external side effects.

**Input:** None required.

**Blackboard writes:** None.

**Trace events (NORMATIVE):**

None required. The `action_execution` kernel trace is sufficient.

> **ACT-017:** `THINK_STEP` MUST enqueue the next cycle immediately. It MUST NOT transition to any terminal state.

**Terminal effect:** None. Run continues to next cycle.

---

## 4. Unknown Actions [NORMATIVE]

If the AI returns an action name that is not in the registry:

> **ACT-018:** A compliant implementation MUST NOT fail the run due to an unknown action name. It MUST log the unknown action, emit a warning trace entry, and treat it as `THINK_STEP`.
