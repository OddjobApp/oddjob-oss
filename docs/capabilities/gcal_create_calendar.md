# 🧩 gcal create calendar

> **Capability ID:** `gcal_create_calendar`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Google Workspace  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Propose a Google Calendar change for human approval. Never claims execution before approval. Read existing events first for their ID and etag. Recurring master changes affect the series; instance IDs affect one occurrence. End dates for all-day events are exclusive.

---

## Inputs

| Name | Type |
| --- | --- |
| `summary` | `string` |
| `description` | `string` |
| `timeZone` | `string` |

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
