# 📊 Generate Excel
> **Capability ID:** `generate_excel`
> **Version:** `1.0.0`
> **Manifest Schema:** `1`
> **Category:** `Generation`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

## Description
Generate an Excel (.xlsx) file from structured data (JSON) and save it to storage.

---

## Inputs

| Name | Type |
| :--- | :--- |
| `path` | `string` |
| `data` | `array` |
| `sheets` | `array` |
| `sheetName` | `string` |
| `themeId` | `enum` |
| `autoFilter` | `boolean` |
| `includeSummaryRow` | `boolean` |

---

## Outputs

| Name | Type |
| :--- | :--- |
| `result` | `string` |

---

## Business Use Cases
> [!NOTE] No business use cases declared.

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-08-22]** (source: code) — 4 field change(s):
  - added `inputs.autoFilter`: `—` → `boolean`
  - added `inputs.includeSummaryRow`: `—` → `boolean`
  - added `inputs.sheets`: `—` → `array`
  - added `inputs.themeId`: `—` → `enum`
