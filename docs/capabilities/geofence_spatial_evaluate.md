# 📍 geofence_spatial_evaluate

> **Capability ID:** `geofence_spatial_evaluate`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `High`
> **Execution Environment:** `Host`

---

## Overview

Process spatial telemetry coordinates against geofence boundaries (ENTER, DWELL, EXIT) to detect SLA breaches and trigger FormAgent UIs.

---

## Inputs

| Name | Type |
|---|---|
| assetId | string |
| assetName | string |
| latitude | number |
| longitude | number |
| velocityKmh | number |
| zoneId | string |
| zoneName | string |
| zoneType | enum |
| eventType | enum |
| maxDwellSlaMinutes | number |
| agentId | string |

---

## Outputs

| Name | Type |
|---|---|
| result | string |

---

## Guardrails

- Unknown or low-precision positions are never treated as definite locations.
- Exclusion and exit rules do not fire when position is undetermined.
- Boundary precision, trigger state, and dwell evidence remain inspectable.
- Decisions are organization- and Project Space-scoped and durably audited.

---

## Business Use Cases

> [!NOTE] No explicit business use cases declared.
