# 🛠️ Find airport codes

> **Capability ID:** `flighthub_lookup_airports`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Resolve city, airport name or IATA code using the bundled OurAirports directory. Returns actual airport names and codes, including multiple airports for ambiguous cities. No CSV upload, ontology setup, AI inference or credentials required. Ask for airport preference only when multiple relevant airports match.

---

## Inputs

| Name | Type |
| --- | --- |
| `query` | `string` |
| `country` | `string` |
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
