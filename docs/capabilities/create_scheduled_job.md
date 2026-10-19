# 🗓️ Create Scheduled Job
> **Capability ID:** `create_scheduled_job`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** Pipeline Orchestration
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description

Schedule a job or pipeline to run automatically. Requires admin. Provide jobId OR pipelineId, plus scheduleId for scheduling.

---

## Inputs

| Name | Type |
|---|---|
| name | string |
| jobId | number |
| pipelineId | number |
| scheduleId | number |
| triggerType | enum |
| priority | number |
| isActive | boolean |
| alertOnFailure | boolean |
| maxRetries | number |
| parameterValues | object |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Business Use Cases

No explicit business use cases declared.

---

## Guardrails

> [!NOTE] No explicit guardrails declared.
