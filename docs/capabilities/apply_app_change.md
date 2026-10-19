# 🧩 Apply a change to a mounted app

> **Capability ID:** `apply_app_change`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** App Forge  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Applies a described change to an app already open in the App Studio, then rebuilds it. Returns the studio surface with the outcome attached, so the mounted pod reflects the result.

---

## Inputs

| Name | Type |
| --- | --- |
| `appId` | `number` |
| `instruction` | `string` |
| `view` | `enum` |
| `galleryMigration` | `boolean` |

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
  - added `inputs.galleryMigration`: `—` → `boolean`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - added `inputs.galleryMigration`: `—` → `boolean`

- **[Auto-Changelog 2026-10-03]** (source: code) — 1 field change(s):
  - added `inputs.galleryMigration`: `—` → `boolean`
