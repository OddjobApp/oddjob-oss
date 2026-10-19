# 🛠️ Update Scribe Station Content

> **Capability ID:** `scribe_update_node`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Updates the text content of a specific station or clause in the active Scribe Studio document. Can replace full content or surgically replace targetExcerpt with replacementExcerpt.

Updates the text content of a specific station or clause in the active Scribe Studio document. Can replace full content or surgically replace targetExcerpt with replacementExcerpt.

---

## Inputs

| Name | Type |
| --- | --- |
| `nodeId` | `number` |
| `content` | `string` |
| `targetExcerpt` | `string` |
| `replacementExcerpt` | `string` |
| `status` | `enum` |

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
