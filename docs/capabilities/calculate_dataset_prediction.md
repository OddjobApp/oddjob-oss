# 🛠️ Analyze forecast dataset with prediction engine

> **Capability ID:** `calculate_dataset_prediction`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Run existing Hidden State and Prediction Pods against an organization-scoped dataset. Returns predicate/model assessments, not a monetary forecast. Use with financial forecasting to inspect supported prediction evidence; never infer confidence bands or currency totals from predicate results.

---

## Inputs

| Name | Type |
| --- | --- |
| `datasetId` | `number` |
| `limit` | `number` |

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
