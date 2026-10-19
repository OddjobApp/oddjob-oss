# ➕ Add Pipeline Step
> **ID:** `add_pipeline_step`
> **Version:** `1.0.0`
> **Schema:** `1`
> **Category:** `Pipeline Orchestration`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Add a step to an existing pipeline. Step can be a job, decision node, or iterator. Requires admin permissions.

---

## Inputs

| Name                  | Type     |
| :-------------------- | :------- |
| `pipelineId`          | `number` |
| `jobId`               | `number` |
| `moduleType`          | `enum`   |
| `order`               | `number` |
| `outputName`          | `string` |
| `runOnCondition`      | `string` |
| `onFailureAction`     | `enum`   |
| `waitDurationSeconds` | `number` |
| `decisionNodeConfig`  | `object` |
| `iteratorConfig`      | `object` |

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

No business use cases are currently defined.
