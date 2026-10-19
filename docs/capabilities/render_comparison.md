# ⚖️ Render Comparison
> **Capability ID:** `render_comparison`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `Rich UI`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

Render a specialized side-by-side comparison view in the assistant chat for comparing 2-3 items. Use this whenever you need to compare features, products, or options (e.g. feature comparisons, product specs, A/B analysis). More structured than generic tables for focused comparisons. Supports highlighting differences and recommendations. For 4+ items, use render_table instead.

---

## Inputs

| Name | Type |
|---|---|
| `title` | `string` |
| `description` | `string` |
| `items` | `array` |
| `criteria` | `array` |

---

## Outputs

| Name | Type |
|---|---|
| `result` | `string` |

---

## Business Use Cases

No business use cases declared.

---

## Guardrails

> [!NOTE] No explicit guardrails declared.
