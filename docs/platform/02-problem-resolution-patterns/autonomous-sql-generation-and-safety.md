---
id: autonomous-sql-generation-and-safety
title: "Autonomous SQL Generation, Query Cost Limits & Transaction Safety"
audience: ["AGENT_PRIMARY", "GOVERNANCE", "HUMAN_PRIMARY"]
badge: "AGENT_PRIMARY"
category: "02-problem-resolution-patterns"
autonomy_level: "L2-L4"
version: "1.0.0"
tags: ["sql", "database", "query-safety", "explain-cost", "transactions", "read-replica", "limits"]
summary: "Standards and guardrails for autonomous agents generating and executing SQL queries, enforcing pre-execution cost analysis, mandatory LIMITs, and parameterized transactions."
applies_when: "An authorized capability must inspect tenant-scoped relational data | A live database tool or service exposes a read-only, parameterized query contract"
do_not_use_when: "The request requires DDL or an unapproved write | Tenant identity is unavailable | Only a raw SQL string executor is available"
required_tools: "A tenant-scoped parameterized query tool | PostgreSQL AST parser | EXPLAIN cost evaluator | Read-replica connection"
preconditions: "Resolve organizationId from trusted runtime context | Inspect the live tool schema | Confirm the requested fields are permitted"
approval_requirements: "Follow the live capability risk profile; this pattern does not grant write authority"
success_checks: "Returned rows belong only to the resolved tenant | Applied row and time limits are reported | Query parameters remain separate from SQL text"
stop_conditions: "Tenant filter cannot be proven | Query cannot be parsed | Estimated cost exceeds 5000 | Execution would require string interpolation"
escalation: "Escalate writes, DDL, ambiguous tenant scope, and repeated timeout or cost failures"
implementation_evidence: "Conceptual pattern only; bind to a verified Oddjob query capability before execution"
verification_status: "guidance"
---

# Autonomous SQL Generation & Database Safety

> **Audience:** 🤖 Agent / Autonomous | 🛡️ Safety & Governance | 🧑 Human / Builder  
> **Autonomy Level:** L2 to L4  
> **Telemetry Span:** `database.query.execute`

---

## 1. Safety Guardrails & Validation Lifecycle

When an autonomous agent generates SQL queries to fulfill analytical or operational tasks, it must pass the query through a three-stage safety verification pipeline before execution:

```mermaid
graph TD
    RawSQL[LLM Generated SQL Query] --> Parser[Static SQL Ast Parser]
    
    Parser --> Check1{Prohibited Commands?<br/>DROP / TRUNCATE / ALTER}
    Check1 -- Yes --> Block[Reject Query with Security Violation]
    Check1 -- No --> Check2{Mandatory LIMIT Clause Present?}
    
    Check2 -- No --> InjectLimit[Inject LIMIT 100 Automatically]
    Check2 -- Yes --> ExplainCost[Execute EXPLAIN Cost Estimation]
    InjectLimit --> ExplainCost
    
    ExplainCost --> CostCheck{Estimated Cost <= 5,000 units?}
    CostCheck -- Exceeds Budget --> Optimize[Prompt Agent to Add Index / Restrict WHERE]
    CostCheck -- Safe --> Route[Route to Read Replica / Transaction Engine]
    
    Route --> Execute[Execute with 5000ms Statement Timeout]
```

---

## 2. Mandatory SQL Invariants

Every agent-generated SQL query must satisfy the following rules:

| Rule | Enforcement | Rejection Error Code |
| :--- | :--- | :--- |
| **Mandatory LIMIT** | Queries without `LIMIT` are capped at `LIMIT 100` | `SQL_MISSING_LIMIT_INJECTED` |
| **No DDL Mutations** | `DROP`, `TRUNCATE`, `ALTER`, `GRANT` forbidden | `SQL_DDL_FORBIDDEN` |
| **Tenant Isolation** | AST must prove a tenant predicate bound to the trusted runtime organization id | `SQL_MISSING_ORG_FILTER` |
| **Timeout Ceiling** | `SET statement_timeout = 5000;` (5 seconds max) | `SQL_STATEMENT_TIMEOUT` |
| **Read-Only Routing** | `SELECT` queries must target the read-replica pool | `SQL_REPLICA_ROUTED` |

---

## 3. Safe Query Execution Contract

```typescript
interface SafeQueryRequest {
  statement: ParsedSelectAst;       // parsed structure, never executable raw text
  parameters: readonly unknown[];  // values remain separate from SQL text
  organizationId: number;          // supplied by trusted runtime context
  rowLimit: number;                 // server clamps to <= 100
  statementTimeoutMs: number;       // server clamps to <= 5,000
}

// The trusted database service—not the agent—must:
// 1. reject non-SELECT AST nodes and prohibited functions;
// 2. inject or verify organization_id = a bound organizationId parameter;
// 3. compile placeholders and parameters separately;
// 4. run parameterized EXPLAIN and reject estimated cost > 5,000;
// 5. execute on a read-only transaction/read replica with timeout and row limit.
declare function executeTenantScopedRead(
  request: SafeQueryRequest
): Promise<{ rows: unknown[]; durationMs: number; appliedLimit: number }>;
```

> This is a service contract, not a copy-paste implementation. Agents must call a live tool that enforces it. Regex checks and `sql.raw(modelGeneratedText)` are not acceptable substitutes for AST validation and parameter binding.

---

## 4. Error Remediation Protocols

* **Missing Index Alert:** If `EXPLAIN` reports a `Seq Scan` on a table with $> 100,000$ rows, the agent must refine its query to leverage indexed primary or foreign keys.
* **Lock Wait Timeout:** If a write lock cannot be acquired within 2000ms, the transaction aborts to prevent deadlocks.
