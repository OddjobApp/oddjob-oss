# 🗑️ Delete Pipeline Step
> **Capability ID:** delete_pipeline_step
> **Capability Version:** 1.0.0
> **Manifest Schema Version:** 1
> **Category:** Pipeline Orchestration
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

Remove a step from a pipeline. Requires admin permissions. IMPORTANT: You MUST ask user to confirm before executing this delete.

---

## Inputs

| Name | Type |
|---|---|
| stepId | number |
| userConfirmed | boolean |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE] No explicit business use cases declared.
