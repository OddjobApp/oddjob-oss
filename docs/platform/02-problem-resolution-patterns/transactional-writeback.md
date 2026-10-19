---
id: transactional-writeback
title: Distributed Saga Orchestration, Compensating Actions & Idempotent Writeback
audience: [HUMAN_PRIMARY, AGENT_PRIMARY, HYBRID]
badge: AGENT_PRIMARY
category: 02-problem-resolution-patterns
autonomy_level: L2-L4
version: 2.0.0
tags: [saga, transactions, writeback, idempotency, rollback, compensation, distributed-systems]
summary: Distributed Saga pattern for multi-step agent mutations across external APIs and databases, ensuring deterministic compensation and atomic writeback.
verification_status: verified
applies_when:
  - Agent executes multi-step workflows modifying multiple disparate databases or external SaaS APIs
  - Ensuring ACID-like consistency across non-transactional distributed microservices
  - Handling mid-pipeline failures with automatic backward compensating rollbacks
do_not_use_when:
  - Performing single-table local SQL mutations that can be wrapped in a native `BEGIN ... COMMIT` block
required_tools:
  - apply_recovery_decision
  - code_rollback
preconditions:
  - Every forward mutation step has a corresponding inverse compensating tool definition
  - Idempotency key generated and attached to all write payloads
approval_requirements:
  - Saga executions affecting financial balances $> \$500$ require HIL authorization before final commit
success_checks:
  - Forward steps commit in strict sequential order
  - Any failed step triggers reverse execution of compensating actions without leaving orphan state
stop_conditions:
  - Compensating action itself fails (triggers critical SRE intervention alarm)
escalation:
  - Alert Operations on dual-failure state to execute manual ledger reconciliation
implementation_evidence:
  - server/domain/pipeline/
  - server/domain/transference/
---

# Distributed Saga Orchestration & Idempotent Writeback `[🤖 AGENT]`

> **Audience:** `🤖 Agent Executable & Distributed Systems Architect` &nbsp;|&nbsp; **Classification:** Architectural Pattern & Writeback Reliability

---

## 1. The Distributed Saga Pattern `[🧑 Human]`

When an agent coordinates a complex multi-system mutation (e.g. Charge Customer in Stripe $\rightarrow$ Create Order in Postgres $\rightarrow$ Post Confirmation in Slack), traditional two-phase commit is impossible across external HTTP APIs. Oddjob implements the **Saga Pattern**:

```mermaid
sequenceDiagram
    autonumber
    participant Agent as Saga Orchestrator Agent
    participant Stripe as 1. Stripe API
    participant DB as 2. Internal Postgres DB
    participant Slack as 3. Slack Webhook

    Agent->>Stripe: Forward Action 1: Create Charge ($100, IdempotencyKey=xyz)
    Stripe-->>Agent: Charge Created Successfully (charge_id=ch_99)
    Agent->>DB: Forward Action 2: Insert Order Row (charge_id=ch_99)
    DB-->>Agent: Database Error (e.g. Disk Full / Constraint Violation)
    Note over Agent: Step 2 Failed! Initiating Reverse Compensating Actions
    Agent->>Stripe: Compensating Action 1: Refund Charge (charge_id=ch_99)
    Stripe-->>Agent: Refund Confirmed
    Note over Agent,Slack: Distributed state cleanly reverted to stable baseline
```

---

## 2. Mandatory Idempotency Key Standard `[🤖 Agent Reference]`

To prevent duplicate charges or double records when network timeouts occur, every mutating tool call MUST generate and pass a deterministic idempotency key:

$$\text{IdempotencyKey} = \text{SHA256}(\text{TenantId} + \text{MissionId} + \text{StepIndex} + \text{AttemptNumber})$$

### Rules:
1. If a tool call times out (HTTP 504), the agent may safely retry using the **identical idempotency key**.
2. Upstream endpoints returning cached responses with the same key must be treated as successful executions.

---

## 3. Saga Forward and Compensating Definition Matrix `[🤖 Agent Reference]`

Every step registered in a multi-action agent mission must declare its inverse companion:

| Forward Action Step | Tool Invocation | Corresponding Compensating Tool | Inverse Operation |
| :--- | :--- | :--- | :--- |
| **1. Reserve Inventory** | `inventory_reserve_sku` | `inventory_release_sku` | Decrements reservation counter |
| **2. Charge Payment** | `stripe_create_charge` | `stripe_create_refund` | Full refund citing failed order |
| **3. Insert Database Row** | `db_insert_record` | `db_delete_record` / Soft Delete | Mark row status as `CANCELLED_ROLLBACK` |
| **4. Provision Cloud VM** | `aws_deploy` | `code_rollback` / `aws_terminate` | Tear down provisioned instance |

---

## 4. Saga Execution Schema Contract `[🤖 Agent Reference]`

```typescript
export interface SagaStep {
  stepId: string;
  forwardAction: {
    tool: string;
    params: Record<string, any>;
  };
  compensatingAction: {
    tool: string;
    params: (forwardResult: any) => Record<string, any>;
  };
}

export interface SagaExecutionLog {
  sagaId: string;
  completedSteps: Array<{ stepId: string; result: any }>;
  status: "IN_PROGRESS" | "COMMITTED" | "COMPENSATING" | "FAILED_COMPENSATION";
}
```
