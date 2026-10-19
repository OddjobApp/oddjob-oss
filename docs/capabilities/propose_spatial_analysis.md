# 🛠️ Propose Spatial Telemetry & Anomaly Analysis

> **Capability ID:** `propose_spatial_analysis`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Proposes running an Eulerian Uber H3 hexagonal spatial flux and geofence dwell-time anomaly analysis. Identifies congestion clusters and geographic bottlenecks with human approval.

---

## Inputs

| Name | Type |
| --- | --- |
| `targetArea` | `string` |
| `resolution` | `number` |
| `metrics` | `array` |
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

> [!NOTE]
> No explicit guardrails declared.
