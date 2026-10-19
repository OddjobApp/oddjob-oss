# 🛠️ Resume Autonomous Mission

> **Capability ID:** `resume_autonomous_mission`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Resumes a paused, crashed, or budget-paused mission from its latest verified checkpoint.

Resumes a paused, crashed, or budget-paused mission from its latest verified checkpoint.

---

## Inputs

| Name | Type |
| --- | --- |
| `missionId` | `string` |
| `sessionId` | `string` |
| `manifest` | `any` |
| `additionalTokenBudget` | `number` |

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
