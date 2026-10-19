# 🧩 Search Gmail

> **Capability ID:** `gmail_search`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Google Workspace  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Search the connected Gmail mailbox, not AgentMail, using Gmail query syntax. For a requested account, pass mailbox to verify identity. Apply after/before date filters when asked for today's messages.

---

## Inputs

| Name | Type |
| --- | --- |
| `query` | `string` |
| `mailbox` | `string` |
| `max_results` | `number` |

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

- **[Auto-Changelog 2026-10-08]** (source: code) — 1 field change(s):
  - added `inputs.mailbox`: `—` → `string`
