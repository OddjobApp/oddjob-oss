# 🛠️ Propose FlightHub booking

> **Capability ID:** `flighthub_propose_booking`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Save an approval card for an offer returned by flighthub_search_flights. Only session_id and offer_ref identify the offer; itinerary and prices are loaded from executed search evidence. Approval provides a human booking link. No autonomous booking or purchase runs.

---

## Inputs

| Name | Type |
| --- | --- |
| `session_id` | `string` |
| `offer_ref` | `string` |
| `offer_index` | `number` |
| `itinerary` | `string` |
| `origin_code` | `string` |
| `destination_code` | `string` |
| `airline` | `string` |
| `depart_at` | `string` |
| `arrive_at` | `string` |
| `price_display` | `string` |
| `passengers` | `number` |
| `passenger_note` | `string` |
| `results_url` | `string` |
| `max_total` | `number` |
| `reason` | `string` |

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
