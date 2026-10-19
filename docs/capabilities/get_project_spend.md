# 🛠️ Get Project Spend

> **Capability ID:** `get_project_spend`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Retrieves current spend, budget cap and remaining USD. Scoped to a Project Space when one is given or active in context; otherwise falls back to organization-wide spend for the current billing month. The result carries a `scope` field saying which you got.

---

## Inputs

| Name | Type |
| --- | --- |
| `projectKey` | `string` |

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
