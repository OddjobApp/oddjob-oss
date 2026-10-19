# 🧩 Estimate Seedance Take Cost

> **Capability ID:** `seedance_estimate_cost`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Video Content  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Estimate what Seedance takes will cost at fal.ai's list price for Seedance 2.0. A take is charged only when it renders.

Estimate what Seedance takes will cost at fal.ai's list price for Seedance 2.0. A take is charged only when it renders.

---

## Inputs

| Name | Type |
| --- | --- |
| `shotCount` | `number` |
| `durationSeconds` | `number` |
| `resolution` | `enum` |

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

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-09-13]** (source: code) — 2 field change(s):
  - removed `inputs.resolutionTier`: `enum` → `—`
  - added `inputs.resolution`: `—` → `enum`
