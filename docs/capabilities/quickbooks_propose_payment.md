# 🛠️ Propose QuickBooks payment

> **Capability ID:** `quickbooks_propose_payment`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Save a review card for a customer payment against an open QuickBooks invoice. Only authenticated approval records the payment; it does not move money.

---

## Inputs

| Name | Type |
| --- | --- |
| `invoice_id` | `string` |
| `amount` | `number` |
| `txn_date` | `any` |
| `note` | `string` |

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
