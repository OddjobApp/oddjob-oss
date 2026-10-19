# 👤 Request Profile Access

> **ID:** `request_user_profile_access`
> **Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---
## Description

Ask the user for permission to read their interaction profile (what they have been told, what they believe, their working style) for this session. Raises an approval request the user sees as a notification. Use this ONCE per session, only when the profile would materially improve your help — not routinely.

---
## Inputs

| Name     | Type     |
| :------- | :------- |
| `reason` | `string` |

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
