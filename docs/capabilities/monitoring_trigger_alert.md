# 🚨 Trigger PagerDuty Alert
> **ID**: `monitoring_trigger_alert`
> **Version**: `1.0.0`
> **Schema Version**: `1`
> **Category**: `Monitoring`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

Trigger a new alert/event in PagerDuty via an integration routing key.

---

## Inputs

| Name       | Type   |
|------------|--------|
| routingKey | string |
| summary    | string |
| severity   | enum   |
| details    | string |

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
