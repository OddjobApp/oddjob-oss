# 🛠️ gcal_free_busy

> **Capability ID:** `gcal_free_busy`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Check availability across Google calendars. Calendar-specific errors are not availability.

---

## Inputs

| Name | Type |
| --- | --- |
| `calendar_ids` | `array` |
| `time_min` | `string` |
| `time_max` | `string` |
| `time_zone` | `string` |

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
