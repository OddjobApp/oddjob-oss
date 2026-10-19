# 🛠️ Read YouTube channel

> **Capability ID:** `youtube_get_channel`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read a named channel, or the authenticated user’s channel when channel_id is omitted. Returns the channel profile and its latest uploads.

---

## Inputs

| Name | Type |
| --- | --- |
| `channel_id` | `string` |

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

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-10-08]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Read a named channel, or the authenticated user’s channel when channel_id is omitted. Includes uploads playlist ID for inexpensive video listing.` → `Read a named channel, or the authenticated user’s channel when channel_id is omitted. Returns the channel profile and its latest uploads.`
  - modified `documentation_meta.summary`: `Read a named channel, or the authenticated user’s channel when channel_id is omitted. Includes uploads playlist ID for inexpensive video listing.` → `Read a named channel, or the authenticated user’s channel when channel_id is omitted. Returns the channel profile and its latest uploads.`
