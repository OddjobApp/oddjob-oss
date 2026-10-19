# 🛠️ Find QuickBooks records

> **Capability ID:** `quickbooks_list_records`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read customers, vendors, accounts, items, invoices, bills, purchases, payments or estimates. For outstanding/unpaid invoices use entity Invoice and outstanding true; for overdue invoices use overdue true. OutstandingInvoices is not a report name. Supports bounded pagination and name/document-number search. No accounting data is changed.

---

## Inputs

| Name | Type |
| --- | --- |
| `entity` | `enum` |
| `start` | `number` |
| `limit` | `number` |
| `search` | `string` |
| `overdue` | `boolean` |
| `outstanding` | `boolean` |

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
