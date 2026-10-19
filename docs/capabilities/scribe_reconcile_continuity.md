# 🛠️ Reconcile Document Continuity

> **Capability ID:** `scribe_reconcile_continuity`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Runs forward-propagation causality analysis across downstream stations to detect contradictions caused by upstream branch edits.

---

## Inputs

| Name | Type |
| --- | --- |
| `documentId` | `number` |
| `sourceSortOrder` | `number` |
| `sourceContent` | `string` |
| `sourceStationKey` | `string` |
| `branchId` | `number` |

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
