# 🛠️ Compare financial snapshots

> **Capability ID:** `compare_financial_snapshots`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Compare two saved snapshots by ID or exact name. Currency-separated changes and scope warnings; zero-baseline percentages are unavailable. Optional explicit metricMappings support forecast-to-actual comparison only with identical nonempty reporting-period labels and currency; read snapshot metric keys first and never guess mappings.

---

## Inputs

| Name | Type |
| --- | --- |
| `baseline` | `string` |
| `current` | `string` |
| `metricMappings` | `array` |

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
