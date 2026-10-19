# 🛠️ List YouTube playlists

> **Capability ID:** `youtube_list_playlists`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

List playlists for channel_id, or the connected user when omitted. Reports pagination.

---

## Inputs

| Name | Type |
| --- | --- |
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
