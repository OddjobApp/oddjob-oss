# 🛠️ Create Calculation Node

> **Capability ID:** `create_calculation_node`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Creates a Neuro-Symbolic calculation node on a target Knowledge Graph node (supports FORMULA, MOVING_AVERAGE, YEAR_OVER_YEAR, MONTE_CARLO_SIMULATION, BAYESIAN_INFERENCE, CONSTRAINT_CHECK, PAGERANK, MODEL_PREDICTION, etc.).

Creates a Neuro-Symbolic calculation node on a target Knowledge Graph node (supports FORMULA, MOVING_AVERAGE, YEAR_OVER_YEAR, MONTE_CARLO_SIMULATION, BAYESIAN_INFERENCE, CONSTRAINT_CHECK, PAGERANK, MODEL_PREDICTION, etc.).

---

## Inputs

| Name | Type |
| --- | --- |
| `nodeId` | `number` |
| `operation` | `enum` |
| `formula` | `string` |
| `inputReferences` | `array` |
| `outputUnit` | `string` |

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

- **[Auto-Changelog 2026-09-12]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Creates a Neuro-Symbolic calculation node on a target Knowledge Graph node (supports FORMULA, MOVING_AVERAGE, YOY_GROWTH, MONTE_CARLO, BAYESIAN, THRESHOLD, PAGERANK, MODEL_PREDICTION, etc.).` → `Creates a Neuro-Symbolic calculation node on a target Knowledge Graph node (supports FORMULA, MOVING_AVERAGE, YEAR_OVER_YEAR, MONTE_CARLO_SIMULATION, BAYESIAN_INFERENCE, CONSTRAINT_CHECK, PAGERANK, MODEL_PREDICTION, etc.).`
  - modified `documentation_meta.summary`: `Creates a Neuro-Symbolic calculation node on a target Knowledge Graph node (supports FORMULA, MOVING_AVERAGE, YOY_GROWTH, MONTE_CARLO, BAYESIAN, THRESHOLD, PAGERANK, MODEL_PREDICTION, etc.).` → `Creates a Neuro-Symbolic calculation node on a target Knowledge Graph node (supports FORMULA, MOVING_AVERAGE, YEAR_OVER_YEAR, MONTE_CARLO_SIMULATION, BAYESIAN_INFERENCE, CONSTRAINT_CHECK, PAGERANK, MODEL_PREDICTION, etc.).`
