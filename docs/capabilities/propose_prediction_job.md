# 🛠️ Draft a Prediction Job

> **Capability ID:** `propose_prediction_job`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Drafts a prediction_inference job and returns it as a card for a person to create. Writes nothing; the person presses Create. Use it when someone wants a trajectory forecast configured to run repeatedly, rather than estimated once — estimate_trajectory answers a one-off question. Environmental co-factors are supported directly: wind, current, bathymetry depth and vessel draft all feed the estimate. Do not reach for another surface to add them — put them in inputFeatures.

Drafts a prediction_inference job and returns it as a card for a person to create. Writes nothing; the person presses Create. Use it when someone wants a trajectory forecast configured to run repeatedly, rather than estimated once — estimate_trajectory answers a one-off question. Environmental co-factors are supported directly: wind, current, bathymetry depth and vessel draft all feed the estimate. Do not reach for another surface to add them — put them in inputFeatures.

---

## Inputs

| Name | Type |
| --- | --- |
| `name` | `string` |
| `instruction` | `string` |
| `inputFeatures` | `string` |
| `modelId` | `string` |
| `horizonSeconds` | `number` |
| `confidenceThreshold` | `number` |

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

- **[Auto-Changelog 2026-09-28]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Drafts a prediction_inference job and returns it as a card for a person to create. Writes nothing; the person presses Create. Use it when someone wants a trajectory forecast configured to run repeatedly, rather than estimated once — estimate_trajectory answers a one-off question.` → `Drafts a prediction_inference job and returns it as a card for a person to create. Writes nothing; the person presses Create. Use it when someone wants a trajectory forecast configured to run repeatedly, rather than estimated once — estimate_trajectory answers a one-off question. Environmental co-factors are supported directly: wind, current, bathymetry depth and vessel draft all feed the estimate. Do not reach for another surface to add them — put them in inputFeatures.`
  - modified `documentation_meta.summary`: `Drafts a prediction_inference job and returns it as a card for a person to create. Writes nothing; the person presses Create. Use it when someone wants a trajectory forecast configured to run repeatedly, rather than estimated once — estimate_trajectory answers a one-off question.` → `Drafts a prediction_inference job and returns it as a card for a person to create. Writes nothing; the person presses Create. Use it when someone wants a trajectory forecast configured to run repeatedly, rather than estimated once — estimate_trajectory answers a one-off question. Environmental co-factors are supported directly: wind, current, bathymetry depth and vessel draft all feed the estimate. Do not reach for another surface to add them — put them in inputFeatures.`
