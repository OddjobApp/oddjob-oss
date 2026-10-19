# 🛠️ Calculate financial forecast

> **Capability ID:** `calculate_financial_forecast`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Execute financial forecasts: growth, linear trend, seasonality, rolling cash-flow schedules, scenarios and reconciled simplified three statements. Read source inputs first; supply verified currency, consistent period units and complete assumptions. Returns a forecast card. No invented inputs or confidence bands.

---

## Inputs

| Name | Type |
| --- | --- |
| `method` | `enum` |
| `currency` | `string` |
| `periods` | `number` |
| `periodUnit` | `enum` |
| `history` | `array` |
| `growthRates` | `array` |
| `seasonLength` | `number` |
| `openingCash` | `any` |
| `inflows` | `array` |
| `outflows` | `array` |
| `scenarios` | `array` |
| `opening` | `object` |
| `drivers` | `object` |

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
