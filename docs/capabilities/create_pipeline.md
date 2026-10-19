# 🏗️ Create Pipeline

> [!NOTE]
> **ID:** `create_pipeline`
> **Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Pipeline Orchestration`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description

Create a new automation pipeline. Requires admin permissions. Can include steps with jobs, decisions, and iterators.

---

## Inputs

| Name | Type |
|---|---|
| name | string |
| description | string |
| triggerType | enum |
| isActive | boolean |
| steps | array |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Business Use Cases
