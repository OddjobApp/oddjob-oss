# ✉️ Send SMS

> **Capability ID:** `sms_send`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Twilio / SMS`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Send an SMS text message via Twilio. Requires a Twilio credential with account SID, auth token, and from number.

---

## Inputs

| Name    | Type     |
| :------ | :------- |
| `to`    | `string` |
| `message` | `string` |
| `from`  | `string` |

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
