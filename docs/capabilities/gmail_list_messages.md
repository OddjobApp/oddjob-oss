# 🧩 gmail_list_messages

> **Capability ID:** `gmail_list_messages`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Google Workspace  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Search or list Gmail messages with query syntax and pagination. Each result carries id, subject, sender, date and snippet (metadata is fetched for up to 10 hits, the rest return IDs only); use gmail_get_message to read full content.

---

## Inputs

| Name | Type |
| --- | --- |
| `query` | `string` |
| `page_token` | `string` |
| `max_results` | `number` |

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
