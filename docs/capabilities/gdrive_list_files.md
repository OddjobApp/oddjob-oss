# 🧩 List Google Drive Files

> **Capability ID:** `gdrive_list_files`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Google Workspace  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

List files in Google Drive, optionally filtered by name or folder. Sort with order_by (e.g. 'modifiedTime desc' for most recent first) — never put ordering inside query; Drive rejects it.

---

## Inputs

| Name | Type |
| --- | --- |
| `query` | `string` |
| `order_by` | `string` |
| `folder_id` | `string` |
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

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-10-08]** (source: code) — 2 field change(s):
  - added `inputs.order_by`: `—` → `string`
  - added `inputs.page_token`: `—` → `string`
