# 🛠️ Record Action Commitment

> **Capability ID:** `record_commitment`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Locks in an explicit action commitment or responsibility for an agent or participant with target deadline and expected deliverables.

---

## Inputs

| Name | Type |
| --- | --- |
| `title` | `string` |
| `detail` | `string` |
| `ownerType` | `enum` |
| `ownerId` | `string` |
| `dueAt` | `string` |

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
