# 🛠️ Approve & Launch Cycle

> **Capability ID:** `approve_cycle`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** High  
> **Execution Environment:** Host

---

## Overview

Approve a staged (pending_approval) operational cycle and launch its mission fleet — the same as clicking 'Approve & Launch' on the cycle page. Requires org-admin or super-admin. Resolve the cycle id first with list_pending_cycles if the user gave a name.

---

## Inputs

| Name | Type |
| --- | --- |
| `cycleId` | `number` |

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

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`
