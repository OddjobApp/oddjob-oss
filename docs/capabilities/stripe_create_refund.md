# 💰 Create Stripe Refund

> **ID**: `stripe_create_refund`
> **Version**: `1.0.0`
> **Manifest Schema Version**: `1`
> **Category**: `Stripe`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

---

### Inputs

| Name              | Type     |
| :---------------- | :------- |
| `payment_intent_id` | `string` |
| `amount`          | `number` |
| `reason`          | `enum`   |

---

### Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

### Guardrails

> [!NOTE] No explicit guardrails declared.

---

### Business Use Cases
