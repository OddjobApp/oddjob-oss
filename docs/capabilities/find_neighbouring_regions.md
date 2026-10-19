# 🗺️ find_neighbouring_regions
> **Capability ID:** `find_neighbouring_regions`
> **Capability Version:** `1.0.0`
> **Manifest Schema Version:** `1`
> **Category:** `System Utilities`
> **Owner:** `platform`
> **Risk Profile:** `Low`
> **Execution Environment:** `Host`

---

## Description
Find regions geographically adjacent to a given region. Adjacency is computed from the cell sets at query time, not stored, so it stays correct when a boundary is edited.

---

## Inputs

| Name     | Type   |
| :------- | :----- |
| regionId | number |
| rings    | number |

---

## Outputs

| Name   | Type   |
| :----- | :----- |
| result | string |

---

## Guardrails
> [!NOTE] No explicit guardrails declared.

---

## Business Use Cases
> [!NOTE] No explicit business use cases declared.
