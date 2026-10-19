# 🛠️ Propose voiding a QuickBooks invoice

> **Capability ID:** `quickbooks_propose_void_invoice`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Save a review card to void an existing QuickBooks invoice. Only authenticated approval voids it; the record stays for audit but its amounts are zeroed and this cannot be undone.

---

## Inputs

| Name | Type |
| --- | --- |
| `invoice_id` | `string` |

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
