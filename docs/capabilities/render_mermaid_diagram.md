# 🛠️ Render Mermaid Diagram (Inline)

> **Capability ID:** `render_mermaid_diagram`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Renders any Mermaid diagram type directly inline in the assistant chat. Use this for sequence diagrams, class diagrams, ER diagrams, Gantt charts, Sankey diagrams, mindmaps, timelines, pie charts, XY charts, and quadrant charts. Always use this instead of describing diagrams in prose or emitting raw markdown code blocks — this renders an interactive visual component. Supported types: sequenceDiagram, classDiagram, erDiagram, gantt, mindmap, timeline, pie, sankey-beta, xychart-beta, quadrantChart, requirementDiagram, flowchart.

---

## Inputs

| Name | Type |
| --- | --- |
| `code` | `string` |
| `title` | `string` |

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
