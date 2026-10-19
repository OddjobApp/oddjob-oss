# 🧩 Assemble a Scene Reel

> **Capability ID:** `assemble_scene_timeline`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Video Content  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Cut a Media Studio scene's approved takes into one reel, in shot order with each shot's transition. Give the scene's id, or the production id and scene key (e.g. SCENE-01). It is refused, with the reason, while a shot has no approved take with video. The cut runs in the background and the reel appears in Media Studio's Film tab; do not describe a reel before it is ready. A message that begins with [Media Studio selection: {...}] carries the sceneId.

Cut a Media Studio scene's approved takes into one reel, in shot order with each shot's transition. Give the scene's id, or the production id and scene key (e.g. SCENE-01). It is refused, with the reason, while a shot has no approved take with video. The cut runs in the background and the reel appears in Media Studio's Film tab; do not describe a reel before it is ready. A message that begins with [Media Studio selection: {...}] carries the sceneId.

---

## Inputs

| Name | Type |
| --- | --- |
| `sceneId` | `number` |
| `productionId` | `number` |
| `sceneKey` | `string` |

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

- **[Auto-Changelog 2026-09-13]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Concatenate approved shot clips in sequential order, apply scene transitions (cuts, crossfades, dip-to-black), and mix down audio into a master video reel.` → `Stitch a scene's approved shot clips into one reel. Scene assembly is not set up on this platform yet, so this reports that no reel was made; tell the user rather than describing a reel.`
  - modified `documentation_meta.summary`: `Concatenate approved shot clips in sequential order, apply scene transitions (cuts, crossfades, dip-to-black), and mix down audio into a master video reel.` → `Stitch a scene's approved shot clips into one reel. Scene assembly is not set up on this platform yet, so this reports that no reel was made; tell the user rather than describing a reel.`

- **[Auto-Changelog 2026-09-13]** (source: code) — 8 field change(s):
  - removed `inputs.shots`: `array` → `—`
  - modified `inputs.sceneId`: `string` → `number`
  - removed `inputs.sceneTitle`: `string` → `—`
  - removed `inputs.audioTrackUrl`: `string` → `—`
  - removed `inputs.transitionType`: `enum` → `—`
  - removed `inputs.outputResolution`: `enum` → `—`
  - added `inputs.productionId`: `—` → `number`
  - added `inputs.sceneKey`: `—` → `string`
