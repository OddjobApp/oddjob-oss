# 🧩 gmail_untrash_message

> **Capability ID:** `gmail_untrash_message`  
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
| `message_id` | `any` |

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
