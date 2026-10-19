# 🛠️ List YouTube playlist videos

> **Capability ID:** `youtube_list_playlist_videos`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

List videos in a playlist, including a channel uploads playlist. Reports pagination. Does not watch videos.

---

## Inputs

| Name | Type |
| --- | --- |
| `playlist_id` | `string` |
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
