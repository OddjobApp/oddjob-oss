# 🔍 jira_jql_search

> **ID:** `jira_jql_search`
> **Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `SDLC`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Search Jira issues with a JQL query. Returns matching issues (empty when Jira is not configured).

---

## Inputs

| Name   | Type     |
| :----- | :------- |
| `jql`  | `string` |
| `fields` | `array`  |
| `limit`  | `number` |

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
