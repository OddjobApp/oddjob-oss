# 🧩 Render Map

> **Capability ID:** `render_map`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Rich UI  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Render an interactive geographic map in the assistant chat to display geographic locations, facilities, routes, or proximity results with marker pins. Use this whenever you need to visualize locations on a map (e.g. closest sites, search radius, delivery stops, or coordinates). Provide markers with lat/lng, labels, optional descriptions, and an optional center coordinate and zoom level. To draw a mapped route, pass 'route' with ordered waypoints (2-25 stops): the path is road-snapped via Mapbox Directions when available and shown as a dashed straight line otherwise, with numbered stop pins and distance/duration. Always use this when answering location questions with pins instead of only describing coordinates in text.

---

## Inputs

| Name | Type |
| --- | --- |
| `title` | `string` |
| `description` | `string` |
| `markers` | `array` |
| `center` | `object` |
| `zoom` | `number` |
| `mapStyle` | `enum` |
| `route` | `object` |

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
