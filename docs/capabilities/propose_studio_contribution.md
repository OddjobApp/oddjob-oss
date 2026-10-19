# 🛠️ Propose a Studio Contribution

> **Capability ID:** `propose_studio_contribution`  
> **Capability Version:** `1.0.0`  
> **Manifest Schema:** `v1`  
> **Category:** System Utilities  
> **Owner:** platform  
> **Risk Profile:** Low  
> **Execution Environment:** Host

---

## Overview

Introduces the agent's own suggestion to a live studio (Flow, Scribe, Form, Signal, Prediction, Media, Project, or Computer Use) and surfaces it to the user as a Human-In-The-Loop approval card. Nothing is written until the user clicks Apply.

WHEN TO USE: Call this whenever you want to add a step to a flow, insert a Scribe section, add a form field, activate a signal feed, or suggest another change that the user has not requested. For an explicitly requested draft edit, use the available studio mutation tool directly, respecting its permissions and lifecycle checks.

For requested archive/delete operations, use this card with targetId matching the action's resource ID. Supported actions: form_archive(formId), scribe_delete_station(nodeId), media_delete_scene(sceneId), signal_disable_feed(feedId), project_archive(projectId), agent_disable_card(agentId), computer_archive_skill(skillId). The server adds confirmation after the user applies the card; service permissions still apply. HOW IT WORKS: Supply the targetStudio and targetLabel so the card knows what is being changed, a diff list of what you are proposing (each item has a label and description), your rationale, and optionally an applyAction with the downstream tool call and its arguments. When the user approves, the crew service calls that tool automatically — no second turn needed.

---

## Inputs

| Name | Type |
| --- | --- |
| `targetStudio` | `enum` |
| `targetLabel` | `string` |
| `targetId` | `any` |
| `rationale` | `string` |
| `diff` | `array` |
| `checks` | `array` |
| `requiresApproval` | `boolean` |
| `applyAction` | `object` |

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
