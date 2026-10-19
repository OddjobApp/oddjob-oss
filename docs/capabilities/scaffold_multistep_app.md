# 🏗️ Scaffold Multi-Step Application

> **ID:** `scaffold_multistep_app`
> **Version:** `1.0.0`
> **Schema:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description

Assembles a multi-screen application blueprint where forms and submitted results on previous screens flow into subsequent screens, pipelines, and ontology actions.

---

## Inputs

| Name        | Type   |
| :---------- | :----- |
| appName     | string |
| description | string |
| archetype   | enum   |
| layout      | enum   |
| capabilities| array  |
| stages      | array  |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| result | string |

---

## Business Use Cases

> [!NOTE]
> No specific business use cases documented.

---

## Guardrails

> [!NOTE]
> No explicit guardrails declared.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-08-24]** (source: code) — 3 field change(s):
  - added `inputs.archetype`: `—` → `enum`
  - added `inputs.capabilities`: `—` → `array`
  - added `inputs.layout`: `—` → `enum`
