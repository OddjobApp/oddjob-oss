# 🗺️ h3_hexagonal_spatial_evaluate

> **ID:** `h3_hexagonal_spatial_evaluate`
> **Version:** `1.0.0`
> **Manifest Schema:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `High`
> **Execution Environment:** `Host`

---

## Description

Evaluates position on Uber H3 hexagonal mesh with 6-neighbor isotropic radial expansion and O(1) bitwise spatial zoom.

---

## Inputs

| Name | Type |
| :--- | :--- |
| assetId | string |
| assetName | string |
| latitude | number |
| longitude | number |
| speedKmh | number |
| riskFluxDensity | number |
| resolution | number |

---

## Outputs

| Name | Type |
| :--- | :--- |
| result | string |

---

## Guardrails

- Unknown or low-precision positions are never treated as definite locations.
- Exclusion rules do not fire when position is undetermined.
- Resolution, source precision, and spatial reasoning remain inspectable.
- Decisions are organization- and Project Space-scoped and durably audited.

---

## Business Use Cases

No business use cases declared.
