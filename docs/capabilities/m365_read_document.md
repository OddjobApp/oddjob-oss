# 🧩 Read Microsoft document

> **Capability ID:** `m365_read_document`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Microsoft 365  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read Word DOCX or text documents from OneDrive/SharePoint in character pages. Reuses one download per turn. Continue with next_offset until null; report partial reads. Does not edit documents.

---

## Inputs

| Name | Type |
| --- | --- |
| `document_id` | `string` |
| `drive_id` | `string` |
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
