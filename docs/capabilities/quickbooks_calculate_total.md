# 🛠️ Calculate QuickBooks total

> **Capability ID:** `quickbooks_calculate_total`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Calculate an exact monetary sum across ALL pages of supported QuickBooks records. Specify the monetary field explicitly. Outstanding invoices mean entity Invoice, field Balance, outstanding true; original invoice amounts use TotalAmt. Results are separate per verified currency. Missing values and incomplete paging fail instead of reporting misleading totals.

---

## Inputs

| Name | Type |
| --- | --- |
| `entity` | `enum` |
| `field` | `enum` |
| `outstanding` | `boolean` |
| `overdue` | `boolean` |

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
