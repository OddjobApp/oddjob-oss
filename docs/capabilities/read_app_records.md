# 🧩 Read App Records

> **Capability ID:** `read_app_records`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** App Forge  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read the records an installed app has stored for this organization (e.g. BudgetMaster transactions, QA Workbench defects, Rescue Dispatch active rescues). Call with only `app` to list the app's collections and record counts; then call again with a `collection` to read its rows, optionally filtered on one field. For totals, averages or counts use `aggregate` instead of reading every row. Get the app slug from list_installed_apps. The `summary` states exactly how many records were returned and the offset for the next page — quote it, and never present a partial page as the whole collection.

---

## Inputs

| Name | Type |
| --- | --- |
| `app` | `string` |
| `collection` | `string` |
| `recordId` | `string` |
| `filterField` | `string` |
| `filterValue` | `string` |
| `fields` | `array` |
| `limit` | `number` |
| `offset` | `number` |
| `aggregate` | `object` |

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
