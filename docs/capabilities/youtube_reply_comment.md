# 🛠️ Reply to YouTube comment

> **Capability ID:** `youtube_reply_comment`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Publish an approved reply to a specific YouTube parent comment. Requires write consent and human approval; do not call for a mere draft.

---

## Inputs

| Name | Type |
| --- | --- |
| `parent_comment_id` | `string` |
| `text` | `string` |

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
