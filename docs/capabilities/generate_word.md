# 📝 Generate Word
> **ID**: `generate_word`
> **Version**: `1.0.0`
> **Schema Version**: `1`
> **Category**: `Generation`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

Generate a styled Word (.docx) document from text, Markdown, or Creative Crew Document AST and save it to storage.

---

## Inputs

| Name | Type |
|---|---|
| path | string |
| content | string |
| title | string |
| themeId | enum |
| formatCategory | enum |
| useCreativeCrew | boolean |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Business Use Cases
> [!NOTE] No explicit business use cases declared.

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-08-22]** (source: code) — 3 field change(s):
  - added `inputs.formatCategory`: `—` → `enum`
  - added `inputs.themeId`: `—` → `enum`
  - added `inputs.useCreativeCrew`: `—` → `boolean`
