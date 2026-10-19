# 📊 Render Table

> **Capability ID:** `render_table`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Rich UI`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description

Render a static table in the assistant chat to display structured data, comparisons, or tabular information. Use this whenever you need to present data in a table format (e.g. feature comparisons, specifications, side-by-side analysis). The table is read-only and displays pre-populated data — do NOT use this for data collection (use render_intake_form for that). Supports column headers, row data, and optional styling. Always use this instead of describing a table in markdown prose.

---

## Inputs

| Name | Type |
| :--- | :--- |
| `title` | `string` |
| `description` | `string` |
| `columns` | `array` |
| `rows` | `array` |

---

## Outputs

| Name | Type |
| :--- | :--- |
| `result` | `string` |

---

## Guardrails

> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases

No specific business use cases declared.
