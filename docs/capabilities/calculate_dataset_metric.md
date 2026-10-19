# 📊 Calculate Dataset Metric
> **Capability ID:** `calculate_dataset_metric`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Datasets & External`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description
Compute an aggregate (avg, sum, median, min, max, count) over one numeric field of a dataset, with optional equality filters. Returns the value together with how many rows it covered — quote that scope, and never present a truncated result as the true figure.

---

## Inputs
| Name | Type |
|---|---|
| datasetId | number |
| datasetName | string |
| numericField | string |
| aggregation | enum |
| filters | array |

---

## Outputs
| Name | Type |
|---|---|
| result | string |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
No explicit business use cases declared.
