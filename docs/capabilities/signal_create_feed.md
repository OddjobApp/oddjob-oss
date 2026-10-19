# 🛠️ signal_create_feed

> **Capability ID:** `signal_create_feed`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Create a validated signal feed. Disabled by default; credentials are managed separately.

---

## Inputs

| Name | Type |
| --- | --- |
| `name` | `string` |
| `sourceType` | `any` |
| `url` | `string` |
| `pollingIntervalSeconds` | `number` |
| `enabled` | `boolean` |

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
