# 🛠️ Mount Flow Studio

> **Capability ID:** `mount_flow_studio`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Mounts Flow Studio in the side-rail beside the CREW conversation, allowing visual inspection and topological simulation of flows and pipelines. Pass 'flowName' or 'flowId' to inspect an existing flow, or call with no arguments to open on the current draft.

---

## Inputs

| Name | Type |
| --- | --- |
| `flowName` | `string` |
| `flowId` | `number` |

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
