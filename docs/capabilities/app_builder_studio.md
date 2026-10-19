# 🛠️ App Builder Studio
> **ID:** `app_builder_studio`  
> **Version:** `1.0.0`  
> **Schema:** `1`  
> **Category:** Custom JIT / UI Studio  
> **Owner:** App Platform  
> **Risk Profile:** Low  
> **Execution Environment:** Interactive Browser Canvas / Isolated Runtime  

---

## Overview

The **App Builder Studio** is Oddjob's live, interactive application workshop and the permanent end-state of the App Forge creation process. It enables operators, designers, and developers to visually polish, customize, and extend applications using representative primitives, targeted 4-zone grid placement, live preview element scoping, and direct top-bar publishing.

---

## Core Capabilities

### 1. 4-Zone Targeted Grid Drag-and-Drop
Allows dragging representative primitives from the Primitives catalog and magnetically snapping them into explicit spatial quadrants:
- **Top Zone (`slot: 'top'`)**: Full-width header and hero banners positioned above existing cards.
- **Left Column Zone (`slot: 'left'`)**: Placed into Column 1 of the 2-column grid beneath fleet readiness modules.
- **Right Column Zone (`slot: 'right'`)**: Placed into Column 2 of the 2-column grid beneath provider networks.
- **Bottom Zone (`slot: 'bottom'`)**: Full-width footer modules spanning the base of the viewport.

### 2. Normalized AI Edit Pipeline
A resilient normalization engine in `app-builder.service.ts` that safely ingests, unwraps, and flattens variable LLM output structures (nested object maps, array file lists, `{ code }`/`{ content }` keys) into valid string file entries, eliminating AI synthesis payload failures.

### 3. DOM Element Selection Scoping (`Select Mode`)
Enables developers to click any rendered DOM element inside the live Next.js preview iframe to automatically translate its CSS selector, classes, and enclosing context into scoped prompt instructions for the AI co-pilot.

### 4. Direct Top-Bar Go-Live Action
Provides an immediate `[🚀 Publish App]` action beside the live container port beacon to deploy to production, configure access governance, and generate embed codes without navigating away from the preview.

---

## Inputs

| Name | Type | Description |
|---|---|---|
| `appId` | `number` | Application database ID |
| `componentName` | `string` | Catalog primitive identifier (e.g. `MetricsCard`, `TelemetryChart`) |
| `targetSlot` | `string` | Spatial grid placement (`'top'`, `'left'`, `'right'`, `'bottom'`) |
| `instruction` | `string` | Natural language enhancement or refinement prompt |
| `scopePath` | `string \| null` | Scoped file path or DOM selector |

---

## Outputs

| Name | Type | Description |
|---|---|---|
| `success` | `boolean` | Indicates whether the enhancement or placement succeeded |
| `modifiedFiles` | `string[]` | List of workspace files updated by the synthesis pass |
| `astValidation` | `object` | AST cleanliness and TypeScript diagnostics report |
| `containerRestart` | `boolean` | Flag indicating hot-reload runtime re-ignition |

---

## Guardrails

> [!NOTE]
> All code synthesized in App Builder Studio executes inside the isolated Next.js runtime container on an assigned high-port (e.g. 10009), ensuring main platform process protection.
