# 🧩 Draft Outbound Message for Review

> **Capability ID:** `propose_outbound_message`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Integrations  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Draft an outbound email or Slack message and show it as a confirmation card the human can send or discard. Prefer this over a direct send whenever context makes review appropriate: first contact with an external recipient, messages making commitments (pricing, dates, legal), replies to a customer or partner, anything the user didn't dictate verbatim, or a channel with a broad audience. For a routine internal notice the user already asked for verbatim, send directly. Always fill `trigger` and `sensitivity` so the reviewer sees the situation the draft came from.

---

## Inputs

| Name | Type |
| --- | --- |
| `channel` | `enum` |
| `to` | `any` |
| `from` | `string` |
| `subject` | `string` |
| `body` | `string` |
| `cc` | `any` |
| `workspace` | `string` |
| `threadTs` | `string` |
| `thread` | `string` |
| `sendTool` | `string` |
| `messageId` | `string` |
| `trigger` | `string` |
| `sensitivity` | `enum` |
| `escalate` | `boolean` |
| `reason` | `string` |

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
