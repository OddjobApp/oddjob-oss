# 📝 Create Jira Issue
> **ID:** `create_jira_issue`
> **Version:** `1.0.0`
> **Schema Version:** `1`
> **Category:** `Integrations`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Create a new Jira issue with summary, type, and optional fields.

---

## Inputs

| Name       | Type   |
| :--------- | :----- |
| projectKey | string |
| summary    | string |
| issueType  | string |
| description| string |
| assignee   | string |
| priority   | string |
| labels     | array  |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| result | string |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

No explicit business use cases are documented for this capability.
