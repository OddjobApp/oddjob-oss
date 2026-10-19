# 🧩 gmail_update_draft

> **Capability ID:** `gmail_update_draft`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Google Workspace  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Propose a Gmail change for approval. Use message/thread/draft IDs from live Gmail reads. Modify labels to archive (remove INBOX), mark read (remove UNREAD), star (add STARRED), or apply labels. Reply requires actual thread ID and Message-ID header. Never claim a send until approval succeeds.

---

## Inputs

| Name | Type |
| --- | --- |
| `draft_id` | `any` |
| `to` | `array` |
| `cc` | `array` |
| `bcc` | `array` |
| `subject` | `any` |
| `body` | `string` |
| `body_format` | `enum` |
| `attachments` | `array` |
| `thread_id` | `any` |
| `in_reply_to` | `any` |

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

- **[Auto-Changelog 2026-10-08]** (source: code) — 1 field change(s):
  - added `inputs.body_format`: `—` → `enum`
