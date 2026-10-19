# ⚡ Durable Missions

> **Capability ID:** `durable_missions`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Custom JIT  
> **Owner:** Mission Platform  
> **Risk Profile:** High  
> **Execution Environment:** Host

---

## Overview

Turn operational objectives into durable, governed work that can plan, delegate, pause, resume, retry, and report progress.

Creates a durable mission record and coordinates its governed execution through completion, suspension, or failure.

---

## Inputs

| Name | Type |
| --- | --- |
| `objective` | `string` |
| `constraints` | `string[]` |
| `context` | `object` |
| `approval_policy` | `string \| null` |

## Outputs

| Name | Type |
| --- | --- |
| `mission_id` | `integer` |
| `status` | `string` |
| `plan` | `object` |
| `result` | `object \| null` |

---

## Business Use Cases

- Run long-lived operational work that spans multiple agents and tools.
- Pause work for human input and resume from persisted state.
- Recover and retry failed mission steps without losing execution history.

---

## Security Guardrails

> [!WARNING]
> Actions inherit organization policy, budget, credential, and approval constraints.

> [!WARNING]
> High-impact steps must pause when the applicable approval policy requires human review.

> [!WARNING]
> Mission state and execution events must remain organization-scoped and auditable.

---

## Dependencies

- `mission`
- `agents`
- `governor`
- `knowledge`
- `jobs`
