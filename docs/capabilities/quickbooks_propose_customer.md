# 🛠️ Propose QuickBooks customer

> **Capability ID:** `quickbooks_propose_customer`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Save a review card for a new QuickBooks customer. Only authenticated approval creates the customer record.

---

## Inputs

| Name | Type |
| --- | --- |
| `display_name` | `string` |
| `company_name` | `string` |
| `email` | `string` |
| `phone` | `string` |
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
