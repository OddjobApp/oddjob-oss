# 🧩 List X-Ray Specs

> **Capability ID:** `list_xray_specs`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Documentation  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

List the architecture specs documented for this organization's X-Ray nodes — the authoritative written documentation for apps, scopes and screens. Returns node ids and summaries, not full text. Call this first when you do not know which spec you need, then read one with get_xray_spec.

---

## Inputs

| Name | Type |
| --- | --- |
| `nodeType` | `string` |

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
