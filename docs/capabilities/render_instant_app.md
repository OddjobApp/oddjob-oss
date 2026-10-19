# 🛠️ Render Instant App

> **Capability ID:** `render_instant_app`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Render a single pre-built UI block LIVE in the chat as an 'instant app' — an ephemeral, no-build surface to help with the current task. ALWAYS pick the `component` from list_instant_app_components (use its exact name or module), and pass `props` that match that block's prop interface. Self-wiring blocks need no props. Do NOT describe the app in prose — call this tool and it renders immediately. IMPORTANT: These blocks are PRE-BUILT platform widgets. They CANNOT perform calculations, conversions, or custom logic. For CALCULATORS (mortgage, tip, BMI, loan, currency), use render_intake_form with 'computed' fields instead.

---

## Inputs

_None._

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

- **[Auto-Changelog 2026-10-02]** (source: code) — 4 field change(s):
  - removed `inputs.note`: `string` → `—`
  - removed `inputs.props`: `object` → `—`
  - removed `inputs.title`: `string` → `—`
  - removed `inputs.component`: `string` → `—`

- **[Auto-Changelog 2026-10-02]** (source: code) — 4 field change(s):
  - removed `inputs.note`: `string` → `—`
  - removed `inputs.props`: `object` → `—`
  - removed `inputs.title`: `string` → `—`
  - removed `inputs.component`: `string` → `—`

- **[Auto-Changelog 2026-10-02]** (source: code) — 4 field change(s):
  - removed `inputs.note`: `string` → `—`
  - removed `inputs.props`: `object` → `—`
  - removed `inputs.title`: `string` → `—`
  - removed `inputs.component`: `string` → `—`

- **[Auto-Changelog 2026-10-03]** (source: code) — 4 field change(s):
  - removed `inputs.note`: `string` → `—`
  - removed `inputs.props`: `object` → `—`
  - removed `inputs.title`: `string` → `—`
  - removed `inputs.component`: `string` → `—`

- **[Auto-Changelog 2026-10-03]** (source: code) — 4 field change(s):
  - removed `inputs.note`: `string` → `—`
  - removed `inputs.props`: `object` → `—`
  - removed `inputs.title`: `string` → `—`
  - removed `inputs.component`: `string` → `—`

- **[Auto-Changelog 2026-10-03]** (source: code) — 4 field change(s):
  - removed `inputs.note`: `string` → `—`
  - removed `inputs.props`: `object` → `—`
  - removed `inputs.title`: `string` → `—`
  - removed `inputs.component`: `string` → `—`
