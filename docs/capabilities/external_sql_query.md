# 💾 External DB Query
> **ID:** external_sql_query
> **Version:** 1.0.0
> **Manifest Schema:** 1
> **Category:** Datasets & External
> **Owner:** platform
> **Risk Profile:** Low
> **Execution Environment:** Host

---

## Description
Execute a SQL query against an EXTERNAL database using a stored credential. CRITICAL: Use parameters ($1, $2, etc.) for any user-provided data to prevent SQL injection.

---

## Inputs

| Name | Type |
|---|---|
| credentialId | number |
| query | string |
| params | array |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Business Use Cases
No business use cases declared.

---

## Guardrails
> [!NOTE]
> No explicit guardrails declared.
