# 📄 Generate PDF

> [!NOTE]
> **ID**: `generate_pdf`
> **Version**: `1.0.0`
> **Manifest Schema Version**: `1`
> **Category**: `Generation`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

Generate a polished PDF file from Markdown, HTML, or Creative Crew Document AST and save it to storage.

---

## Inputs

| Name | Type |
| :---| :---|
| path | string |
| content | string |
| title | string |
| themeId | enum |
| formatCategory | enum |
| useCreativeCrew | boolean |

---

## Outputs

| Name | Type |
| :---| :---|
| result | string |

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Business Use Cases

> [!NOTE]
> No explicit business use cases declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-08-22]** (source: code) — 3 field change(s):
  - added `inputs.formatCategory`: `—` → `enum`
  - added `inputs.themeId`: `—` → `enum`
  - added `inputs.useCreativeCrew`: `—` → `boolean`
