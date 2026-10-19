# 🛠️ Render Workflow Dependency Diagram

> **Capability ID:** `render_workflow_diagram`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Generates and renders a Mermaid diagram inline in the chat. Two modes: (1) Pass 'stages' to auto-generate a Blueprint execution flowchart with ready/active/blocked status classes. (2) Pass raw 'code' to render ANY Mermaid diagram type inline — sequenceDiagram, classDiagram, erDiagram, gantt, mindmap, timeline, pie, etc. Always use this for sequence diagrams, class diagrams, ER diagrams, Gantt charts, and any other Mermaid diagram you want rendered in the chat. Do NOT use generate_mermaid_diagram for inline rendering — that saves to file storage.

---

## Inputs

| Name | Type |
| --- | --- |
| `stages` | `array` |
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

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.code`: `—` → `string`
  - added `inputs.title`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.code`: `—` → `string`
  - added `inputs.title`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.code`: `—` → `string`
  - added `inputs.title`: `—` → `string`
