# 🧩 List Google Calendar Events

> **Capability ID:** `gcal_list_events`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Google Workspace  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read Google Calendar events. Prefer time_range today/this_week/next_week resolved in the calendar time zone; this_week starts Monday. Or provide an explicit time range. Use RFC3339 timestamps with timezone offsets. Reports pagination; does not create or change events.

---

## Inputs

| Name | Type |
| --- | --- |
| `calendar_id` | `string` |
| `time_min` | `string` |
| `time_max` | `string` |
| `time_range` | `enum` |
| `query` | `string` |
| `max_results` | `number` |
| `page_token` | `string` |

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
