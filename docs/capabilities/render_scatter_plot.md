# 🧩 Render Scatter Plot

> **Capability ID:** `render_scatter_plot`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Rich UI  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Render a scatter plot (X/Y correlation chart) in the assistant chat. Use when you have two numeric dimensions per data point (e.g. speed vs. accuracy, cost vs. performance, risk vs. impact). Each data point needs an x value, a y value, and a label. Always use this instead of describing scatter data in prose.

---

## Inputs

| Name | Type |
| --- | --- |
| `title` | `string` |
| `description` | `string` |
| `xAxis` | `string` |
| `yAxis` | `string` |
| `data` | `array` |
| `color` | `string` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!NOTE]
> No explicit guardrails declared.
