# 📊 BigQuery SQL Query
> **Capability ID:** `bigquery_query`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** Analytics Databases
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

## Description
Execute a SQL query against Google BigQuery. Returns up to 500 rows. Use for large-scale analytics on GCP.

---

## Inputs

| Name         | Type   |
|--------------|--------|
| query        | string |
| project_id   | string |
| location     | string |
| limit_rows   | number |

---

## Outputs

| Name   | Type   |
|--------|--------|
| result | string |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
No explicit business use cases declared.
