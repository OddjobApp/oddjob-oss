# 📝 List Pipelines
> **Capability ID:** `list_pipelines`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Pipeline Orchestration`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

List available pipelines, optionally filtering by name. A pipeline is the same thing the Oddjob UI calls a WORKSTREAM — use this tool for any question about workstreams (how many exist, which are running, listing or finding one). Combine with get_pipeline_status to report which are currently executing.

---

## Inputs

| Name   | Type     |
| :----- | :------- |
| `search` | `string` |
| `limit`  | `number` |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Business Use Cases

---

## Guardrails
> [!NOTE]
> No explicit guardrails declared.
