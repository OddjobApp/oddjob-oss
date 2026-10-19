# 🧩 List Credentials

> **Capability ID:** `list_credentials`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Management  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

List credentials available in the organization. Returns metadata only (names, types, descriptions) and where each secret lives (secretSource: stored = encrypted for the organization, environment = legacy server variable, missing = not set) - NEVER exposes actual secret values. Requires admin permissions.

---

## Inputs

| Name | Type |
| --- | --- |
| `type` | `string` |

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

- **[Auto-Changelog 2026-10-06]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `List credentials available in the organization. Returns metadata only (names, types, descriptions) - NEVER exposes actual secret values. Requires admin permissions.` → `List credentials available in the organization. Returns metadata only (names, types, descriptions) and where each secret lives (secretSource: stored = encrypted for the organization, environment = legacy server variable, missing = not set) - NEVER exposes actual secret values. Requires admin permissions.`
  - modified `documentation_meta.summary`: `List credentials available in the organization. Returns metadata only (names, types, descriptions) - NEVER exposes actual secret values. Requires admin permissions.` → `List credentials available in the organization. Returns metadata only (names, types, descriptions) and where each secret lives (secretSource: stored = encrypted for the organization, environment = legacy server variable, missing = not set) - NEVER exposes actual secret values. Requires admin permissions.`
