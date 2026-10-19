# 🧩 gdocs_read_text

> **Capability ID:** `gdocs_read_text`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Google Workspace  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read Google Docs exported text through Drive, even when the native Docs API is disabled. Reports truncation and next_offset; continue until next_offset is null. This text export does not supply editing revision IDs.

---

## Inputs

| Name | Type |
| --- | --- |
| `document_id` | `any` |
| `offset` | `number` |
| `max_characters` | `number` |

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
