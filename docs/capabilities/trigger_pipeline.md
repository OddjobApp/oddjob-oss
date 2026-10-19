# 🧩 Trigger Pipeline

> **Capability ID:** `trigger_pipeline`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Pipeline Orchestration  
> **Owner:** platform  
> **Risk Profile:** High  
> **Execution Environment:** Host

---

## Overview

Trigger a new execution of a pipeline with optional input data. Returns an executionId. After triggering, poll 'get_pipeline_status' until completed. IMPORTANT: If inputs are required (VIN, etc.), prefer using 'show_pipeline_input_form' to get them from the user FIRST.

---

## Inputs

| Name | Type |
| --- | --- |
| `nonce` | `string` |
| `pipelineId` | `any` |
| `inputData` | `object` |

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

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `High`
