# 🛠️ Estimate a Trajectory

> **Capability ID:** `estimate_trajectory`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Computes a kinematic trajectory estimate from a feature vector: vessel velocity composed with wind leeway and current advection, an ETA from the remaining distance, and breach confidence across the 15m/30m/60m/120m horizons. This is arithmetic, not a learned model — it loads nothing and calls no inference runtime. Say so when reporting the result.

Signal feed mode: when signalFeedId is supplied, the tool loads recent event_primitives rows from that feed (optionally filtered by CEL expression via eventFilter) and maps each row's confidenceScore and dwellMinutes as proxy kinematic values. The regular features map is still used for environmental co-factors (wind, current, bathymetry); supply both together to combine live signal intensity with physical environment data.

---

## Inputs

| Name | Type |
| --- | --- |
| `features` | `object` |
| `horizonSeconds` | `number` |
| `confidenceThreshold` | `number` |
| `signalFeedId` | `string` |
| `eventFilter` | `string` |
| `signalLookbackHours` | `number` |

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

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-09-29]** (source: code) — 3 field change(s):
  - added `inputs.eventFilter`: `—` → `string`
  - added `inputs.signalFeedId`: `—` → `string`
  - added `inputs.signalLookbackHours`: `—` → `number`

- **[Auto-Changelog 2026-09-29]** (source: code) — 3 field change(s):
  - added `inputs.eventFilter`: `—` → `string`
  - added `inputs.signalFeedId`: `—` → `string`
  - added `inputs.signalLookbackHours`: `—` → `number`

- **[Auto-Changelog 2026-09-29]** (source: code) — 3 field change(s):
  - added `inputs.eventFilter`: `—` → `string`
  - added `inputs.signalFeedId`: `—` → `string`
  - added `inputs.signalLookbackHours`: `—` → `number`

- **[Auto-Changelog 2026-10-03]** (source: code) — 3 field change(s):
  - added `inputs.eventFilter`: `—` → `string`
  - added `inputs.signalFeedId`: `—` → `string`
  - added `inputs.signalLookbackHours`: `—` → `number`

- **[Auto-Changelog 2026-10-03]** (source: code) — 3 field change(s):
  - added `inputs.eventFilter`: `—` → `string`
  - added `inputs.signalFeedId`: `—` → `string`
  - added `inputs.signalLookbackHours`: `—` → `number`

- **[Auto-Changelog 2026-10-03]** (source: code) — 3 field change(s):
  - added `inputs.eventFilter`: `—` → `string`
  - added `inputs.signalFeedId`: `—` → `string`
  - added `inputs.signalLookbackHours`: `—` → `number`
