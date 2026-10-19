# 🛠️ Run Multi-Lens Critic Evaluation

> **Capability ID:** `scribe_run_critic_pass`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Evaluates the document against specialized persona lenses (Legal Sentinel, Stylistic Pal, Pacing Auditor, Devil's Advocate).

---

## Inputs

| Name | Type |
| --- | --- |
| `documentId` | `number` |
| `nodeId` | `number` |
| `lenses` | `array` |

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
