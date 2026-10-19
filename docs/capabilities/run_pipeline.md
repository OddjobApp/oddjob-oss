# 🚀 Run Pipeline

> **Capability ID**: `run_pipeline`
> **Capability Version**: `1.0.0`
> **Manifest Schema Version**: `1`
> **Category**: `Pipeline Orchestration`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

---

## Description

Trigger execution of a pipeline. Requires admin permissions. Returns executionId. You should poll get_pipeline_status for final results.

---

## Inputs

| Name         | Type      |
| :----------- | :-------- |
| `pipelineId` | `number`  |
| `pipelineName`| `string`  |
| `inputData`  | `object`  |
| `dryRun`     | `boolean` |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

> [!NOTE] No specific business use cases declared.
