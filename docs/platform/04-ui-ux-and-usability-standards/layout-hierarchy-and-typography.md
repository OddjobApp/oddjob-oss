---
id: layout-hierarchy-and-typography
title: Layout Hierarchy, Typography Scales & 8px Spacing Rhythm
audience: [HUMAN_PRIMARY, HYBRID]
badge: HYBRID
category: 04-ui-ux-and-usability-standards
autonomy_level: L0-L4
version: 1.0.0
tags: [typography, layout, grid, spacing, design-system, aesthetics, fonts]
summary: Standards for typography scales (Outfit / Inter), font weight pairings, line heights, and consistent 8px baseline spatial rhythm across generated interfaces.
---

# Layout Hierarchy & Typography Standards `[🤝 HYBRID]`

> **Audience:** `🤝 Hybrid: Builder + Agent` &nbsp;|&nbsp; **Design Framework:** `Oddjob Design Tokens v2`

---

## 1. Typography Pairing & Hierarchy `[🤖 Agent Rules]`

When authoring user interfaces:
* **Display & Section Headers:** Use `font-sans` with Google Font **Outfit** (`font-weight: 700` or `800`, `letter-spacing: -0.02em`).
* **Body Text & Form Inputs:** Use Google Font **Inter** (`font-weight: 400` or `500`, `line-height: 1.5`).
* **Data, Identifiers & Timestamps:** Use **JetBrains Mono** or `font-mono` (`tabular-nums` enabled).

### Typography Scale Reference:
| Semantic Token | Tailwind Class | Pixel Size | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- |
| `text-2xl` | `text-2xl md:text-3xl font-black` | 24px–30px | 1.2 | Page Header / Main Title |
| `text-base` | `text-base font-bold` | 16px | 1.3 | Card Header / Modal Title |
| `text-xs` | `text-xs font-semibold` | 12px | 1.4 | Table Row Data / Secondary Info |
| `text-[10px]` | `text-[10px] font-mono uppercase` | 10px | 1.0 | Status Badges / Metadata Tags |

---

## 2. 8px Spatial Rhythm & Card Padding `[🤖 Agent]`
All margins, paddings, and gap grids MUST be multiples of **4px / 8px**:
* Inner Card Padding: `p-4` (16px) or `p-6` (24px).
* Form Field Gap: `space-y-3` (12px) or `space-y-4` (16px).
* Metric Card Grid: `grid grid-cols-1 sm:grid-cols-3 gap-4` (16px gutter).
