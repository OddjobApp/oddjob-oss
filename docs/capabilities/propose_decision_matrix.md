# 🛠️ Propose Multi-Criteria Decision Matrix

> **Capability ID:** `propose_decision_matrix`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Mounts or updates an interactive Decision Matrix Rail in the CREW room with candidate options, weighted criteria, scoring breakdown, and persona stances.

---

## Inputs

| Name | Type |
| --- | --- |
| `topic` | `string` |
| `candidates` | `array` |
| `criteria` | `array` |
| `personaStances` | `array` |
| `recommendedCandidateId` | `string` |
| `consensusPercentage` | `number` |

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
