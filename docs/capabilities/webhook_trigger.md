# 🌐 Trigger Webhook
> **ID**: webhook_trigger
> **Version**: 1.0.0
> **Manifest Schema Version**: 1
> **Category**: Webhooks
> **Owner**: platform
> **Risk Profile**: Low
> **Execution Environment**: Host

Send an HTTP POST webhook to an external URL with a JSON payload. Supports retries and custom headers. Use this for event-driven integrations with external systems.

---

## Inputs

| Name | Type |
|---|---|
| url | string |
| payload | object |
| headers | object |
| retries | number |
| timeout_ms | number |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Business Use Cases
> [!NOTE] No explicit business use cases declared.

---

## Guardrails
> [!NOTE] No explicit guardrails declared.
