# 🛠️ Read YouTube transcript

> **Capability ID:** `youtube_get_transcript`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Extract a video’s spoken content as text from its published captions. Use this to review what a video says before discussing it. When no captions exist, set transcribe_audio to convert the audio with the organization’s AI key.

---

## Inputs

| Name | Type |
| --- | --- |
| `video_id` | `string` |
| `transcribe_audio` | `boolean` |
| `max_chars` | `number` |

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
