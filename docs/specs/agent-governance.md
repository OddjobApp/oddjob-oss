# Agent Governance Contract

**Part of:** [Oddjob Mission Execution Specification](./SPEC.md)  
**Status:** Draft — v1.0.0

---

## 1. Budget Hierarchy [NORMATIVE]

Three budget ceilings exist, checked in order from narrowest to broadest scope. A compliant implementation MUST enforce all three.

```
Level 1: Per-cycle budget          missionContext.rulesOfEngagement.maxBudgetUsd
Level 2: Per-run budget            missions.budgetLimitUsd
Level 3: Per-operational-cycle     MissionGovernanceService.validate()
```

> **GOV-001:** If `run.costUsd` exceeds `mission.budgetLimitUsd`, a compliant implementation MUST stop the current cycle, transition the run to `paused` or `failed`, and NOT dispatch another cycle.

> **GOV-002:** `MissionGovernanceService.validate()` MUST be called at the start of every wave cycle (rolling wave) and SHOULD be called before each OODA cycle (dynamic autonomous). If validation fails, the orchestrator MUST stop.

---

## 2. Tool Approval Protocol [NORMATIVE]

Before any non-trivial action is dispatched, a compliant implementation MUST execute the following five-step sequence **in order**. A step that grants approval terminates the sequence early (the remaining steps MUST NOT be evaluated).

```
Step 1: Human-Driven Gate
Step 2: SAFE_TOOLS Bypass
Step 3: requireApprovalForAll flag
Step 4: Sentinel Audit
Step 5: Tool Contract (explicit policy or riskLevel)
```

### Step 1 — Human-Driven Gate

If the mission name starts with `"Debug Mission:"`, approval is granted unconditionally. Skip remaining steps.

### Step 2 — SAFE_TOOLS Bypass

If the action name (case-insensitive) is in `SAFE_TOOLS`, approval is granted. Skip remaining steps.

```typescript
SAFE_TOOLS = new Set(["think_step", "google_search", "browse_web"])
```

> **GOV-003:** `SAFE_TOOLS` is a fixed set. A compliant implementation MUST NOT add to or remove from this set without updating this spec.

### Step 3 — requireApprovalForAll Flag

If `missionContext.requireApprovalForAll === true` AND the action is NOT `conclude_mission` or `fail_mission`, the implementation MUST request approval. Proceed to `requestApproval()`.

### Step 4 — Sentinel Audit

Call `MissionGovernanceService.sentinelAudit(missionRunId, { tool: action, params }, objective, orgId)`.

> **GOV-004:** If the sentinel returns `approved: false`, the implementation MUST request human approval (escalation). It MUST NOT proceed with action execution without an explicit human approval.

### Step 5 — Tool Contract

Look up the tool in the tool registry.

- If `tool.approvalPolicy.requiresApproval === true` → request approval.
- If `tool.riskLevel === "high"` → request approval.
- Otherwise → grant approval.

> **GOV-005:** A compliant implementation MUST check both `approvalPolicy.requiresApproval` and `riskLevel`. Both independently trigger the approval gate. The order within this step is implementation-defined.

### Approval Request

When approval is required, call `orchestrationGovernanceService.requestApproval()`. This routes to `decisionRouter.requestDecision()`.

If `approved: false`:
- Emit `action_rejected` trace
- Queue next cycle (1 second delay)
- Return without executing the action

If `approved: true` with `modifiedOutput`:
- Update `decision.params` with `modifiedOutput` before dispatch

> **GOV-006:** An action MUST NOT be dispatched to its handler if any approval gate returns `approved: false`.

---

## 3. Governance Tiers [NORMATIVE]

Three named tiers configure the strictness of the governor consensus check:

| Tier | Consensus Threshold | Veto Threshold | Timeout |
|---|---|---|---|
| `strict` | 90% | 30% | 2 minutes |
| `standard` | 75% | 10% | 60 seconds |
| `relaxed` | 50% | 5% | 30 seconds |

`missionContext.rulesOfEngagement.governanceTier` selects the active tier. Default is `standard`.

> **GOV-007:** A compliant implementation MUST respect the consensus and veto thresholds of the active governance tier when routing decisions through the decisionRouter.

---

## 4. Credential Scoping [NORMATIVE]

All database queries, tool calls, and external API calls MUST be scoped to the mission run's `organizationId`.

> **GOV-008:** A compliant implementation MUST NOT read or write resources belonging to an `organizationId` other than the one on the active mission run.  
> **GOV-009:** Tool calls that accept credentials MUST resolve credentials via `credentialsService` scoped to `orgId`. Direct use of environment-level secrets is non-conformant.

---

## 5. Agent Token Budget [INFORMATIVE]

The `agentSalaries` table and `BudgetGovernanceService` implement per-agent token metering. When an agent's `currentSpendTokens` reaches `budgetTokens`, the governor may:

1. Warn the agent (status → `probation`)
2. Place on PIP (Performance Improvement Plan)
3. Terminate the session (status → `deprovisioned`)

Conformant alternative implementations MAY use any budget tracking mechanism, provided they enforce the ceiling defined in **GOV-001**.

---

## 6. Notification Channels [INFORMATIVE]

When `requestApproval()` is called, the notification channels are sourced from:

```typescript
missionContext.rulesOfEngagement?.notificationChannels || ["copilot", "inbox"]
```

The set of valid channel identifiers and their routing are implementation-defined.
