# 🛠️ Search YouTube

> **Capability ID:** `youtube_search`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Search live YouTube videos. Returns metadata, not a transcript or evidence of watching. Prefer playlist reads for a known channel to conserve search quota.

---

## Inputs

| Name | Type |
| --- | --- |
| `query` | `string` |
| `channel_id` | `string` |
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
