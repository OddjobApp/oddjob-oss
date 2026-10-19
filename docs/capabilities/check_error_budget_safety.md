# 🛡️ check_error_budget_safety

> **Capability ID:** `check_error_budget_safety`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Validates that remaining service error budgets and availability SLOs permit running a chaos experiment safely.

---

## Inputs

| Name                     | Type     |
| :----------------------- | :------- |
| `serviceName`            | `string` |
| `minRequiredBudgetPercent` | `number` |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

> [!NOTE] No explicit business use cases declared.
