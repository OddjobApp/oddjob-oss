# 🧩 Send AgentMail Email

> **Capability ID:** `send_agentmail`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Integrations  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Send an outbound email from the configured AgentMail inbox. Supports rich styling, CC/BCC, and labels.

---

## Inputs

| Name | Type |
| --- | --- |
| `to` | `any` |
| `subject` | `string` |
| `body` | `string` |
| `message` | `string` |
| `text` | `string` |
| `html` | `string` |
| `threadId` | `string` |
| `cc` | `any` |
| `bcc` | `any` |
| `labels` | `array` |
| `clientId` | `string` |

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

- **[Auto-Changelog 2026-08-28]** (source: code) — 5 field change(s):
  - modified `inputs.cc`: `array` → `any`
  - modified `inputs.to`: `array` → `any`
  - modified `inputs.bcc`: `array` → `any`
  - added `inputs.body`: `—` → `string`
  - added `inputs.message`: `—` → `string`

- **[Auto-Changelog 2026-08-28]** (source: code) — 5 field change(s):
  - modified `inputs.cc`: `array` → `any`
  - modified `inputs.to`: `array` → `any`
  - modified `inputs.bcc`: `array` → `any`
  - added `inputs.body`: `—` → `string`
  - added `inputs.message`: `—` → `string`

- **[Auto-Changelog 2026-08-28]** (source: code) — 5 field change(s):
  - modified `inputs.cc`: `array` → `any`
  - modified `inputs.to`: `array` → `any`
  - modified `inputs.bcc`: `array` → `any`
  - added `inputs.body`: `—` → `string`
  - added `inputs.message`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 5 field change(s):
  - modified `inputs.cc`: `array` → `any`
  - modified `inputs.to`: `array` → `any`
  - modified `inputs.bcc`: `array` → `any`
  - added `inputs.body`: `—` → `string`
  - added `inputs.message`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 5 field change(s):
  - modified `inputs.cc`: `array` → `any`
  - modified `inputs.to`: `array` → `any`
  - modified `inputs.bcc`: `array` → `any`
  - added `inputs.body`: `—` → `string`
  - added `inputs.message`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 5 field change(s):
  - modified `inputs.cc`: `array` → `any`
  - modified `inputs.to`: `array` → `any`
  - modified `inputs.bcc`: `array` → `any`
  - added `inputs.body`: `—` → `string`
  - added `inputs.message`: `—` → `string`
