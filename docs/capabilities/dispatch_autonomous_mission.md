# 🛠️ Dispatch Autonomous Mission

> **Capability ID:** `dispatch_autonomous_mission`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Dispatches a multi-step TaskManifest DAG to the background worker mesh with checkpoint recovery and budget governance.

Dispatches a multi-step TaskManifest DAG to the background worker mesh with checkpoint recovery and budget governance.

---

## Inputs

| Name | Type |
| --- | --- |
| `manifest` | `any` |
| `tokenBudget` | `number` |
| `missionId` | `string` |

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
