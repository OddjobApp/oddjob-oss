# 🛠️ Draft a New Form

> **Capability ID:** `propose_new_form`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Drafts a new Form Studio form (a calculator, intake form, questionnaire, survey, assessment, scorecard or checklist) from a request and returns it as a card for the author to create. Writes nothing.

Auto-Scribe mode: set autoScribeDraft to true and optionally supply scribeDocumentId to tell the room that, once the form is submitted, a Scribe section should be drafted automatically from the responses. The crew service reads this flag from the proposal payload and chains a scribe_update_node call after the submission webhook fires.

---

## Inputs

| Name | Type |
| --- | --- |
| `instruction` | `string` |
| `autoScribeDraft` | `boolean` |
| `scribeDocumentId` | `string` |

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

- **[Auto-Changelog 2026-09-29]** (source: code) — 2 field change(s):
  - added `inputs.autoScribeDraft`: `—` → `boolean`
  - added `inputs.scribeDocumentId`: `—` → `string`

- **[Auto-Changelog 2026-09-29]** (source: code) — 2 field change(s):
  - added `inputs.autoScribeDraft`: `—` → `boolean`
  - added `inputs.scribeDocumentId`: `—` → `string`

- **[Auto-Changelog 2026-09-29]** (source: code) — 2 field change(s):
  - added `inputs.autoScribeDraft`: `—` → `boolean`
  - added `inputs.scribeDocumentId`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.autoScribeDraft`: `—` → `boolean`
  - added `inputs.scribeDocumentId`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.autoScribeDraft`: `—` → `boolean`
  - added `inputs.scribeDocumentId`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.autoScribeDraft`: `—` → `boolean`
  - added `inputs.scribeDocumentId`: `—` → `string`
