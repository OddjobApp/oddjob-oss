# 🔄 Update Job

> **ID:** `update_job`
> **Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** System Management
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

Update an existing job. Requires admin permissions.

---

## Inputs

| Name | Type |
|---|---|
| jobId | number |
| name | string |
| description | string |
| config | object |
| isActive | boolean |
| outputDatasetId | number |

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

No explicit business use cases declared.
