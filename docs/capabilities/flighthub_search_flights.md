# 🛠️ Search FlightHub flights

> **Capability ID:** `flighthub_search_flights`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Medium  
> **Execution Environment:** Host

---

## Overview

Search FlightHub for flights in the organization’s real desktop browser (trycua). Returns normalized offers — route, airline, times, duration, stops, cabin, price — each carrying an offerRef, plus the sessionId and resultsUrl of the live results page. The saved search evidence lets flighthub_propose_booking prepare a human handoff. Fares are indicative until checkout.

---

## Inputs

| Name | Type |
| --- | --- |
| `origin` | `string` |
| `destination` | `string` |
| `depart_date` | `string` |
| `return_date` | `string` |
| `trip_type` | `enum` |
| `adults` | `number` |
| `children` | `number` |
| `infants` | `number` |
| `cabin_class` | `enum` |
| `max_results` | `number` |
| `session_id` | `string` |

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
> Search uses an isolated browser context without shared desktop cookies.

> [!WARNING]
> Only offers saved from an executed search can be proposed. Results expire after 15 minutes.

> [!WARNING]
> Approval prepares a FlightHub link for the human. It never starts an autonomous booking or purchases tickets.

> [!WARNING]
> Displayed prices are indicative; the human must verify the final total and currency on FlightHub.
