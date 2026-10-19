# ➕ Create Job
> **Capability ID:** `create_job`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** System Management
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Create a new job. Requires admin permissions. Types include: shell, curl, python, ai_api_call, ai_agent, transformer, openapi, selenium, sql_query, slack_post, email_send, repeater, iterator, decision, human_approval, folder_import, file_export, reranker, airflow_dag_run, node_script.

---

## Inputs
| Name            | Type   |
| :-------------- | :----- |
| `name`          | string |
| `type`          | enum   |
| `description`   | string |
| `config`        | object |
| `outputDatasetId` | number |

---

## Outputs
| Name     | Type   |
| :------- | :----- |
| `result` | string |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE] No business use cases are currently documented.
