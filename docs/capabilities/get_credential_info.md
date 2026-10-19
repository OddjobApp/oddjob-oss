# 🧩 Get Credential Info

> **Capability ID:** `get_credential_info`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Management  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Get information about a specific credential by ID or name. Returns metadata only and whether its secret is set (secretSource: stored = encrypted for the organization, environment = legacy server variable, missing = not set) - NEVER exposes actual secret values. Requires admin permissions.

---

## Inputs

| Name | Type |
| --- | --- |
| `credentialId` | `number` |
| `credentialName` | `string` |

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
  - modified `metadata.description`: `Get information about a specific credential by ID or name. Returns metadata only - NEVER exposes actual secret values. Requires admin permissions.` → `Get information about a specific credential by ID or name. Returns metadata only and whether its secret is set (secretSource: stored = encrypted for the organization, environment = legacy server variable, missing = not set) - NEVER exposes actual secret values. Requires admin permissions.`
  - modified `documentation_meta.summary`: `Get information about a specific credential by ID or name. Returns metadata only - NEVER exposes actual secret values. Requires admin permissions.` → `Get information about a specific credential by ID or name. Returns metadata only and whether its secret is set (secretSource: stored = encrypted for the organization, environment = legacy server variable, missing = not set) - NEVER exposes actual secret values. Requires admin permissions.`
