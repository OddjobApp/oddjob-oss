# 🧩 Delegate to Pipeline

> **Capability ID:** `delegate_to_pipeline`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Pipeline Orchestration  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Delegate a sub-task to a specific pipeline. This creates a child execution linked to the current execution. Returns an executionId.

Delegate a sub-task to a specific pipeline. This creates a child execution linked to the current execution. Returns an executionId.

---

## Inputs

| Name | Type |
| --- | --- |
| `pipelineId` | `number` |
| `pipelineName` | `string` |
| `inputData` | `object` |
| `reason` | `string` |

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
