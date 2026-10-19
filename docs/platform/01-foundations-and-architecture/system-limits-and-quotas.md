---
id: system-limits-and-quotas
title: System Limits, Quotas & Token Budget Management Standards
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, GOVERNANCE]
badge: GOVERNANCE
category: 01-foundations-and-architecture
autonomy_level: L1-L4
version: 2.0.0
tags: [limits, quotas, token-budget, rate-limits, context-window, performance, finops]
summary: Hard and soft execution limits, token budget quotas, rate-limiting headers, and compaction rules for Oddjob agents, pipelines, and distributed worker nodes.
verification_status: verified
applies_when:
  - Designing agent missions, multi-agent swarms, or batch data ingestion pipelines
  - Configuring tenant token quotas, spending ceilings, and concurrent worker limits
  - Querying real-time spend and budgeting metrics programmatically
do_not_use_when:
  - Hardcoding client-side arbitrary timeouts that bypass control plane limits
required_tools:
  - get_project_spend
  - get_cost_analysis
  - set_project_budget_cap
preconditions:
  - Tenant billing engine initialized with allocated monthly credits
  - OpenTelemetry token measurement middleware active
approval_requirements:
  - Raising monthly project spending limits above $500 requires Organization Admin approval
success_checks:
  - Agent workflows execute within allocated token and duration budgets
  - Token consumption metrics accurately reported to telemetry bus within $< 50\text{ms}$
stop_conditions:
  - Hard project budget cap reached ($100\%$) or global concurrency ceiling saturated
escalation:
  - Downgrade agent to Tier 1 local model and alert project billing owner
implementation_evidence:
  - server/domain/billing/
  - server/domain/ai/core/dynamic-tuning.service.ts
---

# System Limits, Quotas & Token Budget Management `[⚖️ GOVERNANCE]`

> **Audience:** `⚖️ Governance / Platform SRE & FinOps` &nbsp;|&nbsp; **Classification:** System Limits & Capacity Boundary

---

## 1. Global Platform System Limits Matrix `[🧑 Human]`

Oddjob enforces strict architectural boundaries to guarantee system stability and prevent rogue execution loops:

| System Parameter | Hard Upper Limit | Default Recommendation | Enforcement Mechanism |
| :--- | :--- | :--- | :--- |
| **Max Agent Turns per Task** | `50 turns` | `15 - 25 turns` | Orchestrator step loop counter |
| **Max Token Budget per Turn** | `8,192 tokens` | `150 - 350 tokens` (JIT HUD) | `PhaseCompiler` dynamic pruner |
| **Max Tool Execution Timeout** | `60 seconds` | `10 seconds` | Worker process watchdog timer |
| **Concurrent Workers per Org** | `100 workers` | `10 - 25 workers` | BullMQ Redis concurrency semaphore |
| **Max File Upload / Ingestion** | `100 MB` | `25 MB` | HTTP reverse proxy ingress limit |
| **Max Subagent Depth** | `3 levels` | `1 level` (Parent $\rightarrow$ Worker) | Delegation recursion guard |

---

## 2. Programmatic Quota Querying & Self-Regulation `[🤖 Agent Reference]`

Autonomous agents must actively self-regulate token consumption during long multi-step missions:

```mermaid
graph TD
    Start["Begin Mission Step"] --> CheckBudget["1. Query get_project_spend({ projectId })"]
    CheckBudget --> ThresholdCheck{"Budget Used %"}
    ThresholdCheck -- "< 80%" --> NormalMode["Execute with Standard Model (Tier 2/3)"]
    ThresholdCheck -- "80% - 95%" --> ConservationMode["Activate Context Pruning (Truncate History to 3 turns)"]
    ThresholdCheck -- "95% - 99%" --> FallbackTier1["Downgrade all subagents to Tier 1 Local Model"]
    ThresholdCheck -- ">= 100%" --> Lockout["Halt Mutations & Trigger Budget Increase Form"]
```

### Checking Project Spend Programmatically
```typescript
const spend = await get_project_spend({ projectId: "proj_9918" });

if (spend.percentOfCap > 0.90) {
  // Compress context before proceeding to next subtask
  console.warn(`Project spend at ${spend.percentOfCap * 100}%. Pruning conversation history.`);
}
```

---

## 3. Rate Limiting Headers & Backoff Rules `[🤖 Agent Reference]`

All inbound and outbound HTTP API requests track standard rate limit headers:

- `X-RateLimit-Limit`: Maximum allowed requests per sliding 60s window.
- `X-RateLimit-Remaining`: Remaining request count in current window.
- `X-RateLimit-Reset`: UTC epoch timestamp when current window resets.

**Agent Rule:** If `X-RateLimit-Remaining < 5`, agents MUST insert an artificial delay $\Delta t = \frac{\text{Reset} - \text{Now}}{\text{Remaining}}$ between sequential tool calls.
