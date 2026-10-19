# 📝 Show Pipeline Input Form

> **Capability ID**: `show_pipeline_input_form`
> **Capability Version**: `1.0.0`
> **Manifest Schema Version**: `1`
> **Category**: `Pipeline Orchestration`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

---

## Description

RENDERS A UI FORM in the chat when a pipeline requires input (like VIN, ID, etc.). `pipelineId` must be a real pipeline id or an exact existing name — if you are not certain the name exists, call list_pipelines first rather than guessing, because an invented name fails. Use pre-cached form definitions if available by only providing pipelineId. If no manifest is found, provide fields manually.

---

## Technical Specification

### Inputs

| Name | Type |
|---|---|
| pipelineId | any |
| pipelineName | string |
| fields | array |

### Outputs

| Name | Type |
|---|---|
| result | string |

---

## Business Use Cases

> [!NOTE] No business use cases declared.

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-08-22]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `RENDERS A UI FORM in the chat. Use this IMMEDIATELY when a pipeline requires input (like VIN, ID, etc.). Use pre-cached form definitions if available by only providing pipelineId. If no manifest is found, you must provide fields manually.` → `RENDERS A UI FORM in the chat when a pipeline requires input (like VIN, ID, etc.). `pipelineId` must be a real pipeline id or an exact existing name — if you are not certain the name exists, call list_pipelines first rather than guessing, because an invented name fails. Use pre-cached form definitions if available by only providing pipelineId. If no manifest is found, provide fields manually.`
  - modified `documentation_meta.summary`: `RENDERS A UI FORM in the chat. Use this IMMEDIATELY when a pipeline requires input (like VIN, ID, etc.). Use pre-cached form definitions if available by only providing pipelineId. If no manifest is found, you must provide fields manually.` → `RENDERS A UI FORM in the chat when a pipeline requires input (like VIN, ID, etc.). `pipelineId` must be a real pipeline id or an exact existing name — if you are not certain the name exists, call list_pipelines first rather than guessing, because an invented name fails. Use pre-cached form definitions if available by only providing pipelineId. If no manifest is found, provide fields manually.`
