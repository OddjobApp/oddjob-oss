# 🧩 Send Outbound Email

> **Capability ID:** `send_email`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Integrations  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Send an outbound email via AgentMail. Specify recipient (to), subject, and body/text.

---

## Inputs

| Name | Type |
| --- | --- |
| `to` | `any` |
| `subject` | `string` |
| `body` | `string` |
| `message` | `string` |
| `text` | `string` |
| `html` | `string` |
| `cc` | `any` |
| `bcc` | `any` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!NOTE]
> No explicit guardrails declared.
