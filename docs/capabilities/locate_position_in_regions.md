# 📍 locate_position_in_regions
> **ID**: `locate_position_in_regions`
> **Version**: `1.0.0`
> **Schema Version**: `1`
> **Category**: `System Utilities`
> **Owner**: `platform`
> **Risk Profile**: `Low`
> **Execution Environment**: `Host`

---

## Description
Determine which named regions a measured position falls inside. Requires the fix's accuracy in metres. Returns 'inside' and 'indeterminate' separately: a region is only reported as inside when the measurement is precise enough to say so, and a position too coarse to place is indeterminate against every region rather than outside them.

---

## Inputs

| Name            | Type   |
| :-------------- | :----- |
| latitude        | number |
| longitude       | number |
| precisionMetres | number |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| result | string |

---

## Business Use Cases
* No explicit business use cases declared.

---

## Guardrails
> [!NOTE]
> No explicit guardrails declared.
