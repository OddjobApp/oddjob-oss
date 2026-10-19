# ☁️ Invoke Cloud Function
> **ID:** `cloud_invoke_function`
> **Version:** `1.0.0`
> **Schema Version:** `1`
> **Category:** Cloud
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

Invoke an AWS Lambda or GCP Cloud Function and return its response.

---

## Inputs

| Name         | Type     |
| :----------- | :------- |
| `provider`   | `enum`   |
| `functionName` | `string` |
| `payload`    | `object` |

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

No specific business use cases are currently defined.
