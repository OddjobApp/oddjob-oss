# Agent Human-in-the-Loop (HIL) Escalation Contract

This contract defines the formal runtime rules and schemas governing when an autonomous agent in Oddjob must pause execution and escalate decisions to a human operator.

---

## 1. Mandatory Escalation Triggers

An agent MUST yield control and pause for human review when ANY of the following conditions are met:

1. **Safety & Permission Barrier**: Tool operation has `idempotency: "side-effecting"` and the active organization Autonomy Level is $< \text{L4}$.
2. **Financial / Token Quota Breach**: Cumulative mission spending exceeds the per-stage budget threshold (e.g. `$50` or `5,000,000` tokens).
3. **Consensus Standoff**: Multi-agent room deliberation fails to attain the required consensus threshold after 5 voting rounds.
4. **Max Replans Exceeded**: The agent has attempted 3 failed replanning cycles on the same mission step.
5. **Confidence Deficit**: Self-reflection model confidence score falls below $70\%$.

---

## 2. Escalation Event Schema

When an escalation trigger is activated, the agent generates an `escalation_request` event:

```typescript
export interface HILEscalationRequest {
  /** Unique ID of the escalation event */
  escalationId: string;
  /** Associated mission or cycle ID */
  missionId: number;
  /** Stage ID where the pause occurred */
  stageId: string;
  /** Reason trigger for the escalation */
  reason: "side_effect" | "budget_exceeded" | "low_confidence" | "consensus_deadlock";
  /** Current state summary formatted for the human operator */
  summary: string;
  /** Recommended candidate options with agent rationale */
  options: Array<{
    id: string;
    label: string;
    description: string;
    recommended: boolean;
  }>;
  /** Timestamp of the pause */
  pausedAt: string;
  /** W3C Distributed Traceparent */
  traceparent: string;
}
```

---

## 3. The Human Ratification Cockpit

The escalation event renders in the UI as an interactive HIL Form (e.g. [`HILGovernancePod.tsx`](../../../server/domain/core/ui/components/packaged/HILGovernancePod.tsx) or [`DecisionMatrixPod.tsx`](../../../server/domain/core/ui/components/packaged/DecisionMatrixPod.tsx)).

### Operator Actions:
1. **Ratify & Commit**: Operator approves the agent's recommended action. Agent resumes autonomous execution.
2. **Override & Redirect**: Operator selects an alternative candidate or injects prompt steering instructions. Agent incorporates human feedback into its replan context.
3. **Abort Mission**: Operator aborts the task. Agent executes compensation tools to cleanly rollback partial side-effects.
