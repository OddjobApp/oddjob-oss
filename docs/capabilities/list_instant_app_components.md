# 📝 List Instant App Components
> **Capability ID:** `list_instant_app_components`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description
List the pre-built UI blocks that can be rendered live in the chat as an 'instant app' (no build/deploy). Returns each block's name, module, category, KIND (input | action | display | chat | content), its capability (what it can/cannot do), and its prop interface. ALWAYS match the block kind to the task: input/forms blocks need kind='input' AND a valid formId prop; display/action blocks are READ-ONLY and cannot capture typed input. IMPORTANT: Instant app blocks CANNOT perform calculations, conversions, or custom logic. For CALCULATORS (mortgage, tip, BMI, loan, etc.), use render_intake_form with 'computed' fields instead — it supports live formula evaluation. Choose the block from this list BEFORE calling render_instant_app. Many blocks are self-wiring (they fetch their own data) and need no props.

---

## Inputs

| Name  | Type   |
|-------|--------|
| query | string |
| limit | number |

---

## Outputs

| Name   | Type   |
|--------|--------|
| result | string |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE] No specific business use cases declared.
