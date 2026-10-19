# 🔔 List Alerts

> **ID:** `list_alerts`
> **Version:** `1.0.0`
> **Schema Version:** `1`
> **Category:** Observability
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

List active alerts in the system, optionally filtered by severity.

---

## Inputs

| Name                | Type      |
| :------------------ | :-------- |
| `severity`          | `enum`    |
| `includeAcknowledged` | `boolean` |
| `limit`             | `number`  |

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

* No specific business use cases declared.
