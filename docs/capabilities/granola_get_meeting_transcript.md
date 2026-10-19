# 🛠️ Read Granola transcript

> **Capability ID:** `granola_get_meeting_transcript`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read the raw speaker-attributed transcript for one Granola meeting. Use only when exact wording is needed; prefer summarized meeting notes otherwise. Not available in a CREW room: sharing a meeting shares its notes, not its transcript.

---

## Inputs

| Name | Type |
| --- | --- |
| `meeting_id` | `string` |

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
