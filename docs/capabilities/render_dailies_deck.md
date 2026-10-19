# 🧩 Render Dailies Review Deck

> **Capability ID:** `render_dailies_deck`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Video Content  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Write a Dailies review summary in markdown: each shot's status, prompt, camera direction, continuity seed and clip link, exactly as given in the parameters.

Write a Dailies review summary in markdown: each shot's status, prompt, camera direction, continuity seed and clip link, exactly as given in the parameters.

---

## Inputs

| Name | Type |
| --- | --- |
| `sceneId` | `string` |
| `sceneTitle` | `string` |
| `budgetSpendUsd` | `number` |
| `shots` | `array` |

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

- **[Auto-Changelog 2026-09-13]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Render an interactive Dailies review pod in the assistant chat showing side-by-side shot takes, prompt metadata, video URLs, and approval statuses for the Director.` → `Write a Dailies review summary in markdown: each shot's status, prompt, camera direction, continuity seed and clip link, exactly as given in the parameters.`
  - modified `documentation_meta.summary`: `Render an interactive Dailies review pod in the assistant chat showing side-by-side shot takes, prompt metadata, video URLs, and approval statuses for the Director.` → `Write a Dailies review summary in markdown: each shot's status, prompt, camera direction, continuity seed and clip link, exactly as given in the parameters.`
