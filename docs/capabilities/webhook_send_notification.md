# 🔔 Send Notification
> **Capability ID:** `webhook_send_notification`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Webhooks`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description
Send a notification to a configured webhook (Slack, Discord, Teams, PagerDuty, or any webhook URL). Provide the url and a message.

---

## Inputs
| Name    | Type     |
| :------ | :------- |
| `url`   | `string` |
| `message` | `string` |
| `title` | `string` |
| `level` | `enum`   |

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
