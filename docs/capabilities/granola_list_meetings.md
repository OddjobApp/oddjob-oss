# 🛠️ List Granola meetings

> **Capability ID:** `granola_list_meetings`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

List meetings the current user can access in their active Granola workspace, optionally filtered by folder or date range. In a CREW room the list is shown privately to that user, who chooses which meetings to share.

---

## Inputs

| Name | Type |
| --- | --- |
| `folder_id` | `string` |
| `start_date` | `string` |
| `end_date` | `string` |
| `limit` | `number` |

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
