# 🛠️ FlightHub booking progress

> **Capability ID:** `flighthub_booking_status`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read the status and latest steps of a booking computer-use task started by an approved flighthub_booking proposal — running, waiting on a person (needs_confirmation), succeeded or failed.

---

## Inputs

| Name | Type |
| --- | --- |
| `task_id` | `string` |

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
