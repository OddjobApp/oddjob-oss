# 🧩 Create Code File

> **Capability ID:** `code_create`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Self-Modification  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Create a new file in the Oddjob codebase. SUPER ADMIN ONLY.

---

## Inputs

| Name | Type |
| --- | --- |
| `filePath` | `string` |
| `content` | `string` |
| `commitMessage` | `string` |
| `branch` | `string` |

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

- **[Auto-Changelog 2026-10-08]** (source: code) — 1 field change(s):
  - added `inputs.branch`: `—` → `string`
