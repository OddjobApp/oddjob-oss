# 🛠️ Reset Scribe Studio Document

> **Capability ID:** `scribe_reset_studio`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Resets the active Scribe Studio document when the subject or topic changes, clearing previous stations, annotations, and text.

Resets the active Scribe Studio document when the subject or topic changes, clearing previous stations, annotations, and text.

---

## Inputs

| Name | Type |
| --- | --- |
| `documentId` | `number` |
| `newTitle` | `string` |
| `archetypeMode` | `enum` |
| `targetWordCount` | `number` |

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
