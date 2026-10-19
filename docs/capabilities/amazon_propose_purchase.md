# 🛠️ Propose Amazon purchase

> **Capability ID:** `amazon_propose_purchase`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Create an approval-gated procurement proposal for a set of ASINs. Nothing is bought: on approval, the approver gets a cart link that opens their own Amazon session. For personal shopping prefer amazon_build_cart, which needs no approval.

---

## Inputs

| Name | Type |
| --- | --- |
| `marketplace` | `string` |
| `items` | `array` |
| `title` | `string` |
| `reason` | `string` |
| `max_total` | `number` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

_No business use cases documented._

---

## Security Guardrails

> [!WARNING]
> Uses the organization’s configured provider first; shared Rainforest/SerpApi credentials may provide catalog data. Never uses a platform Associates tag.

> [!WARNING]
> The agent never logs in to or automates amazon.com; results are catalog data from the configured provider.

> [!WARNING]
> Prices and availability are indicative — the live price is shown on the Amazon page the person opens.

> [!WARNING]
> A purchase is completed by a human in their own browser via a cart handoff link.

> [!WARNING]
> Approval re-prices the cart live and re-checks the proposal’s max_total — an approver sees current prices, not the proposal’s snapshot.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-10-08]** (source: code) — 4 field change(s):
  - modified `risk_profile`: `High` → `Low`
  - added `inputs.marketplace`: `—` → `string`
  - added `guardrails`: `—` → `Uses the organization’s configured provider first; shared Rainforest/SerpApi credentials may provide catalog data. Never uses a platform Associates tag.`
  - removed `guardrails`: `Runs only on the organization’s own Amazon credential (BYOK) — never a platform key or Associates tag.` → `—`
