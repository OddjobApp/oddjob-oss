# 🔄 Update Scheduled Job
> **Capability ID:** `update_scheduled_job`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Pipeline Orchestration`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Inputs

| Name              | Type      |
| :---------------- | :-------- |
| `scheduledJobId`  | `number`  |
| `name`            | `string`  |
| `scheduleId`      | `number`  |
| `triggerType`     | `enum`    |
| `priority`        | `number`  |
| `isActive`        | `boolean` |
| `alertOnFailure`  | `boolean` |
| `maxRetries`      | `number`  |
| `parameterValues` | `object`  |

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
