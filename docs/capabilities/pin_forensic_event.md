# 🛠️ Pin Forensic Timeline Event

> **Capability ID:** `pin_forensic_event`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Pins a chronological event, error log anomaly, or root cause hypothesis card into the Forensic Incident Timeline Rail.

---

## Inputs

| Name | Type |
| --- | --- |
| `incidentTitle` | `string` |
| `eventTimestamp` | `string` |
| `severity` | `enum` |
| `source` | `string` |
| `description` | `string` |
| `hypothesis` | `object` |

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
