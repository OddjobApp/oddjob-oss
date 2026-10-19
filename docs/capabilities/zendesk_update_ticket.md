# 🎫 Update Zendesk Ticket
> **Capability ID:** `zendesk_update_ticket`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Zendesk`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Inputs

| Name | Type |
| :------------- | :------ |
| `ticket_id` | `number` |
| `status` | `enum` |
| `priority` | `enum` |
| `comment` | `string` |
| `public_comment` | `boolean` |

---

## Outputs

| Name | Type |
| :----- | :----- |
| `result` | `string` |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

* No explicit business use cases declared.
