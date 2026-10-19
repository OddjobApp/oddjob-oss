# 🧩 Get X-Ray Spec

> **Capability ID:** `get_xray_spec`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Documentation  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read the full architecture spec written for a specific X-Ray node — the authoritative documentation for how an app, scope or screen is built. This is an EXACT lookup by node id or name, not a similarity search: it returns that node's spec or tells you plainly that none exists. Prefer it over search_unified_knowledge when you already know which component you are asking about.

---

## Inputs

| Name | Type |
| --- | --- |
| `node` | `string` |
| `offset` | `number` |

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
