# 🔍 Run Saved Query

> **ID**: `run_saved_query`
> **Version**: `1.0.0`
> **Schema**: `1`
> **Category**: `Knowledge`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

Runs a saved knowledge-graph query by name or id and renders the results as a table. Use this whenever asked about data a saved query covers, instead of describing what the query would return. The table is displayed to the user automatically — do not repeat its rows in your reply.

---

## Inputs

| Name  | Type   |
| :---- | :----- |
| query | any    |
| title | string |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| result | string |

---

## Business Use Cases

No explicit business use cases declared.

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.
