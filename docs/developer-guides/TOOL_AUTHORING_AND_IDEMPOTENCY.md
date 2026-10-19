# Agent Tool Authoring & Idempotency Classification Guide

Oddjob features a catalog of 450+ autonomous tools invoked by Copilot, Crew AI Swarms, and automated task runners. To maintain determinism, security, and human-in-the-loop safety, every tool definition must adhere to the **Idempotency Contract**, verified by `npm run check:tool-idempotency`.

---

## 1. The Idempotency Triad

Every tool exported in `server/domain/tools/v1/capabilities/` must define an `idempotency` field belonging to one of three categories:

| Idempotency Value | Semantic Meaning | Retries / Replay Safety | HIL Approval Required? |
| :--- | :--- | :--- | :--- |
| `"read-safe"` | Pure read-only query. Has zero persistent side-effects. | Unlimited retries safe. | Never. Completely autonomous. |
| `"idempotent"` | Modifies state, but executing it $N$ times produces the identical outcome as executing once (e.g. upserts, state syncs, deletes by ID). | Safe to retry on transient network failures. | No, provided preconditions match. |
| `"side-effecting"` | Non-idempotent mutation (e.g. spending money, triggering emails, advancing irreversible workflows, dropping tables). | Cannot be retried blindly; requires deduplication tokens. | Optional/Configurable based on organizational Autonomy Level. |

---

## 2. Canonical Tool Definition Schema

Tool definitions are declared using standard JSON Schema / TypeBox definitions:

```typescript
// server/domain/tools/v1/capabilities/discovery.ts
import { registerTool } from "../registry.js";

export const launchScoreTutorialTool = {
  name: "launch_score_tutorial",
  description: "Triggers an interactive S.C.O.R.E. guided walkthrough for the user in the UI.",
  idempotency: "read-safe" as const,
  parameters: {
    type: "object",
    properties: {
      tutorialId: {
        type: "string",
        description: "The identifier of the tutorial playlist (e.g., 'operations-cycle-312')."
      },
      startStepIndex: {
        type: "number",
        description: "Optional 0-based step index to start at."
      }
    },
    required: ["tutorialId"]
  },
  execute: async (args: { tutorialId: string; startStepIndex?: number }, context: ToolContext) => {
    // Execution logic
    return {
      type: "launch_tutorial",
      tutorialId: args.tutorialId,
      stepIndex: args.startStepIndex ?? 0
    };
  }
};
```

---

## 3. Distributed Tracing & Telemetry Envelopes

Every tool execution receives a `ToolContext` containing session metadata and trace headers:

1. **W3C Traceparent Header**: Always propagate or generate a traceparent to tie tool execution to the parent mission:
   ```typescript
   const trace = context.traceparent || generateW3CTraceparent();
   ```
2. **Forensic Logging**: Emit telemetry events on execution start, completion, and error.
3. **Graceful Error Packaging**: Return structured error objects with clear user-facing messages rather than crashing the agent loop:
   ```typescript
   if (!entity) {
     return {
       success: false,
       errorCode: "ENTITY_NOT_FOUND",
       message: `Entity with ID '${args.id}' was not found in active organization.`
     };
   }
   ```

---

## 4. Pre-Commit Validation

Run the tool idempotency validator locally:

```bash
npm run check:tool-idempotency
```

A successful audit reports:
```
🔍 [TOOL AUDIT] Verifying idempotency annotations on 455 tools...
✅ [TOOL AUDIT] 455 tools checked. 0 undeclared idempotency tags found.
```
