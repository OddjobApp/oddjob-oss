# 🧩 gmail_get_attachment

> **Capability ID:** `gmail_get_attachment`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Google Workspace  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Fetch a Gmail attachment by message and attachment IDs. Returns base64url bytes and size; binary bytes are not extracted text.

---

## Inputs

| Name | Type |
| --- | --- |
| `message_id` | `any` |
| `attachment_id` | `any` |

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
