# 🧩 Find Microsoft documents

> **Capability ID:** `m365_list_documents`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Microsoft 365  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Find OneDrive or SharePoint drive files. Omit drive_id for personal OneDrive. Results include drive identifiers needed to read selected documents.

---

## Inputs

| Name | Type |
| --- | --- |
| `drive_id` | `string` |
| `query` | `string` |
| `folder_id` | `string` |
| `skip_token` | `string` |
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
