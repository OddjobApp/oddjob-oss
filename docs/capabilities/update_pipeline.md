# 🔄 Update Pipeline
> **Capability ID:** `update_pipeline`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** Pipeline Orchestration
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

Update an existing pipeline. Requires admin permissions.

---

## Inputs

| Name        | Type    |
|-------------|---------|
| pipelineId  | number  |
| name        | string  |
| description | string  |
| isActive    | boolean |
| triggerType | enum    |

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

> [!NOTE] No explicit business use cases declared.
