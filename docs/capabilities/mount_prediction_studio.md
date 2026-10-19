# 🛠️ Mount Prediction Studio

> **Capability ID:** `mount_prediction_studio`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Mounts Prediction Studio in the side-rail beside the CREW conversation, allowing visual inspection of real-time inference, confidence envelopes (p10/p50/p90), drift metrics, and surrogate models. Pass 'modelId' or 'modelName' to inspect a specific prediction model, or call with no arguments to open on the active stream.

---

## Inputs

| Name | Type |
| --- | --- |
| `modelId` | `string` |
| `modelName` | `string` |
| `streamId` | `string` |
| `view` | `enum` |
| `activeHorizon` | `enum` |
| `environmental` | `object` |

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
