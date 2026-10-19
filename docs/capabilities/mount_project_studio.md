# 🛠️ Mount Project Studio

> **Capability ID:** `mount_project_studio`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Mounts Project Studio in the side rail beside the CREW conversation. Pass cycleId to reopen a saved cycle's wave plan, or pass the plan (projectTitle, objective, waves) to open it for editing. With neither, the studio opens empty — it never shows example data.

Mounts Project Studio in the side rail beside the CREW conversation. Pass cycleId to reopen a saved cycle's wave plan, or pass the plan (projectTitle, objective, waves) to open it for editing. With neither, the studio opens empty — it never shows example data.

---

## Inputs

| Name | Type |
| --- | --- |
| `cycleId` | `number` |
| `cycleName` | `string` |
| `title` | `string` |
| `projectTitle` | `string` |
| `objective` | `string` |
| `waves` | `array` |
| `budgetLimitUsd` | `number` |
| `tokenLimit` | `number` |
| `targetSlaDays` | `number` |
| `maxParallelMissions` | `number` |

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
