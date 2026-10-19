# 🛠️ Read YouTube comments

> **Capability ID:** `youtube_list_comments`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read top-level comment threads on a video. Reply counts are supplied; the embedded replies may be incomplete. Reports pagination.

---

## Inputs

| Name | Type |
| --- | --- |
| `video_id` | `string` |
| `max_results` | `number` |
| `page_token` | `string` |

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
