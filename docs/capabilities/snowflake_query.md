# ❄️ Snowflake SQL Query
> **Capability ID:** snowflake_query
> **Capability Version:** 1.0.0
> **Manifest Schema Version:** 1
> **Category:** Analytics Databases
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description

Execute a SQL query against a Snowflake data warehouse. Returns up to 500 rows. Use for large-scale analytics and reporting queries.

---

## Inputs

| Name       | Type   |
| :--------- | :----- |
| query      | string |
| warehouse  | string |
| database   | string |
| schema     | string |
| limit_rows | number |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| result | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

- No business use cases are explicitly defined.
