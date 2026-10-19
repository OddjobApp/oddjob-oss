---
id: subagent-delegation-and-handoff
title: "Subagent Delegation, Context Isolation & Parent-Child Task Handoffs"
audience: ["AGENT_PRIMARY", "HYBRID", "GOVERNANCE"]
badge: "AGENT_PRIMARY"
category: "01-foundations-and-architecture"
autonomy_level: "L3-L4"
version: "1.0.0"
tags: ["subagents", "delegation", "orchestration", "context-isolation", "swarm", "recursion-limits"]
summary: "Execution standards for leader agents to decompose complex operational goals, spawn ephemeral subagents with isolated context budgets, enforce recursion limits, and synthesize child outputs."
applies_when: "Two or more bounded subtasks can run independently | A specialist context materially improves quality or latency"
do_not_use_when: "The task is sequential, trivial, or lacks a callable delegation capability | Delegation would broaden user-authorized scope"
required_tools: "A live subagent or delegation capability exposed by the runtime"
preconditions: "Confirm concurrency and recursion limits from the live runtime | Define a bounded task and output contract"
approval_requirements: "Delegated actions inherit, and never expand, the parent task's authority"
success_checks: "Validate child outputs | Reconcile contradictions | Parent owns the final answer and verification"
stop_conditions: "No state advancement after one retry | Recursion or concurrency limit reached | Required authority is missing"
escalation: "Return partial results and identify the failed bounded subtask"
implementation_evidence: "Conceptual protocol; runtime limits in this article are defaults unless confirmed by the live delegation tool"
verification_status: "guidance"
---

# Subagent Delegation & Parent-Child Task Handoffs

> **Audience:** 🤖 Agent / Autonomous | 🤝 Hybrid / Co-Pilot | 🛡️ Safety & Governance  
> **Autonomy Level:** L3 to L4
> **Telemetry Span:** `agent.subagent.spawn`

---

## 1. Architectural Model & Task Decomposition

When a mission requires multiple specialized operations (e.g. *Code Analysis*, *Database Querying*, and *Documentation Ingestion*), a single agent context can quickly degrade. Leader agents must break down the mission into independent sub-tasks and spawn ephemeral subagents.

```mermaid
graph TD
    Leader[Leader / Coordinator Agent] --> Plan[Decompose Mission into Sub-Tasks]
    
    subgraph Isolated Ephemeral Runtimes
        Plan -->|Spawn Task 1| Sub1[Research Subagent<br/>Context: 8k Tokens]
        Plan -->|Spawn Task 2| Sub2[Database Verification Subagent<br/>Context: 8k Tokens]
        Plan -->|Spawn Task 3| Sub3[Code Patch Subagent<br/>Context: 8k Tokens]
    end
    
    Sub1 --> Out1[Structured JSON Output 1]
    Sub2 --> Out2[Structured JSON Output 2]
    Sub3 --> Out3[Structured JSON Output 3]
    
    Out1 --> Aggregator[Parent Synthesis Engine]
    Out2 --> Aggregator
    Out3 --> Aggregator
    
    Aggregator --> FinalResult[Synthesized Mission Deliverable]
```

---

## 2. Delegation Invariants & Recursion Limits

Agents must strictly adhere to the following operational invariants:

| Constraint | Limit / Rule | Rationale |
| :--- | :--- | :--- |
| **Maximum Recursion Depth** | **$3$ Levels** ($\text{Leader} \to \text{Subagent} \to \text{Worker}$) | Prevents unbounded agent recursion and runaway compute charges. |
| **Context Isolation** | Never pass full parent conversation history | Subagents must receive only the specific task prompt and relevant input schemas. |
| **Max Concurrent Children** | **$\le 5$ Parallel Subagents** | Protects database connection pools and external API rate limits. |
| **Timeout Ceiling** | **$120\text{s}$ per subagent** | Unresponsive subagents are terminated and routed to error recovery. |

---

## 3. Delegation Tool Invocation Pattern

```typescript
export interface SubagentSpawnPayload {
  taskName: string;
  assignedRole: "RESEARCH" | "CODE_EXEC" | "DB_INSPECTOR" | "DOC_SYNTHESIS";
  taskPrompt: string;
  expectedOutputSchema: Record<string, unknown>; // JSON Schema
  maxStepCount: number; // Default: 10
  timeoutMs: number;    // Default: 60,000
  w3cTraceparent: string; // Distributed trace lineage
}

// Example parent agent invocation
const result = await invokeSubagent({
  taskName: "Inspect Vendor Invoice Schema",
  assignedRole: "DB_INSPECTOR",
  taskPrompt: "Query the schema of vendor_invoices and return the column definitions as JSON.",
  expectedOutputSchema: {
    type: "object",
    properties: {
      columns: { type: "array", items: { type: "string" } },
      indexes: { type: "array", items: { type: "string" } }
    },
    required: ["columns"]
  },
  maxStepCount: 5,
  timeoutMs: 30000,
  w3cTraceparent: currentTraceparent
});
```

---

## 4. Parent Synthesis Protocol

1. **Schema Validation:** The parent must validate the child agent's returned JSON payload against `expectedOutputSchema` using Zod before consuming it.
2. **Failure Handling:** If a child fails or times out, the parent logs the error and decides whether to retry once or proceed with a graceful partial degradation.
3. **No Intermediate Log Bloat:** The parent must only incorporate the child's final validated payload into its working memory, discarding the child's raw step-by-step scratchpad.
