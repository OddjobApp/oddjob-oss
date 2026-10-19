# 📊 Render Chart

> **ID**: `render_chart`
> **Version**: `1.0.0`
> **Manifest Schema**: `1`
> **Category**: Rich UI
> **Owner**: platform
> **Risk Profile**: Low
> **Execution Environment**: Host

---

## Description

Render a data visualization chart in the assistant chat to display trends, comparisons, or analytics. Use this whenever you need to visualize data (e.g. sales trends, performance metrics, category breakdowns). Supports bar, line, pie, and area charts. The chart is read-only and displays pre-populated data. Always use this instead of describing charts in prose or asking users to imagine the visualization.

---

## Inputs

| Name        | Type     |
| :---------- | :------- |
| `title`     | `string` |
| `description` | `string` |
| `type`      | `enum`   |
| `data`      | `array`  |
| `xAxis`     | `string` |
| `yAxis`     | `string` |
| `colors`    | `array`  |

---

## Outputs

| Name     | Type     |
| :------- | :------- |
| `result` | `string` |

---

## Business Use Cases

No explicit business use cases declared.

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.
