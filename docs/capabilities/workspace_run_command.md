# 🧩 Run Command in Workspace

> **Capability ID:** `workspace_run_command`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Git Workspace  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Execute a shell command within the Git workspace directory. Use for: npm run build, npm test, npx tsc --noEmit, npm run lint, etc. Commands run with cwd set to the project root.

---

## Inputs

| Name | Type |
| --- | --- |
| `command` | `string` |
| `timeout_ms` | `number` |

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

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `Medium`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `Medium`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `Medium`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `Medium`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `Medium`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - modified `risk_profile`: `Low` → `Medium`
