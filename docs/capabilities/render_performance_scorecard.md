# 🧩 Render Performance Scorecard

> **Capability ID:** `render_performance_scorecard`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Rich UI  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Present an evidence-backed professional review. Scores use 0–100; use null for missing data. Gate status is pass, fail, or unknown. This renders a recommendation only and never approves, deploys, pays, or changes records. Pilot templates: {"vendor_performance":{"title":"Vendor performance review","criteria":[{"label":"SLA and reliability","weight":30},{"label":"Deliverable quality","weight":25},{"label":"Commercial performance","weight":20},{"label":"Relationship and service","weight":25}],"gates":["Current certifications","No unresolved security incidents","Privacy compliance"]},"project_phase_gate":{"title":"Project phase-gate review","criteria":[{"label":"Deliverable completeness","weight":35},{"label":"Technical verification","weight":30},{"label":"Operational readiness","weight":20},{"label":"Business case","weight":15}],"gates":["No unresolved critical security findings","Architecture approval recorded","At least 90% of mandatory deliverables complete"]}}. Vendor weights describe the critical-vendor pilot; identify any different weighting in methodologyVersion. Provide sourced criteria and gate evidence; do not invent measurements.

---

## Inputs

| Name | Type |
| --- | --- |
| `template` | `enum` |
| `title` | `string` |
| `summary` | `string` |
| `period` | `string` |
| `methodologyVersion` | `string` |
| `criteria` | `array` |
| `gates` | `array` |
| `actions` | `array` |

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
