# 🧩 Check a Seedance Take

> **Capability ID:** `seedance_check_status`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Video Content  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Check on a Media Studio take by its takeId: whether it is waiting for approval, rendering, ready for review (with its video), failed, or a simulation.

Check on a Media Studio take by its takeId: whether it is waiting for approval, rendering, ready for review (with its video), failed, or a simulation.

---

## Inputs

| Name | Type |
| --- | --- |
| `takeId` | `number` |

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
  - removed `inputs.generationId`: `string` → `—`
  - added `inputs.takeId`: `—` → `number`
