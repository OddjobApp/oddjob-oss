# 🛠️ Ratify Durable Decision

> **Capability ID:** `ratify_decision`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Formally proposes or ratifies a strategic or architectural decision in the room with evaluated alternatives, rationale, and confidence score.

---

## Inputs

| Name | Type |
| --- | --- |
| `statement` | `string` |
| `rationale` | `string` |
| `alternatives` | `array` |
| `confidence` | `number` |
| `evidenceTurnIds` | `array` |

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
