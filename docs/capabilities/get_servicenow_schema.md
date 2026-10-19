# 🧩 Get ServiceNow Table Schema

> **Capability ID:** `get_servicenow_schema`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Integrations  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read the field definitions of a ServiceNow table (incident, change_request, sc_task, …) from sys_dictionary. Use when asked what fields a ServiceNow table has, or to compare against a captured snapshot.

---

## Inputs

| Name | Type |
| --- | --- |
| `tableName` | `string` |

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
