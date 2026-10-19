# 🧩 Delete Code File

> **Capability ID:** `code_delete`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Self-Modification  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Delete a file from the Oddjob codebase. Creates backup and requires confirmation. SUPER ADMIN ONLY.

---

## Inputs

| Name | Type |
| --- | --- |
| `filePath` | `string` |
| `confirm` | `boolean` |
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
