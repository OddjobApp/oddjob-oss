# 🛠️ Compare Amazon products

> **Capability ID:** `amazon_compare_products`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Compare up to 10 products by ASIN side by side. Returns each normalized product plus a best-by-price and best-by-rating pick where data exists.

---

## Inputs

| Name | Type |
| --- | --- |
| `asins` | `array` |
| `marketplace` | `string` |

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

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-10-08]** (source: code) — 2 field change(s):
  - added `guardrails`: `—` → `Uses the organization’s configured provider first; shared Rainforest/SerpApi credentials may provide catalog data. Never uses a platform Associates tag.`
  - removed `guardrails`: `Runs only on the organization’s own Amazon credential (BYOK) — never a platform key or Associates tag.` → `—`
