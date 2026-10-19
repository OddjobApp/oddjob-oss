# 🛠️ Request Governance Action Approval

> **Capability ID:** `request_governance_approval`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Shows a high-stakes action to the room for human review, with its blast radius. A sign-off is posted to the room as a message; it is not recorded as an approval and nothing executes the action.

---

## Inputs

| Name | Type |
| --- | --- |
| `actionKey` | `string` |
| `actionTitle` | `string` |
| `riskTier` | `enum` |
| `requestedBy` | `string` |
| `blastRadius` | `object` |
| `executionPayload` | `object` |
| `requiresDualSignOff` | `boolean` |

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

- **[Auto-Changelog 2026-10-10]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Mounts or appends a high-stakes action into the Governance Checkpoint Rail for human review, blast radius analysis, and 1-click execution sign-off.` → `Shows a high-stakes action to the room for human review, with its blast radius. A sign-off is posted to the room as a message; it is not recorded as an approval and nothing executes the action.`
  - modified `documentation_meta.summary`: `Mounts or appends a high-stakes action into the Governance Checkpoint Rail for human review, blast radius analysis, and 1-click execution sign-off.` → `Shows a high-stakes action to the room for human review, with its blast radius. A sign-off is posted to the room as a message; it is not recorded as an approval and nothing executes the action.`
