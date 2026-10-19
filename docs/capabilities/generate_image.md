# 🧩 Generate Image

> **Capability ID:** `generate_image`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Generation  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Generate an image from a text prompt and render it inline in the assistant chat. The generated image appears immediately as a visual artifact in the chat turn. Also saves a copy to file storage for future reference. Always use this instead of describing what an image would look like — generate and show it.

---

## Inputs

| Name | Type |
| --- | --- |
| `path` | `string` |
| `prompt` | `string` |
| `title` | `string` |
| `aspectRatio` | `enum` |

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

- **[Auto-Changelog 2026-10-01]** (source: code) — 1 field change(s):
  - added `inputs.title`: `—` → `string`

- **[Auto-Changelog 2026-10-01]** (source: code) — 1 field change(s):
  - added `inputs.title`: `—` → `string`

- **[Auto-Changelog 2026-10-01]** (source: code) — 1 field change(s):
  - added `inputs.title`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.aspectRatio`: `—` → `enum`
  - added `inputs.title`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.aspectRatio`: `—` → `enum`
  - added `inputs.title`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.aspectRatio`: `—` → `enum`
  - added `inputs.title`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.aspectRatio`: `—` → `enum`
  - added `inputs.title`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.aspectRatio`: `—` → `enum`
  - added `inputs.title`: `—` → `string`

- **[Auto-Changelog 2026-10-03]** (source: code) — 2 field change(s):
  - added `inputs.aspectRatio`: `—` → `enum`
  - added `inputs.title`: `—` → `string`
