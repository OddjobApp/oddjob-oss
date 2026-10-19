# 📝 Update Jira Issue
> **Capability ID:** `update_jira_issue`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Integrations`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Update fields of an existing Jira issue (summary, description, priority, etc.).

---

## Inputs

| Name        | Type     |
| :---------- | :------- |
| `issueKey`  | `string` |
| `summary`   | `string` |
| `description` | `string` |
| `priority`  | `string` |
| `assignee`  | `string` |
| `labels`    | `array`  |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.
