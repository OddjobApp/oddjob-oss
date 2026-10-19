# 🛠️ agent_update_card

> **Capability ID:** `agent_update_card`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Update an agent card; organization management permission is checked from the caller identity.

---

## Inputs

| Name | Type |
| --- | --- |
| `name` | `string` |
| `description` | `string` |
| `personaType` | `string` |
| `capabilities` | `array` |
| `tools` | `array` |
| `enabled` | `boolean` |
| `agentId` | `number` |

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
