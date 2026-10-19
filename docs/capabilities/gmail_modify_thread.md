# 🧩 gmail_modify_thread

> **Capability ID:** `gmail_modify_thread`  
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
| `thread_id` | `any` |
| `add_label_ids` | `array` |
| `remove_label_ids` | `array` |

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
