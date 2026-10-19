# 🌳 Render Tree
> **ID:** `render_tree`
> **Version:** `1.0.0`
> **Manifest Schema:** `1`
> **Category:** `Rich UI`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Render a hierarchical tree structure in the assistant chat to display nested data, org charts, or decision trees. Use this whenever you need to show hierarchical relationships (e.g. org charts, file structures, decision trees, taxonomy). Supports collapsible nodes, icons, and nested children. Always use this instead of describing hierarchies in prose for clearer structure visualization.

---

## Inputs

| Name        | Type   |
| :---------- | :----- |
| `title`     | string |
| `description` | string |
| `nodes`     | array  |

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

No explicit business use cases declared.
