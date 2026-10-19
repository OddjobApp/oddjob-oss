# 🛠️ Read selected FlightHub offer

> **Capability ID:** `flighthub_get_offer`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Read a saved executed search offer, scoped to the requesting user. This is indicative search evidence, not a new live fare check.

---

## Inputs

| Name | Type |
| --- | --- |
| `session_id` | `string` |
| `offer_ref` | `string` |

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
