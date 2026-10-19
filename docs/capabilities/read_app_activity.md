# 🛠️ read_app_activity

> **Capability ID:** `read_app_activity`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read persisted app-scoped telemetry with timestamps and provenance. Use the canonical mounted app slug. These app-reported events are app-wide, not room-specific or proof of completed operations; this does not read the organization-wide forensic feed.

---

## Inputs

| Name | Type |
| --- | --- |
| `app` | `string` |
| `limit` | `number` |
| `beforeId` | `number` |

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
