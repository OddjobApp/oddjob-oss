# 🧩 Render App Surface

> **Capability ID:** `render_app_surface`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Rich UI  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Present a published app or workspace to the user as an interactive app card in the assistant chat. Use this when the user's task is best handled inside a dedicated app surface (e.g. Wayfare for field ops, a published agent workspace, an analytics dashboard, or any App Forge–built app). ALWAYS call this tool instead of describing the app in prose — it renders an actionable card the user can open immediately. IMPORTANT: Always use 'mode: embed' to show the app inline inside the assistant panel (the preferred experience). Only use 'mode: link' if the user explicitly asks to open in a new tab.

---

## Inputs

| Name | Type |
| --- | --- |
| `title` | `string` |
| `description` | `string` |
| `source` | `enum` |
| `slug` | `string` |
| `href` | `string` |
| `mode` | `enum` |
| `actionLabel` | `string` |
| `blueprint` | `string` |
| `cycleSlug` | `string` |
| `cycleName` | `string` |
| `routePath` | `string` |
| `sourceAppId` | `string` |
| `sourceAppName` | `string` |
| `recordId` | `string` |
| `focusId` | `string` |

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

- **[Auto-Changelog 2026-10-12]** (source: code) — 2 field change(s):
  - added `inputs.focusId`: `—` → `string`
  - added `inputs.recordId`: `—` → `string`
