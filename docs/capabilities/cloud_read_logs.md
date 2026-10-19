# ☁️ Read Cloud Logs
> **Capability ID:** `cloud_read_logs`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Cloud`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Inputs

| Name          | Type     |
| :------------ | :------- |
| `provider`    | `enum`   |
| `logGroupName`| `string` |
| `filterPattern`| `string` |
| `startTime`   | `string` |
| `endTime`     | `string` |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Business Use Cases

No specific business use cases declared.
