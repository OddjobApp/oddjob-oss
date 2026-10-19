# 📋 Render List
> **ID:** render_list | **Version:** 1.0.0 | **Schema:** 1 | **Category:** Rich UI | **Owner:** platform | **Risk:** Low | **Environment:** Host

Render a structured list in the assistant chat to display items, tasks, features, or steps. Use this whenever you need to present information as a list (e.g. task lists, feature comparisons, step-by-step guides, checklists). Supports bullet lists, numbered lists, and checklists with completion status. Always use this instead of describing lists in markdown prose for better readability.

---

## Inputs

| Name | Type |
| :--- | :--- |
| title | string |
| description | string |
| type | enum |
| items | array |

---

## Outputs

| Name | Type |
| :--- | :--- |
| result | string |

---

## Business Use Cases

> [!NOTE]
> No specific business use cases declared.

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.
