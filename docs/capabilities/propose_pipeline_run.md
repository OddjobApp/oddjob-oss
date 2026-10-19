# 🧩 Propose Pipeline Run

> **Capability ID:** `propose_pipeline_run`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Pipeline Orchestration  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Ask a human to approve running one of this organization's pipelines with the given inputs. Nothing runs until an org admin approves the card; approving starts the run. Find the pipeline with list_pipelines, and read the result afterwards with list_recent_executions.

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
