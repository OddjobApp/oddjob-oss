# 🗑️ Delete Schedule
> **Capability ID:** delete_schedule
> **Capability Version:** 1.0.0
> **Manifest Schema Version:** 1
> **Category:** Pipeline Orchestration
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

## Description
Delete a schedule. Requires admin. IMPORTANT: You MUST ask user to confirm before executing this delete.

---

## Inputs

| Name          | Type    |
|---------------|---------|
| scheduleId    | number  |
| userConfirmed | boolean |

---

## Outputs

| Name   | Type   |
|--------|--------|
| result | string |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
No business use cases defined.
