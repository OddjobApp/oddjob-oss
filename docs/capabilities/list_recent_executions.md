# 📜 List Recent Executions

> **Capability ID:** `list_recent_executions`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Pipeline Orchestration`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

List recent pipeline executions, optionally filtered by status. A pipeline execution is a run of what the Oddjob UI calls a WORKSTREAM — use this with status='RUNNING' to answer "how many workstreams are running?" or to report what is currently executing. Prefer this over guessing or proposing research.

---

## Inputs

| Name       | Type   |
| :--------- | :----- |
| `limit`    | number |
| `status`   | enum   |
| `pipelineId` | number |

---

## Outputs

| Name     | Type   |
| :------- | :----- |
| `result` | string |

---

## Business Use Cases

> [!NOTE]
> No explicit business use cases declared.

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.
