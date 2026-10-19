# 🔄 Update Pipeline Step

> **ID:** update_pipeline_step
> **Version:** 1.0.0
> **Schema Version:** 1
> **Category:** Pipeline Orchestration
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Inputs

| Name | Type |
|---|---|
| stepId | number |
| jobId | number |
| order | number |
| outputName | string |
| runOnCondition | string |
| onFailureAction | enum |
| waitDurationSeconds | number |
| decisionNodeConfig | object |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Business Use Cases

No business use cases declared.
