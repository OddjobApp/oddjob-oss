# 🧩 Mount Media Studio

> **Capability ID:** `mount_media_studio`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Video Content  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Opens Media Studio beside the CREW conversation on a film production: its story, storyboard, shots, takes and reels. Pass `productionId`, or `productionTitle` with the production's title. With neither, it opens this room's production, or the studio's start form when the room has none. Pass `create: true` with `productionTitle` to start a production in this room (an existing one with that title is opened instead). Opening renders, approves and assembles nothing, and takes no budget.

---

## Inputs

| Name | Type |
| --- | --- |
| `productionId` | `number` |
| `productionTitle` | `string` |
| `create` | `boolean` |
| `aspectRatio` | `enum` |
| `sceneId` | `string` |

## Outputs

| Name | Type |
| --- | --- |
| `result` | `string` |

---

## Business Use Cases

* **Interactive Film Production Cockpit**: Mounts the full Media Studio workspace (Story, Shots, Sequencer, Dailies, ComfyUI Visualizer) alongside the CREW multi-agent discussion room.
* **Screenplay-to-Visuals Transition**: Bridges Scribe Studio narrative scripts into visual scenes and shot sequences with character and environment continuity.
* **Collaborative Dailies Review**: Enables human directors and autonomous agents to inspect takes, compare iterations with A/B split-wipe, and execute editorial cut decisions in real time.

---

## Security Guardrails

* **Tenant Isolation**: Strictly scoped to `OrgContext.organizationId` via canonical `getOrgConditions` queries. Unauthenticated or foreign tenant production IDs are rejected with `404 Not Found`.
* **Zero-Budget Ingress**: Mounting Media Studio performs no compute synthesis, video generation, or LLM token burning; safe to invoke autonomously without pre-flight budget holds.
* **Non-Destructive Room State**: Auto-creates a new draft production only when `create: true` is explicitly passed; otherwise gracefully defaults to the current room's bound production or start form.

---

## Change History

<!-- ACDD:CHANGELOG -->

- **[Auto-Changelog 2026-09-13]** (source: code) — 4 field change(s):
  - removed `inputs.sceneTitle`: `string` → `—`
  - added `inputs.create`: `—` → `boolean`
  - added `inputs.productionId`: `—` → `number`
  - added `inputs.productionTitle`: `—` → `string`
