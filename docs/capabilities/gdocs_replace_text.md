# 🧩 gdocs_replace_text

> **Capability ID:** `gdocs_replace_text`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Google Workspace  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Propose a Google Docs change for approval. For editing, read the document first, preserve its tabs and formatting, and supply required_revision_id. requests supports native Docs batchUpdate operations for text, formatting, tables, lists, images and headers.

---

## Inputs

| Name | Type |
| --- | --- |
| `document_id` | `any` |
| `required_revision_id` | `any` |
| `find` | `string` |
| `replace` | `string` |
| `match_case` | `boolean` |
| `tab_ids` | `array` |

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
