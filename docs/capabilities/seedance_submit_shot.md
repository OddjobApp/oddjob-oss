# 🧩 Ask for a Seedance Take

> **Capability ID:** `seedance_submit_shot`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** Video Content  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Ask for a Seedance take of a Media Studio shot by its shotId. The shot's direction and dialogue become the prompt, the take starts from the shot's keyframe when it has one, and nothing renders until a person approves it in the Decision Inbox. Without fal.ai configured, the take is recorded as a simulation with no video. Update the shot first to change what is rendered. A message that begins with [Media Studio selection: {...}] names the scene, shot or take it is about by id.

Ask for a Seedance take of a Media Studio shot by its shotId. The shot's direction and dialogue become the prompt, the take starts from the shot's keyframe when it has one, and nothing renders until a person approves it in the Decision Inbox. Without fal.ai configured, the take is recorded as a simulation with no video. Update the shot first to change what is rendered. A message that begins with [Media Studio selection: {...}] names the scene, shot or take it is about by id.

---

## Inputs

| Name | Type |
| --- | --- |
| `shotId` | `number` |
| `note` | `string` |
| `endOnNextKeyframe` | `boolean` |

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

- **[Auto-Changelog 2026-09-13]** (source: code) — 11 field change(s):
  - removed `inputs.seed`: `any` → `—`
  - removed `inputs.prompt`: `string` → `—`
  - removed `inputs.sceneId`: `string` → `—`
  - removed `inputs.shotNumber`: `number` → `—`
  - removed `inputs.aspectRatio`: `enum` → `—`
  - removed `inputs.cameraMotion`: `string` → `—`
  - removed `inputs.negativePrompt`: `string` → `—`
  - removed `inputs.durationSeconds`: `number` → `—`
  - added `inputs.endOnNextKeyframe`: `—` → `boolean`
  - added `inputs.note`: `—` → `string`
  - added `inputs.shotId`: `—` → `number`

- **[Auto-Changelog 2026-09-13]** (source: code) — 2 field change(s):
  - modified `metadata.description`: `Ask for a Seedance take of a Media Studio shot by its shotId. The shot's direction and dialogue become the prompt, the take starts from the shot's keyframe when it has one, and nothing renders until a person approves it in the Decision Inbox. Without fal.ai configured, the take is recorded as a simulation with no video. Update the shot first to change what is rendered.` → `Ask for a Seedance take of a Media Studio shot by its shotId. The shot's direction and dialogue become the prompt, the take starts from the shot's keyframe when it has one, and nothing renders until a person approves it in the Decision Inbox. Without fal.ai configured, the take is recorded as a simulation with no video. Update the shot first to change what is rendered. A message that begins with [Media Studio selection: {...}] names the scene, shot or take it is about by id.`
  - modified `documentation_meta.summary`: `Ask for a Seedance take of a Media Studio shot by its shotId. The shot's direction and dialogue become the prompt, the take starts from the shot's keyframe when it has one, and nothing renders until a person approves it in the Decision Inbox. Without fal.ai configured, the take is recorded as a simulation with no video. Update the shot first to change what is rendered.` → `Ask for a Seedance take of a Media Studio shot by its shotId. The shot's direction and dialogue become the prompt, the take starts from the shot's keyframe when it has one, and nothing renders until a person approves it in the Decision Inbox. Without fal.ai configured, the take is recorded as a simulation with no video. Update the shot first to change what is rendered. A message that begins with [Media Studio selection: {...}] names the scene, shot or take it is about by id.`
